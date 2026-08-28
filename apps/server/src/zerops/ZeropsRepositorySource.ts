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
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";

import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";

import { ServerConfig } from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as ZeropsCli from "./ZeropsCli.ts";
import { isZeropsEnvironment } from "./ZeropsEnvironment.ts";
import type { ZeropsTopologyRead } from "./zeropsTopologyParse.ts";

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

/**
 * The one dependency the source has: a topology read.
 *
 * This is `ZeropsCli.readTopology` in production. The CLI seam owns running
 * `zcp studio topology`, parsing it and telling "zcp is absent" apart from
 * "the call failed"; this module owns only what that means for the repository
 * set, so there is one implementation of the shell-out and one parser.
 */
export type ZeropsTopologyReader = Effect.Effect<ZeropsTopologyRead, ZeropsCli.ZeropsCliError>;

export interface ZeropsRepositorySourceOptions {
  /** `isZeropsEnvironment(config)`, passed in so the rule has one home. */
  readonly enabled: boolean;
  readonly read: ZeropsTopologyReader;
}

/**
 * Turns `zcp studio topology` output into the repository set.
 *
 * A service qualifies when it carries a `mountPath` - which zcp emits only
 * after `stat`ing `/var/www/<hostname>` on the container, so it means "really
 * mounted right now" - and is not a managed service (`isInfrastructure`): a
 * postgres has no working tree to check point.
 */
export const selectRepositories = (topology: ZeropsTopologyRead): ZeropsRepositories => {
  const repositories: Array<ZeropsRepository> = [];
  for (const service of topology.services) {
    // `mounted`/`mountPath` are zcp's own answer — it stats `/var/www/<host>`
    // before emitting them — so this means "really mounted right now" rather
    // than "ought to be". A managed service has no working tree to check point.
    if (service.isManagedService || !service.mounted) {
      continue;
    }
    const mountPath = service.mountPath?.trim() ?? "";
    if (service.hostname.length === 0 || mountPath.length === 0) {
      continue;
    }
    repositories.push({
      host: service.hostname,
      mountPath,
      remotePath: ZEROPS_REMOTE_REPOSITORY_PATH,
    });
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
      Effect.catch((error) =>
        Effect.succeed<ZeropsRepositories>({ _tag: "unavailable", reason: error.message }),
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
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    // The CLI is built here rather than taken from the context on purpose. Its
    // own layer provides the `ProcessRunner` TAG, and this source sits below
    // the git spawner in the graph; a memoised runner bound to the raw spawner
    // could then reach `RepositoryIdentityResolver`, which runs git through
    // that same tag - and git would be back on the mount. Building the runner
    // locally keeps the shared graph untouched while still leaving one
    // implementation of the shell-out and one parser.
    const cli = yield* ZeropsCli.make({
      command: "zcp",
      baseArgs: [],
      cwd: config.cwd,
    }).pipe(
      Effect.provideService(
        ProcessRunner.ProcessRunner,
        yield* ProcessRunner.make().pipe(
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        ),
      ),
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
    );
    const read = enabled
      ? cli.readTopology
      : Effect.fail(new ZeropsCli.ZeropsCliNotFound({ command: "zcp" }));
    return ZeropsRepositorySource.of(yield* makeZeropsRepositorySource({ enabled, read }));
  }),
);
