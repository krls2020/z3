// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeChildProcess from "node:child_process";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as VcsProcess from "../vcs/VcsProcess.ts";
import {
  UNTRACKED_PROBE_MAX_BYTES,
  captureBaselineAcrossTargets,
} from "./ZeropsCheckpointTargets.ts";

/**
 * The untracked-file guard rests on one assumption about the executor: that a
 * `ls-files --others` output larger than the probe's cap comes back with
 * `stdoutTruncated` set. Everything else in the guard is tested against a fake
 * process; this is the one place the assumption meets the real stack.
 */
const makeRepositoryWithUntrackedFiles = (fileCount: number) => {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-untracked-probe-"));
  NodeChildProcess.execFileSync("git", ["init", "-q"], { cwd: dir });
  const nested = NodePath.join(dir, "node_modules", "a-package-with-a-longish-name", "dist");
  NodeFS.mkdirSync(nested, { recursive: true });
  for (let index = 0; index < fileCount; index += 1) {
    NodeFS.writeFileSync(
      NodePath.join(nested, `some-generated-module-file-${index}.js`),
      "module.exports = 1;\n",
    );
  }
  return dir;
};

it.layer(VcsProcess.layer.pipe(Layer.provideMerge(NodeServices.layer)))(
  "the untracked-file probe against the real executor",
  (it) => {
    it.effect("reports truncation once the untracked path list passes the cap", () =>
      Effect.gen(function* () {
        // Each path is ~70 bytes, so 6000 of them is ~420 KB — past the 256 KB cap.
        const cwd = makeRepositoryWithUntrackedFiles(6_000);
        const vcsProcess = yield* VcsProcess.VcsProcess;

        const result = yield* vcsProcess.run({
          operation: "test.probeUntracked",
          command: "git",
          args: ["ls-files", "--others", "--exclude-standard", "-z"],
          cwd,
          allowNonZeroExit: true,
          maxOutputBytes: UNTRACKED_PROBE_MAX_BYTES,
        });

        NodeFS.rmSync(cwd, { recursive: true, force: true });
        assert.isAbove(result.stdout.length, 0);
        assert.strictEqual(result.stdoutTruncated, true);
      }),
    );

    it.effect("leaves a small untracked set untruncated", () =>
      Effect.gen(function* () {
        const cwd = makeRepositoryWithUntrackedFiles(10);
        const vcsProcess = yield* VcsProcess.VcsProcess;

        const result = yield* vcsProcess.run({
          operation: "test.probeUntracked",
          command: "git",
          args: ["ls-files", "--others", "--exclude-standard", "-z"],
          cwd,
          allowNonZeroExit: true,
          maxOutputBytes: UNTRACKED_PROBE_MAX_BYTES,
        });

        NodeFS.rmSync(cwd, { recursive: true, force: true });
        assert.strictEqual(result.stdoutTruncated, false);
      }),
    );

    it.effect("refuses the baseline capture for a repository whose untracked set overflows", () =>
      Effect.gen(function* () {
        const cwd = makeRepositoryWithUntrackedFiles(6_000);
        const vcsProcess = yield* VcsProcess.VcsProcess;
        const captured: Array<string> = [];
        const store = {
          hasCheckpointRef: () => Effect.succeed(false),
          captureCheckpoint: (input: { readonly cwd: string }) =>
            Effect.sync(() => {
              captured.push(input.cwd);
            }),
        } as never;

        const result = yield* captureBaselineAcrossTargets(
          { store, vcsProcess, probed: new Set<string>() },
          { targets: [{ cwd, prefix: "" }], checkpointRef: "refs/t3/x/turn/0" as never },
        );

        NodeFS.rmSync(cwd, { recursive: true, force: true });
        assert.deepStrictEqual(captured, []);
        assert.strictEqual(result.skipped.length, 1);
      }),
    );
  },
);
