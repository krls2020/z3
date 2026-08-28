import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";

import type { CheckpointRef } from "@t3tools/contracts";
import { VcsProcessExitError } from "@t3tools/contracts";

import type * as CheckpointStore from "../checkpointing/CheckpointStore.ts";
import type * as VcsProcess from "../vcs/VcsProcess.ts";
import type { ZeropsRepositories, ZeropsRepository } from "./ZeropsRepositorySource.ts";
import {
  UNTRACKED_PROBE_MAX_BYTES,
  captureAcrossTargets,
  captureBaselineAcrossTargets,
  mergeCheckpointFiles,
  resolveCheckpointTargets,
  restoreAcrossTargets,
} from "./ZeropsCheckpointTargets.ts";

const kanban: ZeropsRepository = {
  host: "kanbandev",
  mountPath: "/var/www/kanbandev",
  remotePath: "/var/www",
};
const api: ZeropsRepository = {
  host: "apidev",
  mountPath: "/var/www/apidev",
  remotePath: "/var/www",
};

const available = (repositories: ReadonlyArray<ZeropsRepository>): ZeropsRepositories => ({
  _tag: "available",
  repositories,
});

const ref = (value: string) => value as CheckpointRef;

describe("resolveCheckpointTargets", () => {
  it("keeps the single upstream target when this is not a Zerops environment", () => {
    assert.deepStrictEqual(resolveCheckpointTargets("/home/me/repo", { _tag: "disabled" }), [
      { cwd: "/home/me/repo", prefix: "" },
    ]);
  });

  it("keeps the single upstream target when the topology could not be read", () => {
    assert.deepStrictEqual(
      resolveCheckpointTargets("/var/www", { _tag: "unavailable", reason: "no credentials" }),
      [{ cwd: "/var/www", prefix: "" }],
    );
  });

  it("fans a workspace root out over every repository mounted inside it", () => {
    assert.deepStrictEqual(resolveCheckpointTargets("/var/www", available([kanban, api])), [
      { cwd: "/var/www/kanbandev", prefix: "kanbandev/" },
      { cwd: "/var/www/apidev", prefix: "apidev/" },
    ]);
  });

  it("uses the one repository a narrower cwd sits in, with no prefix to add", () => {
    assert.deepStrictEqual(
      resolveCheckpointTargets("/var/www/kanbandev", available([kanban, api])),
      [{ cwd: "/var/www/kanbandev", prefix: "" }],
    );
    assert.deepStrictEqual(
      resolveCheckpointTargets("/var/www/kanbandev/packages/app", available([kanban, api])),
      [{ cwd: "/var/www/kanbandev/packages/app", prefix: "" }],
    );
  });

  it("has nothing to check point when a Zerops project has no mounted repository", () => {
    assert.deepStrictEqual(resolveCheckpointTargets("/var/www", available([])), []);
  });

  it("leaves an ordinary repository elsewhere on the container alone", () => {
    assert.deepStrictEqual(resolveCheckpointTargets("/home/zerops/scratch", available([kanban])), [
      { cwd: "/home/zerops/scratch", prefix: "" },
    ]);
  });
});

describe("mergeCheckpointFiles", () => {
  it("prefixes each repository's paths and sorts, so the list reads grouped by service", () => {
    assert.deepStrictEqual(
      mergeCheckpointFiles([
        {
          prefix: "kanbandev/",
          files: [
            { path: "src/board.ts", additions: 3, deletions: 1 },
            { path: "README.md", additions: 1, deletions: 0 },
          ],
        },
        { prefix: "apidev/", files: [{ path: "main.go", additions: 9, deletions: 2 }] },
      ]),
      [
        { path: "apidev/main.go", kind: "modified", additions: 9, deletions: 2 },
        { path: "kanbandev/README.md", kind: "modified", additions: 1, deletions: 0 },
        { path: "kanbandev/src/board.ts", kind: "modified", additions: 3, deletions: 1 },
      ],
    );
  });

  it("leaves paths untouched for the single unprefixed target", () => {
    assert.deepStrictEqual(
      mergeCheckpointFiles([{ prefix: "", files: [{ path: "a.ts", additions: 1, deletions: 0 }] }]),
      [{ path: "a.ts", kind: "modified", additions: 1, deletions: 0 }],
    );
  });
});

interface StoreCall {
  readonly op: string;
  readonly cwd: string;
}

const storeError = (cwd: string) =>
  new VcsProcessExitError({
    operation: "captureCheckpoint",
    command: "git",
    cwd,
    exitCode: 1,
    detail: "boom",
  });

const makeStore = (options?: {
  readonly failCapture?: ReadonlySet<string>;
  readonly failDiff?: ReadonlySet<string>;
  readonly failRestore?: ReadonlySet<string>;
  readonly missingBaseline?: ReadonlySet<string>;
  readonly diffByCwd?: Record<string, string>;
}) =>
  Effect.gen(function* () {
    const calls = yield* Ref.make<ReadonlyArray<StoreCall>>([]);
    const record = (op: string, cwd: string) =>
      Ref.update(calls, (previous) => [...previous, { op, cwd }]);
    const service = {
      isGitRepository: () => Effect.succeed(true),
      hasCheckpointRef: (input: { readonly cwd: string }) =>
        record("hasCheckpointRef", input.cwd).pipe(
          Effect.as(!(options?.missingBaseline?.has(input.cwd) ?? false)),
        ),
      captureCheckpoint: (input: { readonly cwd: string }) =>
        record("captureCheckpoint", input.cwd).pipe(
          Effect.andThen(
            options?.failCapture?.has(input.cwd) === true
              ? Effect.fail(storeError(input.cwd))
              : Effect.void,
          ),
        ),
      restoreCheckpoint: (input: { readonly cwd: string }) =>
        record("restoreCheckpoint", input.cwd).pipe(
          Effect.andThen(
            options?.failRestore?.has(input.cwd) === true
              ? Effect.fail(storeError(input.cwd))
              : Effect.succeed(true),
          ),
        ),
      diffCheckpoints: (input: { readonly cwd: string }) =>
        record("diffCheckpoints", input.cwd).pipe(
          Effect.andThen(
            options?.failDiff?.has(input.cwd) === true
              ? Effect.fail(storeError(input.cwd))
              : Effect.succeed(options?.diffByCwd?.[input.cwd] ?? ""),
          ),
        ),
      deleteCheckpointRefs: (input: { readonly cwd: string }) =>
        record("deleteCheckpointRefs", input.cwd).pipe(Effect.asVoid),
    } as unknown as CheckpointStore.CheckpointStore["Service"];
    return { service, calls } as const;
  });

/** A `ls-files --others` probe that reports whichever cwds overflow the cap. */
const makeVcsProcess = (overflowing?: ReadonlySet<string>) =>
  Effect.gen(function* () {
    const probes = yield* Ref.make<ReadonlyArray<VcsProcess.VcsProcessInput>>([]);
    const service = {
      run: (input: VcsProcess.VcsProcessInput) =>
        Ref.update(probes, (previous) => [...previous, input]).pipe(
          Effect.as({
            exitCode: 0,
            stdout: "",
            stderr: "",
            stdoutTruncated: overflowing?.has(input.cwd) ?? false,
            stderrTruncated: false,
          }),
        ),
    } as unknown as VcsProcess.VcsProcess["Service"];
    return { service, probes } as const;
  });

const diffFor = (path: string) =>
  `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -0,0 +1 @@\n+one\n`;

const targets = [
  { cwd: "/var/www/kanbandev", prefix: "kanbandev/" },
  { cwd: "/var/www/apidev", prefix: "apidev/" },
];

/** The fan-out context, with a probe memory scoped to the one test using it. */
const fanOut = (
  store: { readonly service: CheckpointStore.CheckpointStore["Service"] },
  vcs: { readonly service: VcsProcess.VcsProcess["Service"] },
  probed: Set<string> = new Set(),
) => ({ store: store.service, vcsProcess: vcs.service, probed });

describe("captureAcrossTargets", () => {
  it("captures once per repository and merges the diffs into one grouped list", () =>
    Effect.gen(function* () {
      const store = yield* makeStore({
        diffByCwd: {
          "/var/www/kanbandev": diffFor("src/board.ts"),
          "/var/www/apidev": diffFor("main.go"),
        },
      });
      const vcs = yield* makeVcsProcess();

      const result = yield* captureAcrossTargets(fanOut(store, vcs), {
        targets,
        fromCheckpointRef: ref("refs/t3/checkpoints/x/turn/0"),
        toCheckpointRef: ref("refs/t3/checkpoints/x/turn/1"),
      });

      const captured = (yield* Ref.get(store.calls))
        .filter((call) => call.op === "captureCheckpoint")
        .map((call) => call.cwd);
      assert.deepStrictEqual(captured, ["/var/www/kanbandev", "/var/www/apidev"]);
      assert.deepStrictEqual(
        result.files.map((file) => file.path),
        ["apidev/main.go", "kanbandev/src/board.ts"],
      );
      assert.deepStrictEqual(result.skipped, []);
    }).pipe(Effect.runPromise));

  it("names the turn with one ref in every repository, which is what keeps the projection flat", () =>
    Effect.gen(function* () {
      const refs: Array<string> = [];
      const store = yield* makeStore();
      const capturing = {
        ...store.service,
        captureCheckpoint: (input: { readonly cwd: string; readonly checkpointRef: string }) => {
          refs.push(input.checkpointRef);
          return store.service.captureCheckpoint(input as never);
        },
      } as unknown as CheckpointStore.CheckpointStore["Service"];
      const vcs = yield* makeVcsProcess();

      yield* captureAcrossTargets(
        { store: capturing, vcsProcess: vcs.service, probed: new Set() },
        {
          targets,
          fromCheckpointRef: ref("refs/t3/checkpoints/x/turn/0"),
          toCheckpointRef: ref("refs/t3/checkpoints/x/turn/1"),
        },
      );

      // Each repository has its own ref store, so one string is unambiguous in
      // all of them - and the projection keeps its single checkpoint_ref column.
      assert.deepStrictEqual(refs, [
        "refs/t3/checkpoints/x/turn/1",
        "refs/t3/checkpoints/x/turn/1",
      ]);
    }).pipe(Effect.runPromise));

  it("keeps the checkpoint when only its diff could not be read, and says so", () =>
    Effect.gen(function* () {
      const store = yield* makeStore({
        failDiff: new Set(["/var/www/kanbandev"]),
        diffByCwd: { "/var/www/apidev": diffFor("main.go") },
      });
      const vcs = yield* makeVcsProcess();

      const result = yield* captureAcrossTargets(fanOut(store, vcs), {
        targets,
        fromCheckpointRef: ref("refs/t3/checkpoints/x/turn/0"),
        toCheckpointRef: ref("refs/t3/checkpoints/x/turn/1"),
      });

      assert.deepStrictEqual(result.captured, ["/var/www/kanbandev", "/var/www/apidev"]);
      assert.deepStrictEqual(result.skipped, []);
      assert.deepStrictEqual(
        result.diffUnavailable.map((entry) => entry.cwd),
        ["/var/www/kanbandev"],
      );
      assert.deepStrictEqual(
        result.files.map((file) => file.path),
        ["apidev/main.go"],
      );
    }).pipe(Effect.runPromise));

  it("keeps one repository's checkpoint when another's fails", () =>
    Effect.gen(function* () {
      const store = yield* makeStore({
        failCapture: new Set(["/var/www/kanbandev"]),
        diffByCwd: { "/var/www/apidev": diffFor("main.go") },
      });
      const vcs = yield* makeVcsProcess();

      const result = yield* captureAcrossTargets(fanOut(store, vcs), {
        targets,
        fromCheckpointRef: ref("refs/t3/checkpoints/x/turn/0"),
        toCheckpointRef: ref("refs/t3/checkpoints/x/turn/1"),
      });

      assert.deepStrictEqual(
        result.files.map((file) => file.path),
        ["apidev/main.go"],
      );
      assert.deepStrictEqual(
        result.skipped.map((entry) => entry.cwd),
        ["/var/www/kanbandev"],
      );
      assert.deepStrictEqual(result.captured, ["/var/www/apidev"]);
    }).pipe(Effect.runPromise));

  it("reports a missing baseline per repository without skipping the capture", () =>
    Effect.gen(function* () {
      const store = yield* makeStore({ missingBaseline: new Set(["/var/www/apidev"]) });
      const vcs = yield* makeVcsProcess();

      const result = yield* captureAcrossTargets(fanOut(store, vcs), {
        targets,
        fromCheckpointRef: ref("refs/t3/checkpoints/x/turn/0"),
        toCheckpointRef: ref("refs/t3/checkpoints/x/turn/1"),
      });

      assert.deepStrictEqual(result.missingBaseline, ["/var/www/apidev"]);
      assert.deepStrictEqual(result.captured, ["/var/www/kanbandev", "/var/www/apidev"]);
    }).pipe(Effect.runPromise));

  it("refuses only the repository whose untracked set overflows the probe", () =>
    Effect.gen(function* () {
      const store = yield* makeStore({ diffByCwd: { "/var/www/apidev": diffFor("main.go") } });
      const vcs = yield* makeVcsProcess(new Set(["/var/www/kanbandev"]));

      const result = yield* captureAcrossTargets(fanOut(store, vcs), {
        targets,
        fromCheckpointRef: ref("refs/t3/checkpoints/x/turn/0"),
        toCheckpointRef: ref("refs/t3/checkpoints/x/turn/1"),
      });

      assert.deepStrictEqual(result.captured, ["/var/www/apidev"]);
      const [skipped] = result.skipped;
      assert.strictEqual(skipped?.cwd, "/var/www/kanbandev");
      assert.include(skipped?.reason ?? "", ".gitignore");
      assert.deepStrictEqual(
        (yield* Ref.get(store.calls))
          .filter((call) => call.op === "captureCheckpoint")
          .map((call) => call.cwd),
        ["/var/www/apidev"],
      );
    }).pipe(Effect.runPromise));

  it("probes untracked files cheaply, and only before the first capture on a repository", () =>
    Effect.gen(function* () {
      const store = yield* makeStore();
      const vcs = yield* makeVcsProcess();
      const context = fanOut(store, vcs);

      yield* captureAcrossTargets(context, {
        targets: [targets[0]!],
        fromCheckpointRef: ref("refs/t3/checkpoints/x/turn/0"),
        toCheckpointRef: ref("refs/t3/checkpoints/x/turn/1"),
      });
      yield* captureAcrossTargets(context, {
        targets: [targets[0]!],
        fromCheckpointRef: ref("refs/t3/checkpoints/x/turn/1"),
        toCheckpointRef: ref("refs/t3/checkpoints/x/turn/2"),
      });

      const probes = yield* Ref.get(vcs.probes);
      assert.strictEqual(probes.length, 1);
      const [probe] = probes;
      assert.deepStrictEqual(probe?.args, ["ls-files", "--others", "--exclude-standard", "-z"]);
      assert.strictEqual(probe?.maxOutputBytes, UNTRACKED_PROBE_MAX_BYTES);
    }).pipe(Effect.runPromise));
});

describe("restoreAcrossTargets", () => {
  it("restores every repository the checkpoint covers", () =>
    Effect.gen(function* () {
      const store = yield* makeStore();

      const result = yield* restoreAcrossTargets(store.service, {
        targets,
        checkpointRef: ref("refs/t3/checkpoints/x/turn/1"),
        fallbackToHead: false,
      });

      assert.deepStrictEqual(result.restored, ["/var/www/kanbandev", "/var/www/apidev"]);
      assert.deepStrictEqual(result.failed, []);
    }).pipe(Effect.runPromise));

  it("reports the repository that could not be restored without losing the others", () =>
    Effect.gen(function* () {
      const store = yield* makeStore({ failRestore: new Set(["/var/www/apidev"]) });

      const result = yield* restoreAcrossTargets(store.service, {
        targets,
        checkpointRef: ref("refs/t3/checkpoints/x/turn/1"),
        fallbackToHead: false,
      });

      assert.deepStrictEqual(result.restored, ["/var/www/kanbandev"]);
      assert.deepStrictEqual(
        result.failed.map((entry) => entry.cwd),
        ["/var/www/apidev"],
      );
    }).pipe(Effect.runPromise));
});

describe("captureBaselineAcrossTargets", () => {
  it("writes the baseline only where it is missing", () =>
    Effect.gen(function* () {
      const store = yield* makeStore({ missingBaseline: new Set(["/var/www/apidev"]) });
      const vcs = yield* makeVcsProcess();

      const result = yield* captureBaselineAcrossTargets(fanOut(store, vcs), {
        targets,
        checkpointRef: ref("refs/t3/checkpoints/x/turn/0"),
      });

      assert.deepStrictEqual(result.captured, ["/var/www/apidev"]);
      assert.deepStrictEqual(result.alreadyPresent, ["/var/www/kanbandev"]);
    }).pipe(Effect.runPromise));

  it("refuses the repository whose first checkpoint would swallow its untracked tree", () =>
    Effect.gen(function* () {
      const store = yield* makeStore({
        missingBaseline: new Set(["/var/www/kanbandev", "/var/www/apidev"]),
      });
      const vcs = yield* makeVcsProcess(new Set(["/var/www/kanbandev"]));

      const result = yield* captureBaselineAcrossTargets(fanOut(store, vcs), {
        targets,
        checkpointRef: ref("refs/t3/checkpoints/x/turn/0"),
      });

      assert.deepStrictEqual(result.captured, ["/var/www/apidev"]);
      assert.deepStrictEqual(
        result.skipped.map((entry) => entry.cwd),
        ["/var/www/kanbandev"],
      );
    }).pipe(Effect.runPromise));
});
