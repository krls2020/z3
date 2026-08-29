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
    const fixture = loadFixture(fixturesDir, "ask-user-question");

    const events = await replayClaude(fixture);
    const types = events.map((event) => event.type);

    // Session/thread bootstrap, then the message line's thread.started,
    // then the control line's user-input lifecycle.
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
    assert.equal(requested.payload.questions[0]?.question, "Which framework?");
    assert.isDefined(requested.requestId);

    const resolved = events[resolvedIndex] as {
      readonly requestId?: string;
      readonly payload: { readonly answers: Record<string, string> };
    };
    assert.equal(resolved.requestId, requested.requestId);
    assert.deepEqual(resolved.payload.answers, { "Which framework?": "React" });
  }, 20_000);
});
