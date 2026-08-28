/**
 * ZeropsRepositorySource - which git repositories exist in this Zerops
 * project, and where each one really lives.
 *
 * On Zerops a repository is not a directory inside the workspace: it is a
 * sibling *service*. zcp sshfs-mounts every dev service's `/var/www` at
 * `/var/www/<hostname>` on the container, and the `.git` directory sits on
 * that service's own disk. So each entry here carries both sides of the same
 * repository - the `mountPath` the server and the agent see, and the
 * `remotePath` git must actually run against over SSH.
 *
 * The set is read from `zcp studio topology`, never by scanning `/var/www`
 * for `.git`. The topology is a direct platform read (no Elasticsearch lag),
 * so a service that was imported a second ago is already in it, and a
 * directory that merely looks like a repository is not.
 *
 * Three outcomes, deliberately distinct:
 * - `disabled` - not a Zerops environment; nothing to enumerate, nothing to
 *   warn about, and the topology command is never run.
 * - `unavailable` - Zerops, but the topology could not be read (no
 *   credentials, `zcp` missing, a timeout). Callers degrade and name the
 *   reason; they must not read it as "this project has no repositories".
 * - `available` - the answer, possibly an empty list, which is the honest
 *   "no repositories yet" of a project with no mounted runtime.
 *
 * @module ZeropsRepositorySource
 */
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";

import { ServerConfig } from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";
import { isZeropsEnvironment } from "./ZeropsEnvironment.ts";

/** Where zcp mounts every sibling service on the container. */
export const ZEROPS_WORKSPACE_ROOT = "/var/www";

/** Where the repository lives on the service itself - always the same path. */
export const ZEROPS_REMOTE_REPOSITORY_PATH = "/var/www";

/**
 * How long an enumeration stays good. Services are created and mounted by the
 * agent mid-turn, so the window is short; every read is a single 0.26 s
 * direct platform call, and a turn start refreshes explicitly anyway.
 */
export const REPOSITORY_CACHE_TTL = Duration.seconds(30);

/** How long the topology command may take before it counts as unavailable. */
export const TOPOLOGY_READ_TIMEOUT = Duration.seconds(15);

const TOPOLOGY_COMMAND = "zcp";
const TOPOLOGY_ARGS = ["studio", "topology"] as const;
const MAX_REASON_LENGTH = 200;

/** One repository: a mounted dev service with its `.git` on its own disk. */
export interface ZeropsRepository {
  /** The service hostname, which is also the SSH host inside the project. */
  readonly host: string;
  /** `/var/www/<host>` - the path the server, the agent and T3 all speak. */
  readonly mountPath: string;
  /** `/var/www` - the path git must run against on `host`. */
  readonly remotePath: string;
}

/** The result of an enumeration. See the module doc for why there are three. */
export type ZeropsRepositories =
  | { readonly _tag: "disabled" }
  | { readonly _tag: "unavailable"; readonly reason: string }
  | { readonly _tag: "available"; readonly repositories: ReadonlyArray<ZeropsRepository> };

/** The topology could not be read. Carries a reason fit to show a user. */
export class ZeropsTopologyUnavailable extends Data.TaggedError("ZeropsTopologyUnavailable")<{
  readonly reason: string;
}> {}

/** The one dependency the source has: something that produces topology JSON. */
export type ZeropsTopologyReader = Effect.Effect<string, ZeropsTopologyUnavailable>;

export interface ZeropsRepositorySourceOptions {
  /** `isZeropsEnvironment(config)`, passed in so the rule has one home. */
  readonly enabled: boolean;
  readonly read: ZeropsTopologyReader;
}

const truncateReason = (value: string): string => {
  const firstLine =
    value
      .split("\n")
      .find((line) => line.trim().length > 0)
      ?.trim() ?? "";
  return firstLine.length > MAX_REASON_LENGTH
    ? `${firstLine.slice(0, MAX_REASON_LENGTH)}…`
    : firstLine;
};

/**
 * Turns `zcp studio topology` output into the repository set.
 *
 * A service qualifies when it carries a `mountPath` - which zcp emits only
 * after `stat`ing `/var/www/<hostname>` on the container, so it means "really
 * mounted right now" - and is not a managed service (`isInfrastructure`): a
 * postgres has no working tree to check point.
 */
export const selectRepositories = (topologyJson: string): ZeropsRepositories => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(topologyJson);
  } catch (error) {
    return {
      _tag: "unavailable",
      reason: `zcp studio topology did not return JSON: ${truncateReason(String(error))}`,
    };
  }

  if (typeof parsed !== "object" || parsed === null || !("services" in parsed)) {
    return { _tag: "unavailable", reason: "zcp studio topology returned no services field" };
  }

  const services = (parsed as { readonly services: unknown }).services;
  if (!Array.isArray(services)) {
    return {
      _tag: "unavailable",
      reason: "zcp studio topology returned a non-list services field",
    };
  }

  const repositories: Array<ZeropsRepository> = [];
  for (const service of services) {
    if (typeof service !== "object" || service === null) {
      continue;
    }
    const entry = service as {
      readonly hostname?: unknown;
      readonly mountPath?: unknown;
      readonly isInfrastructure?: unknown;
    };
    if (entry.isInfrastructure === true) {
      continue;
    }
    const host = typeof entry.hostname === "string" ? entry.hostname.trim() : "";
    const mountPath = typeof entry.mountPath === "string" ? entry.mountPath.trim() : "";
    if (host.length === 0 || mountPath.length === 0) {
      continue;
    }
    repositories.push({ host, mountPath, remotePath: ZEROPS_REMOTE_REPOSITORY_PATH });
  }

  return { _tag: "available", repositories };
};

export interface ZeropsRepositorySourceService {
  /** The repository set, re-read when the cached one is older than the TTL. */
  readonly list: Effect.Effect<ZeropsRepositories>;
  /** An unconditional re-read - what a turn start uses. */
  readonly refresh: Effect.Effect<ZeropsRepositories>;
}

export const makeZeropsRepositorySource = Effect.fn("ZeropsRepositorySource.make")(function* (
  options: ZeropsRepositorySourceOptions,
): Effect.fn.Return<ZeropsRepositorySourceService, never, never> {
  const disabled = { _tag: "disabled" } as const;
  if (!options.enabled) {
    const off = Effect.succeed<ZeropsRepositories>(disabled);
    return { list: off, refresh: off };
  }

  const cache = yield* Ref.make<{ value: ZeropsRepositories; readAt: number } | undefined>(
    undefined,
  );
  // Set while an `unavailable` outcome has already been warned about, so a
  // container without credentials logs the reason once rather than on every
  // poll; cleared by a successful read so a later outage is heard again.
  const warned = yield* Ref.make(false);
  const gate = yield* Semaphore.make(1);

  const read = Effect.gen(function* () {
    const outcome = yield* options.read.pipe(
      Effect.map(selectRepositories),
      Effect.catchTag("ZeropsTopologyUnavailable", (error) =>
        Effect.succeed<ZeropsRepositories>({ _tag: "unavailable", reason: error.reason }),
      ),
    );

    if (outcome._tag === "unavailable") {
      const alreadyWarned = yield* Ref.getAndSet(warned, true);
      if (!alreadyWarned) {
        yield* Effect.logWarning(
          "Zerops topology unavailable - repositories cannot be enumerated",
          { reason: outcome.reason },
        );
      }
    } else {
      yield* Ref.set(warned, false);
    }

    const readAt = yield* Clock.currentTimeMillis;
    yield* Ref.set(cache, { value: outcome, readAt });
    return outcome;
  });

  const list = gate.withPermits(1)(
    Effect.gen(function* () {
      const cached = yield* Ref.get(cache);
      if (cached !== undefined) {
        const now = yield* Clock.currentTimeMillis;
        if (now - cached.readAt < Duration.toMillis(REPOSITORY_CACHE_TTL)) {
          return cached.value;
        }
      }
      return yield* read;
    }),
  );

  return { list, refresh: gate.withPermits(1)(read) };
});

export class ZeropsRepositorySource extends Context.Service<
  ZeropsRepositorySource,
  ZeropsRepositorySourceService
>()("t3/zerops/ZeropsRepositorySource") {}

/**
 * Runs `zcp studio topology` in the server's own working directory.
 *
 * The command is credential-blind by design: it reads them from the process
 * environment zcp itself set up, which is why it has to run inside the z3
 * unit rather than through a login shell.
 */
export const topologyReader = (
  runner: ProcessRunner.ProcessRunner["Service"],
  cwd: string,
): ZeropsTopologyReader =>
  runner
    .run({
      command: TOPOLOGY_COMMAND,
      args: [...TOPOLOGY_ARGS],
      cwd,
      timeout: TOPOLOGY_READ_TIMEOUT,
      timeoutBehavior: "timedOutResult",
    })
    .pipe(
      Effect.mapError(
        (error) =>
          new ZeropsTopologyUnavailable({
            reason: `zcp studio topology failed: ${truncateReason(error.message)}`,
          }),
      ),
      Effect.flatMap((result) => {
        if (result.timedOut) {
          return Effect.fail(
            new ZeropsTopologyUnavailable({
              reason: `zcp studio topology timed out after ${Duration.toSeconds(TOPOLOGY_READ_TIMEOUT)}s`,
            }),
          );
        }
        if (result.code !== 0) {
          const detail = truncateReason(result.stderr);
          return Effect.fail(
            new ZeropsTopologyUnavailable({
              reason: `zcp studio topology exited ${result.code}${detail.length > 0 ? `: ${detail}` : ""}`,
            }),
          );
        }
        return Effect.succeed(result.stdout);
      }),
    );

/**
 * The live source.
 *
 * It takes `ChildProcessSpawner` directly and builds its own runner rather
 * than taking the `ProcessRunner` service: the Zerops git spawner decorates
 * `ChildProcessSpawner` and needs this source to decide where a git command
 * belongs, so a source that consumed the decorated spawner would close a
 * dependency cycle. Running `zcp` on the raw spawner also keeps the one
 * command that discovers the repositories out of the path map entirely.
 */
export const layer = Layer.effect(
  ZeropsRepositorySource,
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const enabled = isZeropsEnvironment(config);
    const read = enabled
      ? topologyReader(yield* ProcessRunner.make(), config.cwd)
      : Effect.fail(new ZeropsTopologyUnavailable({ reason: "not a Zerops environment" }));
    return ZeropsRepositorySource.of(yield* makeZeropsRepositorySource({ enabled, read }));
  }),
);
