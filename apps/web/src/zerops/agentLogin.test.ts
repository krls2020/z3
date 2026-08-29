import { describe, expect, it } from "vite-plus/test";
import type { ScopedThreadRef, ZeropsAgentAuthSnapshot } from "@t3tools/contracts";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";

import {
  agentAuthLabel,
  agentLoginCommand,
  AGENT_LOGIN_COMMANDS,
  buildAgentLoginTerminalPlan,
  zeropsAgentAuthNeedsAttention,
} from "./agentLogin";

const threadRef: ScopedThreadRef = {
  environmentId: EnvironmentId.make("env-1"),
  threadId: ThreadId.make("thread-1"),
};

describe("AGENT_LOGIN_COMMANDS / agentLoginCommand", () => {
  it("types the Claude Code CLI's own login command", () => {
    expect(AGENT_LOGIN_COMMANDS["claude-code"]).toBe("claude /login");
    expect(agentLoginCommand("claude-code")).toBe("claude /login");
  });

  /**
   * Plain `codex login` opens a `localhost:1455` OAuth callback the CLI's own
   * machine can reach but the user's browser cannot — the device-auth flow
   * prints a URL/code pair instead. Strings lifted verbatim from the Zerops
   * GUI's own walker (`zcp-agent-auth-dialog.handlers.ts:145,174`).
   */
  it("types Codex's device-auth login, not the browser-callback one", () => {
    expect(AGENT_LOGIN_COMMANDS.codex).toBe("codex login --device-auth");
    expect(agentLoginCommand("codex")).toBe("codex login --device-auth");
  });
});

describe("agentAuthLabel", () => {
  it("has one label per state in the matrix", () => {
    expect(agentAuthLabel("not-authorized")).toBe("Not signed in");
    expect(agentAuthLabel("local-only")).toBe(
      "Signed in on the container — registering with Zerops…",
    );
    expect(agentAuthLabel("reconnect")).toBe("Reconnect needed — sign in again");
    expect(agentAuthLabel("authorized")).toBe("Authorized");
    expect(agentAuthLabel("authorized-token")).toBe("Authorized (token)");
  });
});

describe("buildAgentLoginTerminalPlan", () => {
  it("opens the primary terminal at the mounted workspace root", () => {
    const plan = buildAgentLoginTerminalPlan(threadRef, "claude-code");

    expect(plan.openInput).toEqual({
      threadId: threadRef.threadId,
      terminalId: plan.terminalId,
      cwd: "/var/www",
    });
  });

  /**
   * `runProjectScript` (`ChatView.tsx`) types the command as `${command}\r` —
   * a carriage return, not `\n` — into the terminal. This must match exactly:
   * a wrong terminator leaves the command sitting in the shell's input buffer
   * unexecuted.
   */
  it("terminates the typed command with a carriage return, matching runProjectScript", () => {
    const plan = buildAgentLoginTerminalPlan(threadRef, "codex");

    expect(plan.writeInput).toEqual({
      threadId: threadRef.threadId,
      terminalId: plan.terminalId,
      data: "codex login --device-auth\r",
    });
  });

  it("targets the same terminal id for open and write", () => {
    const plan = buildAgentLoginTerminalPlan(threadRef, "claude-code");

    expect(plan.openInput.terminalId).toBe(plan.terminalId);
    expect(plan.writeInput.terminalId).toBe(plan.terminalId);
  });
});

const agent = (
  overrides: Partial<ZeropsAgentAuthSnapshot["agents"][number]> & {
    agentId: "claude-code" | "codex";
  },
) => ({
  credPresent: false,
  flagOAuth: false,
  flagToken: false,
  state: "not-authorized" as const,
  ...overrides,
});

const snapshot = (overrides?: Partial<ZeropsAgentAuthSnapshot>): ZeropsAgentAuthSnapshot => ({
  available: true,
  agents: [agent({ agentId: "claude-code" }), agent({ agentId: "codex" })],
  ...overrides,
});

describe("zeropsAgentAuthNeedsAttention", () => {
  it("is false when the feed is not available", () => {
    expect(zeropsAgentAuthNeedsAttention(snapshot({ available: false, agents: [] }))).toBe(false);
  });

  it("is false when every agent is authorized", () => {
    expect(
      zeropsAgentAuthNeedsAttention(
        snapshot({
          agents: [
            agent({ agentId: "claude-code", state: "authorized" }),
            agent({ agentId: "codex", state: "authorized-token" }),
          ],
        }),
      ),
    ).toBe(false);
  });

  it("is true when at least one agent is not authorized", () => {
    expect(
      zeropsAgentAuthNeedsAttention(
        snapshot({
          agents: [
            agent({ agentId: "claude-code", state: "authorized" }),
            agent({ agentId: "codex", state: "reconnect" }),
          ],
        }),
      ),
    ).toBe(true);
  });
});
