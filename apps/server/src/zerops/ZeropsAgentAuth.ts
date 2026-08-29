/**
 * The agent authorization feed: whether Claude Code and Codex are signed in,
 * from inside this Zerops project (docs/spec-welcome-mode.md §3 W-STATE, z3
 * S7-1 plan §1 D1).
 *
 * Two independent inputs compose a five-value matrix, never a boolean union
 * (§3): the platform flag (`ZCP_AGENT_OAUTH_<SUFFIX>` / `ZCP_AGENT_TOKEN_<SUFFIX>`
 * in the zembed env store, `/etc/zerops-zembed/env.json`) and the local
 * credential artifact (`~/.claude/.credentials.json`, `~/.codex/auth.json`) —
 * presence only, never read for content. `computeAgentAuthState` mirrors
 * `vscode-bootstrap-welcome.js`'s `computeAgentState` verbatim.
 *
 * On a credential artifact's absent -> present transition, this feed spawns
 * `zcp agent mark-oauth <agent-id>` once (through {@link ZeropsCli}) and then
 * refreshes the provider registry, so the platform flag and the provider
 * picker agree within seconds instead of the registry's own ~5 min cadence.
 */
import * as NodeOS from "node:os";

import type {
  ZeropsAgentAuthSnapshot,
  ZeropsAgentAuthState,
  ZeropsAgentId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import { ServerConfig } from "../config.ts";
import * as ProviderRegistry from "../provider/Services/ProviderRegistry.ts";
import { subscribeBeforeSnapshot } from "../utils/subscribeBeforeSnapshot.ts";
import { isZeropsEnvironment } from "./ZeropsEnvironment.ts";
import * as ZeropsCliModule from "./ZeropsCli.ts";
import { ZeropsCli, type ZeropsCliError } from "./ZeropsCli.ts";
import { watchWithFallback, type WatcherHandle } from "./ZeropsAgentAuthWatcher.ts";

/** The two agents this feed reports on (docs/spec-welcome-mode.md §3: only agents with a verified probe). */
export const KNOWN_AGENT_IDS: ReadonlyArray<ZeropsAgentId> = ["claude-code", "codex"];

/**
 * `ZCP_AGENT_OAUTH_<SUFFIX>` / `ZCP_AGENT_TOKEN_<SUFFIX>` suffixes, mirroring
 * `internal/ops/agent_oauth.go`'s `agentOAuthSuffixes` map — one intentional
 * duplication across the Go/TS boundary, like welcome.js's own CRED_PROBE
 * duplication (that file's header comment). Only the two agents this feed
 * supports; the Go map also carries antigravity/grok/cursor, out of scope here.
 */
export const AGENT_OAUTH_SUFFIX: Readonly<Record<ZeropsAgentId, string>> = {
  "claude-code": "CLAUDE_CODE",
  codex: "CODEX",
};

/**
 * The §3 W-STATE matrix, verbatim from `vscode-bootstrap-welcome.js`'s
 * `computeAgentState`. That function also takes `credVerifiable`, but both
 * agents this feed reports on always have a verified probe (welcome.js's own
 * `CRED_PROBE` table), so every row here is already fully determined by these
 * three fields — the same reduction the matrix's spec table documents.
 */
export const computeAgentAuthState = (inputs: {
  readonly flagOAuth: boolean;
  readonly flagToken: boolean;
  readonly credPresent: boolean;
}): ZeropsAgentAuthState => {
  if (inputs.flagToken) {
    return "authorized-token";
  }
  if (inputs.flagOAuth) {
    return inputs.credPresent ? "authorized" : "reconnect";
  }
  return inputs.credPresent ? "local-only" : "not-authorized";
};

/** The zembed env store, decoded loosely: only string values are ever read from it. */
export type ZembedEnv = Readonly<Record<string, string>>;

/**
 * Assembles the full snapshot from already-collected inputs — pure, no I/O of
 * its own (the service does the reading). `env` absent means the store could
 * not be read (missing or invalid file): every flag reads as unset, never a
 * fallback that treats absence as authorized.
 */
export const buildSnapshot = (
  env: ZembedEnv | undefined,
  credPresence: Readonly<Record<ZeropsAgentId, boolean>>,
): ZeropsAgentAuthSnapshot => {
  const agents = KNOWN_AGENT_IDS.map((agentId) => {
    const suffix = AGENT_OAUTH_SUFFIX[agentId];
    const flagOAuth = env?.[`ZCP_AGENT_OAUTH_${suffix}`] === "true";
    const flagToken = !!env?.[`ZCP_AGENT_TOKEN_${suffix}`];
    const credPresent = credPresence[agentId];
    return {
      agentId,
      credPresent,
      flagOAuth,
      flagToken,
      state: computeAgentAuthState({ flagOAuth, flagToken, credPresent }),
    };
  });
  return { available: true, agents };
};

// ---------------------------------------------------------------------------
// I/O
// ---------------------------------------------------------------------------

/** The path segments (relative to `homeDir`) of each agent's credential artifact. Presence only, never read for content. */
const CRED_PROBE_SEGMENTS: Readonly<Record<ZeropsAgentId, ReadonlyArray<string>>> = {
  "claude-code": [".claude", ".credentials.json"],
  codex: [".codex", "auth.json"],
};

/** The directory each cred probe's file lives under — what the credential watcher attaches to. */
const CRED_WATCH_DIR_SEGMENTS: Readonly<Record<ZeropsAgentId, ReadonlyArray<string>>> = {
  "claude-code": [".claude"],
  codex: [".codex"],
};

/**
 * The zembed env store zcp's sidecar writes (duplicated deliberately from
 * `internal/content/templates/vscode-bootstrap-welcome.js`'s own
 * `ZEMBED_DIR`/`ZEMBED_ENV_FILE` — the Go/JS/TS runtimes share no module
 * boundary to hang a single constant off).
 */
const ZEMBED_ENV_FILE = "/etc/zerops-zembed/env.json";

/** Shared debounce for every watcher below — a single write can emit more than one fs event (welcome.js's own STATE_PUSH_DEBOUNCE_MS). */
const STATE_PUSH_DEBOUNCE_MS = 400;

/** `ZeropsCliFailed` gets up to 3 attempts total (the initial try plus 2 retries) with a short exponential backoff; `ZeropsCliNotFound` is never retried. */
const MARK_OAUTH_RETRY_SCHEDULE = Schedule.exponential(Duration.millis(50));
const MARK_OAUTH_RETRY_ATTEMPTS = 2;

export class ZeropsAgentAuth extends Context.Service<
  ZeropsAgentAuth,
  {
    readonly latest: Effect.Effect<ZeropsAgentAuthSnapshot>;
    readonly changes: Stream.Stream<ZeropsAgentAuthSnapshot>;
    readonly subscribe: Effect.Effect<
      {
        readonly latest: ZeropsAgentAuthSnapshot;
        readonly changes: Stream.Stream<ZeropsAgentAuthSnapshot>;
      },
      never,
      Scope.Scope
    >;
  }
>()("t3/zerops/ZeropsAgentAuth") {}

export interface ZeropsAgentAuthOptions {
  readonly cli: Pick<ZeropsCli["Service"], "markAgentOAuth">;
  /** `providerRegistry.refresh()`, reduced to void — the one capability this feed needs from it. */
  readonly refreshProviders: Effect.Effect<void>;
  /** Resolved the same way the provider drivers do by default: `os.homedir()`, never `CLAUDE_CONFIG_DIR`. */
  readonly homeDir: string;
  readonly envStorePath: string;
  readonly isZeropsEnvironment: boolean;
  /**
   * Watches `target`, tolerating it not existing yet (falls back to
   * `fallbackDir` until it appears, then re-attaches — see
   * {@link watchWithFallback}). `onChange` may fire more than once per real
   * change; debouncing is this module's job. Injected — defaults to the real
   * `watchWithFallback` at {@link layer} — so `make` stays testable without
   * touching a real OS file watcher.
   */
  readonly watch: (target: string, fallbackDir: string, onChange: () => void) => WatcherHandle;
}

interface FeedState {
  readonly credPresence: Readonly<Record<ZeropsAgentId, boolean>>;
  readonly env: ZembedEnv | undefined;
  /** Set once `zcp` is known to be absent: `mark-oauth` is never spawned again. */
  readonly cliOff: boolean;
  /** The last snapshot actually published, so an event that changes nothing does not repaint. */
  readonly lastPublished: ZeropsAgentAuthSnapshot | undefined;
}

const toZembedEnv = (parsed: unknown): ZembedEnv | undefined => {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === "string") {
      out[key] = value;
    }
  }
  return out;
};

const decodeUnknownJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

/** Missing file, unreadable JSON, or a non-object document all read as "no store" — never a fallback that treats absence as authorized. */
const readZembedEnv = (
  fs: FileSystem.FileSystem,
  envStorePath: string,
): Effect.Effect<ZembedEnv | undefined> =>
  fs.readFileString(envStorePath).pipe(
    Effect.flatMap(decodeUnknownJson),
    Effect.map(toZembedEnv),
    Effect.orElseSucceed(() => undefined),
  );

const agentAuthEqual = (
  a: ZeropsAgentAuthSnapshot["agents"][number],
  b: ZeropsAgentAuthSnapshot["agents"][number],
): boolean =>
  a.agentId === b.agentId &&
  a.credPresent === b.credPresent &&
  a.flagOAuth === b.flagOAuth &&
  a.flagToken === b.flagToken &&
  a.state === b.state;

/** Field-by-field equality — avoids a JSON round-trip for what is only ever an internal dedup check. */
const snapshotsEqual = (a: ZeropsAgentAuthSnapshot, b: ZeropsAgentAuthSnapshot): boolean =>
  a.available === b.available &&
  a.reason === b.reason &&
  a.agents.length === b.agents.length &&
  a.agents.every((agent, index) => agentAuthEqual(agent, b.agents[index]!));

export const make = (options: ZeropsAgentAuthOptions) =>
  Effect.gen(function* () {
    const {
      cli,
      refreshProviders,
      homeDir,
      envStorePath,
      watch,
      isZeropsEnvironment: enabled,
    } = options;
    const changes = yield* PubSub.sliding<ZeropsAgentAuthSnapshot>(4);
    const subscribeMutex = yield* Semaphore.make(1);

    if (!enabled) {
      const off: ZeropsAgentAuthSnapshot = {
        available: false,
        reason: "Not a Zerops environment",
        agents: [],
      };
      const latest = Effect.succeed(off);
      return {
        latest,
        changes: Stream.fromPubSub(changes),
        subscribe: subscribeBeforeSnapshot(changes, latest, subscribeMutex),
      } satisfies ZeropsAgentAuth["Service"];
    }

    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const state = yield* Ref.make<FeedState>({
      credPresence: { "claude-code": false, codex: false },
      env: undefined,
      cliOff: false,
      lastPublished: undefined,
    });

    const probeCredential = (agentId: ZeropsAgentId): Effect.Effect<boolean> =>
      fs
        .exists(path.join(homeDir, ...CRED_PROBE_SEGMENTS[agentId]))
        .pipe(Effect.orElseSucceed(() => false));

    const publish = Effect.gen(function* () {
      const current = yield* Ref.get(state);
      const snapshot = buildSnapshot(current.env, current.credPresence);
      if (current.lastPublished !== undefined && snapshotsEqual(snapshot, current.lastPublished)) {
        return;
      }
      yield* Ref.update(state, (previous) => ({ ...previous, lastPublished: snapshot }));
      yield* PubSub.publish(changes, snapshot);
    });

    /**
     * Spawns `zcp agent mark-oauth <agentId>` once and, on success, refreshes
     * the provider registry (plan §1 D2). `ZeropsCliNotFound` latches
     * `cliOff` for good; `ZeropsCliFailed` gets {@link MARK_OAUTH_RETRY_SCHEDULE}.
     */
    const markOAuthAndRefresh = (agentId: ZeropsAgentId) =>
      Effect.gen(function* () {
        if ((yield* Ref.get(state)).cliOff) {
          return;
        }
        const outcome = yield* Effect.result(
          cli.markAgentOAuth(agentId).pipe(
            Effect.retry({
              schedule: MARK_OAUTH_RETRY_SCHEDULE,
              times: MARK_OAUTH_RETRY_ATTEMPTS,
              while: (error: ZeropsCliError) => error._tag === "ZeropsCliFailed",
            }),
          ),
        );
        if (outcome._tag === "Failure") {
          if (outcome.failure._tag === "ZeropsCliNotFound") {
            yield* Ref.update(state, (current) => ({ ...current, cliOff: true }));
          }
          yield* Effect.logWarning("zerops agent auth: mark-oauth failed", {
            agentId,
            error: outcome.failure,
          });
          return;
        }
        yield* refreshProviders.pipe(Effect.ignoreCause({ log: true }));
      });

    const recomputeCredential = (agentId: ZeropsAgentId) =>
      Effect.gen(function* () {
        const now = yield* probeCredential(agentId);
        const wasPresent = (yield* Ref.get(state)).credPresence[agentId];
        yield* Ref.update(state, (current) => ({
          ...current,
          credPresence: { ...current.credPresence, [agentId]: now },
        }));
        if (!wasPresent && now) {
          yield* markOAuthAndRefresh(agentId);
        }
        yield* publish;
      });

    const recomputeEnvStore = Effect.gen(function* () {
      const before = (yield* Ref.get(state)).env;
      const after = yield* readZembedEnv(fs, envStorePath);
      yield* Ref.update(state, (current) => ({ ...current, env: after }));

      const oauthOrTokenAppeared = KNOWN_AGENT_IDS.some((agentId) => {
        const suffix = AGENT_OAUTH_SUFFIX[agentId];
        const oauthKey = `ZCP_AGENT_OAUTH_${suffix}`;
        const tokenKey = `ZCP_AGENT_TOKEN_${suffix}`;
        const oauthAppeared = before?.[oauthKey] !== "true" && after?.[oauthKey] === "true";
        const tokenAppeared = !before?.[tokenKey] && !!after?.[tokenKey];
        return oauthAppeared || tokenAppeared;
      });
      if (oauthOrTokenAppeared) {
        yield* refreshProviders.pipe(Effect.ignoreCause({ log: true }));
      }
      yield* publish;
    });

    // Initial reads, before any watcher starts, so a client that connects
    // immediately gets real state rather than an empty placeholder.
    for (const agentId of KNOWN_AGENT_IDS) {
      const present = yield* probeCredential(agentId);
      yield* Ref.update(state, (current) => ({
        ...current,
        credPresence: { ...current.credPresence, [agentId]: present },
      }));
    }
    const initialEnv = yield* readZembedEnv(fs, envStorePath);
    yield* Ref.update(state, (current) => ({ ...current, env: initialEnv }));
    yield* publish;

    /**
     * Bridges the injected callback-style {@link watch} into Effect: every
     * `onChange()` call offers to a queue, a forked fiber drains it debounced
     * into `onEvent`. The watcher handle is disposed through a scope
     * finalizer — a plain synchronous close, never something the scheduler
     * needs to interrupt mid-flight.
     */
    const runWatcher = (target: string, fallbackDir: string, onEvent: Effect.Effect<void>) =>
      Effect.gen(function* () {
        const trigger = yield* Queue.unbounded<void>();
        const handle = watch(target, fallbackDir, () => {
          Queue.offerUnsafe(trigger, undefined);
        });
        yield* Effect.addFinalizer(() => Effect.sync(() => handle.dispose()));
        yield* Stream.fromQueue(trigger).pipe(
          Stream.debounce(Duration.millis(STATE_PUSH_DEBOUNCE_MS)),
          Stream.mapEffect(() => onEvent),
          Stream.runDrain,
          Effect.catchCause((cause) =>
            Effect.logWarning("zerops agent auth: watcher stopped", { cause }),
          ),
          Effect.forkScoped,
        );
      });

    for (const agentId of KNOWN_AGENT_IDS) {
      yield* runWatcher(
        path.join(homeDir, ...CRED_WATCH_DIR_SEGMENTS[agentId]),
        homeDir,
        recomputeCredential(agentId),
      );
    }
    yield* runWatcher(envStorePath, path.dirname(envStorePath), recomputeEnvStore);

    const latest = Ref.get(state).pipe(
      Effect.map((current) => buildSnapshot(current.env, current.credPresence)),
    );

    return {
      latest,
      changes: Stream.fromPubSub(changes),
      subscribe: subscribeBeforeSnapshot(changes, latest, subscribeMutex),
    } satisfies ZeropsAgentAuth["Service"];
  });

export const layer = Layer.effect(
  ZeropsAgentAuth,
  Effect.gen(function* () {
    const cli = yield* ZeropsCli;
    const providerRegistry = yield* ProviderRegistry.ProviderRegistry;
    const config = yield* ServerConfig;
    return yield* make({
      cli,
      refreshProviders: providerRegistry.refresh().pipe(Effect.asVoid),
      homeDir: NodeOS.homedir(),
      envStorePath: ZEMBED_ENV_FILE,
      isZeropsEnvironment: isZeropsEnvironment(config),
      watch: watchWithFallback,
    });
  }),
).pipe(Layer.provide(ZeropsCliModule.layer));
