// @effect-diagnostics nodeBuiltinImport:off
/**
 * Runs every driver's replay/record function and compares its redacted
 * output against the checked-in `<name>.expected.json` next to its
 * fixture. This is the regression gate D4/acceptance describes: a ported
 * driver that changes the normalized output of a recorded stream (or, for
 * the live-driven ACP/OpenCode baselines, the output of the fixed
 * deterministic scenario) fails here, naming the fixture and the first
 * differing event.
 *
 * Set `SPI_UPDATE_GOLDENS=1` to (re)write every golden instead of
 * comparing — state the reason in the commit message.
 */
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import type { ProviderRuntimeEvent } from "@t3tools/contracts";
import { assert, describe, it } from "vite-plus/test";

import { replayClaude } from "./claudeReplay.ts";
import { replayCodex } from "./codexReplay.ts";
import { recordCursorBaseline, recordGrokBaseline } from "./acpReplay.ts";
import { recordOpenCodeBaseline } from "./openCodeReplay.ts";
import { checkOrUpdateGolden, describeFirstDivergence } from "./goldenCheck.ts";
import { loadFixture } from "./loader.ts";
import { redact } from "./redact.ts";

const __dirname = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const fixturesRoot = NodePath.join(__dirname, "../fixtures");

const REDACT_PATHS = [
  { path: process.cwd(), placeholder: "<CWD>" },
  { path: NodeOS.homedir(), placeholder: "<HOME>" },
  { path: NodeOS.tmpdir(), placeholder: "<TMPDIR>" },
];

// turnId/itemId/requestId are freshly generated per replay run (crypto
// UUIDs, or a driver-assigned id derived from one) — redact them by value
// so two events sharing a real id keep sharing their redacted placeholder.
const REDACT_IDS = [
  { fields: ["turnId", "providerTurnId"], prefix: "turn" },
  { fields: ["itemId", "providerItemId"], prefix: "item" },
  { fields: ["requestId", "providerRequestId"], prefix: "req" },
];

interface GoldenCase {
  readonly driver: string;
  readonly name: string;
  readonly record: () => Promise<ReadonlyArray<ProviderRuntimeEvent>>;
  readonly timeoutMs: number;
}

// Claude/Codex: replay a static JSONL wire fixture through the ported
// adapter (see claudeReplay.ts / codexReplay.ts for the seam each uses).
const jsonlCases: ReadonlyArray<GoldenCase> = [
  {
    driver: "claude",
    name: "ask-user-question",
    record: () =>
      replayClaude(loadFixture(NodePath.join(fixturesRoot, "claude"), "ask-user-question")),
    timeoutMs: 20_000,
  },
  {
    driver: "codex",
    name: "multi-agent-wire",
    record: () =>
      replayCodex(loadFixture(NodePath.join(fixturesRoot, "codex"), "multi-agent-wire")),
    timeoutMs: 20_000,
  },
];

// Cursor/Grok/OpenCode: no static wire capture exists to replay from (ACP
// drivers speak to a real child process, OpenCode to an SDK client); each
// "fixture" carries only meta.json documenting the fixed live scenario its
// record() function drives — see acpReplay.ts / openCodeReplay.ts.
const liveCases: ReadonlyArray<GoldenCase> = [
  { driver: "cursor", name: "hello-baseline", record: recordCursorBaseline, timeoutMs: 30_000 },
  { driver: "grok", name: "hello-baseline", record: recordGrokBaseline, timeoutMs: 30_000 },
  { driver: "opencode", name: "hello-baseline", record: recordOpenCodeBaseline, timeoutMs: 15_000 },
];

describe("SPI replay goldens", () => {
  for (const { driver, name, record, timeoutMs } of [...jsonlCases, ...liveCases]) {
    it(
      `${driver}/${name} matches its golden`,
      async () => {
        const dir = NodePath.join(fixturesRoot, driver);
        const events = await record();
        const redacted = redact(events as ReadonlyArray<Record<string, unknown>>, {
          paths: REDACT_PATHS,
          ids: REDACT_IDS,
        });

        const { updated, expected } = checkOrUpdateGolden(dir, name, redacted);
        if (updated) {
          return;
        }

        const divergence = describeFirstDivergence(`${driver}/${name}`, redacted, expected);
        assert.isUndefined(divergence, divergence);
      },
      timeoutMs,
    );
  }
});
