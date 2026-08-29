// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { assert, describe, it } from "vite-plus/test";

import { loadFixture } from "./loader.ts";
import { replayClaude } from "./claudeReplay.ts";

const __dirname = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const fixturesDir = NodePath.join(__dirname, "../fixtures/claude");

describe("replayClaude", () => {
  it("drives canUseTool/AskUserQuestion through user-input.requested -> answer -> user-input.resolved, and the turn continues", async () => {
    // Real recording (SPI-3): apps/server/src/spi/recording/record-claude.mjs,
    // captured on z3-eval/zcp with SDK 0.3.250 / CLI 2.1.251.
    const fixture = loadFixture(fixturesDir, "user-input-requested");

    const events = await replayClaude(fixture);
    const types = events.map((event) => event.type);

    assert.include(types, "session.started");
    assert.include(types, "session.configured");
    assert.include(types, "thread.started");

    const requestedIndex = types.indexOf("user-input.requested");
    const resolvedIndex = types.indexOf("user-input.resolved");
    assert.isAbove(requestedIndex, -1, "expected a user-input.requested event");
    assert.isAbove(resolvedIndex, requestedIndex, "resolved must come after requested");

    const requested = events[requestedIndex] as {
      readonly requestId?: string;
      readonly payload: { readonly questions: ReadonlyArray<{ readonly question: string }> };
    };
    assert.equal(requested.payload.questions[0]?.question, "Which color do you prefer?");
    assert.isDefined(requested.requestId);

    const resolved = events[resolvedIndex] as {
      readonly requestId?: string;
      readonly payload: { readonly answers: Record<string, string> };
    };
    assert.equal(resolved.requestId, requested.requestId);
    assert.deepEqual(resolved.payload.answers, { "Which color do you prefer?": "Blue" });

    // The turn continues after the answer: the recording's final
    // assistant message is exactly "done", followed by a successful result.
    assert.isAbove(
      types.indexOf("turn.completed"),
      resolvedIndex,
      "turn.completed must follow user-input.resolved",
    );
  }, 20_000);

  it("replays a plain text turn with no control lines", async () => {
    const fixture = loadFixture(fixturesDir, "plain-text-turn");
    const events = await replayClaude(fixture);
    const types = events.map((event) => event.type);

    assert.include(types, "thread.started");
    assert.include(types, "turn.completed");
    assert.notInclude(types, "user-input.requested");
    assert.notInclude(types, "request.opened");
  });

  it("replays a turn with both StateEnvelope carriers and no control lines (MCP calls auto-approved)", async () => {
    const fixture = loadFixture(fixturesDir, "zerops-workflow-envelope");
    const events = await replayClaude(fixture);
    const types = events.map((event) => event.type);

    assert.include(types, "turn.completed");
    assert.notInclude(types, "request.opened");
  });

  it("treats an interrupt() control line as a no-op and lets the following result message drive turn.completed(state:interrupted)", async () => {
    const fixture = loadFixture(fixturesDir, "turn-abort-error");
    const events = await replayClaude(fixture);

    const turnCompleted = events.find((event) => event.type === "turn.completed") as
      | { readonly payload: { readonly state: string } }
      | undefined;
    assert.isDefined(turnCompleted, "expected a turn.completed event");
    assert.equal(turnCompleted?.payload.state, "interrupted");
  }, 20_000);
});
