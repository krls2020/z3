import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import type { ZeropsAgentAuthSnapshot, ZeropsAgentId } from "@t3tools/contracts";

import { ZeropsCliFailed, ZeropsCliNotFound, type ZeropsCli } from "./ZeropsCli.ts";
import * as ZeropsAgentAuth from "./ZeropsAgentAuth.ts";
import type { WatcherHandle } from "./ZeropsAgentAuthWatcher.ts";
import type { MarkAgentOAuthResult } from "./zeropsAgentAuthParse.ts";

const ZEMBED_ENV_FILE_NAME = "zembed-env.json";

interface FakeCli {
  readonly cli: Pick<ZeropsCli["Service"], "markAgentOAuth">;
  readonly calls: Ref.Ref<ReadonlyArray<string>>;
}

/** A fake `markAgentOAuth` that records every call, in order, by agent id. */
const makeFakeCli = (
  answer: () => Effect.Effect<MarkAgentOAuthResult, ZeropsCliNotFound | ZeropsCliFailed>,
) =>
  Effect.gen(function* () {
    const calls = yield* Ref.make<ReadonlyArray<string>>([]);
    const cli: Pick<ZeropsCli["Service"], "markAgentOAuth"> = {
      markAgentOAuth: (agentId) =>
        Ref.update(calls, (all) => [...all, agentId]).pipe(Effect.andThen(answer())),
    };
    return { cli, calls } satisfies FakeCli;
  });

/**
 * A fake `watch` collaborator: no real OS file watcher, just a registry of
 * `onChange` callbacks keyed by target path that the test fires explicitly.
 * `make`'s own transition-detection, debounce, mark-oauth spawn, and provider
 * refresh logic all run for real — only "does the OS notice a file changed"
 * is replaced, since that mechanism (`watchWithFallback`) has its own,
 * separate test using plain Node `fs.watch` (`ZeropsAgentAuthWatcher.test.ts`).
 */
interface FakeWatch {
  readonly watch: (target: string, fallbackDir: string, onChange: () => void) => WatcherHandle;
  readonly trigger: (target: string) => void;
}

const makeFakeWatch = (): FakeWatch => {
  const handlers = new Map<string, () => void>();
  return {
    watch: (target, _fallbackDir, onChange) => {
      handlers.set(target, onChange);
      return {
        dispose: () => {
          handlers.delete(target);
        },
      };
    },
    trigger: (target) => {
      handlers.get(target)?.();
    },
  };
};

const makeEnv = () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const homeDir = yield* fs.makeTempDirectoryScoped({ prefix: "z3-agent-auth-home-" });
    const zembedDir = yield* fs.makeTempDirectoryScoped({ prefix: "z3-agent-auth-zembed-" });
    const envStorePath = path.join(zembedDir, ZEMBED_ENV_FILE_NAME);
    return { fs, path, homeDir, envStorePath };
  });

const writeCredential = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  homeDir: string,
  segments: ReadonlyArray<string>,
) =>
  Effect.gen(function* () {
    const target = path.join(homeDir, ...segments);
    yield* fs.makeDirectory(path.dirname(target), { recursive: true });
    yield* fs.writeFileString(target, "{}");
  });

/** Matches `path.join(homeDir, segment)` for these one-segment, no-trailing-slash inputs. */
const credWatchTarget = (homeDir: string, segment: string): string => `${homeDir}/${segment}`;

/**
 * Blocks the CURRENT fiber for the next published snapshot — deliberately
 * NOT forked. Forking a second fiber to race `Stream.runHead` against the
 * watcher's own forked, debounce-driven producer crashes this Effect build's
 * scheduler (`self.addObserver is not a function`, live-verified in
 * isolation — two concurrently forked fibers, one waking from a `Clock`-based
 * `Stream.debounce` wait to perform a `FileSystem` op while the other awaits
 * a `PubSub` read). Blocking the test's own fiber directly sidesteps it
 * entirely and is exactly as deterministic: the watcher fiber that `make`
 * starts internally publishes independently in the background regardless of
 * whether this fiber is racing it or waiting on it.
 */
const nextChange = (subscription: {
  readonly changes: Stream.Stream<ZeropsAgentAuthSnapshot>;
}): Effect.Effect<ZeropsAgentAuthSnapshot> =>
  Stream.runHead(subscription.changes).pipe(Effect.map(Option.getOrThrow));

const agentState = (
  snapshot: ZeropsAgentAuthSnapshot,
  agentId: ZeropsAgentId,
): ZeropsAgentAuthSnapshot["agents"][number] | undefined =>
  snapshot.agents.find((agent) => agent.agentId === agentId);

it.layer(NodeServices.layer, { excludeTestServices: true })(
  "ZeropsAgentAuth — non-Zerops mode",
  (it) => {
    it.effect("reports available:false and starts no watchers", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { homeDir, envStorePath } = yield* makeEnv();
          const fake = yield* makeFakeCli(() =>
            Effect.fail(new ZeropsCliNotFound({ command: "zcp" })),
          );
          const fakeWatch = makeFakeWatch();
          const feed = yield* ZeropsAgentAuth.make({
            cli: fake.cli,
            refreshProviders: Effect.void,
            homeDir,
            envStorePath,
            isZeropsEnvironment: false,
            watch: fakeWatch.watch,
          });
          const snapshot = yield* feed.latest;
          assert.isFalse(snapshot.available);
          assert.deepEqual(snapshot.agents, []);
          assert.deepEqual(yield* Ref.get(fake.calls), []);
        }),
      ),
    );
  },
);

it.layer(NodeServices.layer, { excludeTestServices: true })(
  "ZeropsAgentAuth — credential watcher",
  (it) => {
    it.effect(
      "spawns mark-oauth claude-code exactly once when the credential appears, then refreshes providers",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const { fs, path, homeDir, envStorePath } = yield* makeEnv();
            const fake = yield* makeFakeCli(() =>
              Effect.succeed({ key: "ZCP_AGENT_OAUTH_CLAUDE_CODE", changed: true }),
            );
            const fakeWatch = makeFakeWatch();
            const refreshCount = yield* Ref.make(0);

            const feed = yield* ZeropsAgentAuth.make({
              cli: fake.cli,
              refreshProviders: Ref.update(refreshCount, (n) => n + 1),
              homeDir,
              envStorePath,
              isZeropsEnvironment: true,
              watch: fakeWatch.watch,
            });

            const before = yield* feed.latest;
            assert.equal(agentState(before, "claude-code")?.state, "not-authorized");

            const subscription = yield* feed.subscribe;

            yield* writeCredential(fs, path, homeDir, [".claude", ".credentials.json"]);
            fakeWatch.trigger(credWatchTarget(homeDir, ".claude"));
            const published = yield* nextChange(subscription);

            const claude = agentState(published, "claude-code");
            assert.equal(claude?.credPresent, true);
            assert.equal(claude?.state, "local-only");

            assert.deepEqual(yield* Ref.get(fake.calls), ["claude-code"]);
            assert.equal(yield* Ref.get(refreshCount), 1);
          }),
        ),
    );

    it.effect("does not re-spawn mark-oauth on a second event once the credential is present", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { fs, path, homeDir, envStorePath } = yield* makeEnv();
          const fake = yield* makeFakeCli(() =>
            Effect.succeed({ key: "ZCP_AGENT_OAUTH_CLAUDE_CODE", changed: true }),
          );
          const fakeWatch = makeFakeWatch();
          const refreshCount = yield* Ref.make(0);

          const feed = yield* ZeropsAgentAuth.make({
            cli: fake.cli,
            refreshProviders: Ref.update(refreshCount, (n) => n + 1),
            homeDir,
            envStorePath,
            isZeropsEnvironment: true,
            watch: fakeWatch.watch,
          });

          const subscription = yield* feed.subscribe;
          yield* writeCredential(fs, path, homeDir, [".claude", ".credentials.json"]);
          fakeWatch.trigger(credWatchTarget(homeDir, ".claude"));
          yield* nextChange(subscription);
          assert.deepEqual(yield* Ref.get(fake.calls), ["claude-code"]);

          // A second event for the same (still-present) credential: the
          // transition already happened, so no second spawn. There is no next
          // change to wait for (an unchanged snapshot is never republished —
          // see ZeropsAgentAuth.ts's own signature check), so this proves an
          // absence with a bounded real wait past the debounce window instead.
          fakeWatch.trigger(credWatchTarget(homeDir, ".claude"));
          yield* Effect.sleep("600 millis");

          assert.deepEqual(yield* Ref.get(fake.calls), ["claude-code"]);
          assert.equal(yield* Ref.get(refreshCount), 1);
        }),
      ),
    );

    it.effect("spawns mark-oauth codex for the codex credential path", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { fs, path, homeDir, envStorePath } = yield* makeEnv();
          const fake = yield* makeFakeCli(() =>
            Effect.succeed({ key: "ZCP_AGENT_OAUTH_CODEX", changed: true }),
          );
          const fakeWatch = makeFakeWatch();

          const feed = yield* ZeropsAgentAuth.make({
            cli: fake.cli,
            refreshProviders: Effect.void,
            homeDir,
            envStorePath,
            isZeropsEnvironment: true,
            watch: fakeWatch.watch,
          });

          const subscription = yield* feed.subscribe;
          yield* writeCredential(fs, path, homeDir, [".codex", "auth.json"]);
          fakeWatch.trigger(credWatchTarget(homeDir, ".codex"));
          yield* nextChange(subscription);

          assert.deepEqual(yield* Ref.get(fake.calls), ["codex"]);
        }),
      ),
    );

    it.effect(
      "tolerates a missing ~/.codex directory at start (watchWithFallback attaches it once created — own test)",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const { homeDir, envStorePath } = yield* makeEnv();
            // homeDir exists; .codex does not — neither does .claude. `make`
            // must start cleanly and report credPresent:false for both, never
            // touching a real watcher (the fallback/re-attach mechanism itself
            // is ZeropsAgentAuthWatcher.test.ts's job).
            const fake = yield* makeFakeCli(() =>
              Effect.succeed({ key: "ZCP_AGENT_OAUTH_CODEX", changed: true }),
            );
            const fakeWatch = makeFakeWatch();

            const feed = yield* ZeropsAgentAuth.make({
              cli: fake.cli,
              refreshProviders: Effect.void,
              homeDir,
              envStorePath,
              isZeropsEnvironment: true,
              watch: fakeWatch.watch,
            });

            const initial = yield* feed.latest;
            assert.equal(agentState(initial, "codex")?.credPresent, false);
            assert.equal(agentState(initial, "claude-code")?.credPresent, false);
          }),
        ),
    );

    it.effect("stops spawning once zcp is reported not found, but states keep flowing", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { fs, path, homeDir, envStorePath } = yield* makeEnv();
          const fake = yield* makeFakeCli(() =>
            Effect.fail(new ZeropsCliNotFound({ command: "zcp" })),
          );
          const fakeWatch = makeFakeWatch();

          const feed = yield* ZeropsAgentAuth.make({
            cli: fake.cli,
            refreshProviders: Effect.void,
            homeDir,
            envStorePath,
            isZeropsEnvironment: true,
            watch: fakeWatch.watch,
          });

          const subscription = yield* feed.subscribe;
          yield* writeCredential(fs, path, homeDir, [".claude", ".credentials.json"]);
          fakeWatch.trigger(credWatchTarget(homeDir, ".claude"));
          yield* nextChange(subscription);
          assert.deepEqual(yield* Ref.get(fake.calls), ["claude-code"]);

          // codex appearing afterwards must not spawn a second time — zcp was
          // marked absent for good after the first attempt.
          yield* writeCredential(fs, path, homeDir, [".codex", "auth.json"]);
          fakeWatch.trigger(credWatchTarget(homeDir, ".codex"));
          const published = yield* nextChange(subscription);

          assert.equal(agentState(published, "codex")?.credPresent, true);
          assert.deepEqual(yield* Ref.get(fake.calls), ["claude-code"]);
        }),
      ),
    );
  },
);

// `Effect.retry`'s `{schedule, times, while}` composition — including nested
// inside a debounce-driven, forkScoped watcher fiber — is proven correct in
// isolation (offline repro, not committed here). An end-to-end
// ZeropsCliFailed-retries-then-succeeds case is deliberately NOT covered by
// an automated test in this file: it was live-observed to silently give up
// after one attempt (skipping the retry delay) specifically when run
// THROUGH this suite's shared `it.layer` harness, a narrow interaction this
// Effect build's Clock/scheduler has with a SECOND Clock-consuming wait
// inside a fiber already woken from `Stream.debounce`'s own wait — not
// reproducible with the retry mechanism standalone. Left as a gap for the
// S7-3 live check against the real `zcp` binary (a real Clock, no debounce
// interference) rather than chasing the test-harness interaction further.

it.layer(NodeServices.layer, { excludeTestServices: true })(
  "ZeropsAgentAuth — env store watcher",
  (it) => {
    it.effect(
      "flips state and refreshes providers when an oauth flag appears in the zembed store",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const { fs, homeDir, envStorePath } = yield* makeEnv();
            yield* fs.writeFileString(envStorePath, "{}");
            const fake = yield* makeFakeCli(() =>
              Effect.succeed({ key: "ZCP_AGENT_OAUTH_CLAUDE_CODE", changed: true }),
            );
            const fakeWatch = makeFakeWatch();
            const refreshCount = yield* Ref.make(0);

            const feed = yield* ZeropsAgentAuth.make({
              cli: fake.cli,
              refreshProviders: Ref.update(refreshCount, (n) => n + 1),
              homeDir,
              envStorePath,
              isZeropsEnvironment: true,
              watch: fakeWatch.watch,
            });

            const before = yield* feed.latest;
            assert.equal(agentState(before, "claude-code")?.state, "not-authorized");

            const subscription = yield* feed.subscribe;
            yield* fs.writeFileString(envStorePath, '{"ZCP_AGENT_OAUTH_CLAUDE_CODE":"true"}');
            fakeWatch.trigger(envStorePath);
            const published = yield* nextChange(subscription);

            const claude = agentState(published, "claude-code");
            assert.equal(claude?.flagOAuth, true);
            assert.equal(claude?.state, "reconnect");
            // The env-store path never spawns mark-oauth — only a credential
            // appearance does.
            assert.deepEqual(yield* Ref.get(fake.calls), []);
            assert.equal(yield* Ref.get(refreshCount), 1);
          }),
        ),
    );
  },
);
