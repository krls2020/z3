import { describe, expect, it } from "vite-plus/test";

import { parseMarkAgentOAuthOutput } from "./zeropsAgentAuthParse.ts";

describe("parseMarkAgentOAuthOutput", () => {
  it("parses the one-line JSON `zcp agent mark-oauth` prints", () => {
    const result = parseMarkAgentOAuthOutput(
      JSON.stringify({
        ok: true,
        agent: "claude-code",
        key: "ZCP_AGENT_OAUTH_CLAUDE_CODE",
        changed: true,
      }),
    );
    expect(result).toEqual({ key: "ZCP_AGENT_OAUTH_CLAUDE_CODE", changed: true });
  });

  it("parses changed:false the same way", () => {
    const result = parseMarkAgentOAuthOutput(
      JSON.stringify({ ok: true, agent: "codex", key: "ZCP_AGENT_OAUTH_CODEX", changed: false }),
    );
    expect(result).toEqual({ key: "ZCP_AGENT_OAUTH_CODEX", changed: false });
  });

  it("tolerates trailing whitespace/newline", () => {
    const result = parseMarkAgentOAuthOutput(
      `${JSON.stringify({ ok: true, agent: "codex", key: "ZCP_AGENT_OAUTH_CODEX", changed: false })}\n`,
    );
    expect(result).toEqual({ key: "ZCP_AGENT_OAUTH_CODEX", changed: false });
  });

  it("returns undefined for unparsable text", () => {
    expect(parseMarkAgentOAuthOutput("zcp: something went sideways")).toBeUndefined();
  });

  it("returns undefined when ok is false", () => {
    expect(
      parseMarkAgentOAuthOutput(
        JSON.stringify({ ok: false, agent: "codex", key: "ZCP_AGENT_OAUTH_CODEX", changed: false }),
      ),
    ).toBeUndefined();
  });

  it("returns undefined for a document missing a required field", () => {
    expect(parseMarkAgentOAuthOutput(JSON.stringify({ ok: true, agent: "codex" }))).toBeUndefined();
  });
});
