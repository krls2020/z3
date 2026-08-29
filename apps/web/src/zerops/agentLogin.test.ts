import { describe, expect, it } from "vite-plus/test";
import type { ScopedThreadRef, ZeropsAgentAuth, ZeropsAgentAuthSnapshot } from "@t3tools/contracts";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";

import {
  agentAuthAction,
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

const agent = (
  overrides: Partial<ZeropsAgentAuth> & { agentId: "claude-code" | "codex" },
): ZeropsAgentAuth => ({
  credPresent: false,
  flagOAuth: false,
  flagToken: false,
  state: "not-authorized",
  providerAuth: "unknown",
  ...overrides,
});

describe("agentAuthLabel / agentAuthAction", () => {
  it("not-authorized: ignores providerAuth entirely", () => {
    for (const providerAuth of ["authenticated", "unauthenticated", "unknown"] as const) {
      const a = agent({ agentId: "claude-code", state: "not-authorized", providerAuth });
      expect(agentAuthLabel(a)).toBe("Not signed in");
      expect(agentAuthAction(a)).toBe("sign-in");
    }
  });

  it("reconnect: ignores providerAuth entirely", () => {
    for (const providerAuth of ["authenticated", "unauthenticated", "unknown"] as const) {
      const a = agent({ agentId: "codex", state: "reconnect", providerAuth });
      expect(agentAuthLabel(a)).toBe("Reconnect needed — sign in again");
      expect(agentAuthAction(a)).toBe("sign-in");
    }
  });

  it("authorized + provider authenticated: the plain success label, no action", () => {
    const a = agent({
      agentId: "claude-code",
      state: "authorized",
      credPresent: true,
      providerAuth: "authenticated",
    });
    expect(agentAuthLabel(a)).toBe("Authorized");
    expect(agentAuthAction(a)).toBe("none");
  });

  it("authorized-token + provider authenticated: the token-flavored success label, no action", () => {
    const a = agent({
      agentId: "codex",
      state: "authorized-token",
      credPresent: true,
      providerAuth: "authenticated",
    });
    expect(agentAuthLabel(a)).toBe("Authorized (token)");
    expect(agentAuthAction(a)).toBe("none");
  });

  it("local-only + provider authenticated: the default registering label, disabled action", () => {
    const a = agent({
      agentId: "claude-code",
      state: "local-only",
      credPresent: true,
      providerAuth: "authenticated",
    });
    expect(agentAuthLabel(a)).toBe("Signed in on the container — registering with Zerops…");
    expect(agentAuthAction(a)).toBe("registering");
  });

  /**
   * The local state matrix (state) and the live provider check (providerAuth)
   * can disagree — a credential file that is present but expired, revoked, or
   * belongs to a signed-out account. providerAuth wins: this is still
   * something the user must act on, from both `authorized*` and `local-only`.
   */
  it("authorized + provider unauthenticated: re-auth label, enabled sign-in", () => {
    const a = agent({
      agentId: "claude-code",
      state: "authorized",
      credPresent: true,
      providerAuth: "unauthenticated",
    });
    expect(agentAuthLabel(a)).toBe(
      "Signed in on the container, but Claude/Codex reports not authenticated — sign in again",
    );
    expect(agentAuthAction(a)).toBe("sign-in");
  });

  it("authorized-token + provider unauthenticated: re-auth label, enabled sign-in", () => {
    const a = agent({
      agentId: "codex",
      state: "authorized-token",
      credPresent: true,
      providerAuth: "unauthenticated",
    });
    expect(agentAuthLabel(a)).toBe(
      "Signed in on the container, but Claude/Codex reports not authenticated — sign in again",
    );
    expect(agentAuthAction(a)).toBe("sign-in");
  });

  it("local-only + provider unauthenticated: re-auth label, enabled sign-in", () => {
    const a = agent({
      agentId: "claude-code",
      state: "local-only",
      credPresent: true,
      providerAuth: "unauthenticated",
    });
    expect(agentAuthLabel(a)).toBe(
      "Signed in on the container, but Claude/Codex reports not authenticated — sign in again",
    );
    expect(agentAuthAction(a)).toBe("sign-in");
  });

  it("authorized + provider unknown, credential present: checking, disabled action", () => {
    const a = agent({
      agentId: "claude-code",
      state: "authorized",
      credPresent: true,
      providerAuth: "unknown",
    });
    expect(agentAuthLabel(a)).toBe("Checking…");
    expect(agentAuthAction(a)).toBe("checking");
  });

  it("local-only + provider unknown, credential present: checking, disabled action", () => {
    const a = agent({
      agentId: "codex",
      state: "local-only",
      credPresent: true,
      providerAuth: "unknown",
    });
    expect(agentAuthLabel(a)).toBe("Checking…");
    expect(agentAuthAction(a)).toBe("checking");
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

const snapshot = (agents: ReadonlyArray<ZeropsAgentAuth>): ZeropsAgentAuthSnapshot => ({
  available: true,
  agents,
});

describe("zeropsAgentAuthNeedsAttention", () => {
  it("is false when the feed is not available", () => {
    expect(zeropsAgentAuthNeedsAttention({ available: false, agents: [] })).toBe(false);
  });

  it("is false when every agent is authorized and the provider agrees", () => {
    expect(
      zeropsAgentAuthNeedsAttention(
        snapshot([
          agent({
            agentId: "claude-code",
            state: "authorized",
            credPresent: true,
            providerAuth: "authenticated",
          }),
          agent({
            agentId: "codex",
            state: "authorized-token",
            credPresent: true,
            providerAuth: "authenticated",
          }),
        ]),
      ),
    ).toBe(false);
  });

  it("is true when at least one agent is not authorized", () => {
    expect(
      zeropsAgentAuthNeedsAttention(
        snapshot([
          agent({
            agentId: "claude-code",
            state: "authorized",
            credPresent: true,
            providerAuth: "authenticated",
          }),
          agent({ agentId: "codex", state: "reconnect" }),
        ]),
      ),
    ).toBe(true);
  });

  /**
   * The case the addendum exists for: the local state matrix says
   * "authorized", but the live provider check disagrees. That disagreement
   * has to surface the card, or the user never learns they need to re-auth.
   */
  it("is true when the state matrix says authorized but the provider disagrees", () => {
    expect(
      zeropsAgentAuthNeedsAttention(
        snapshot([
          agent({
            agentId: "claude-code",
            state: "authorized",
            credPresent: true,
            providerAuth: "unauthenticated",
          }),
        ]),
      ),
    ).toBe(true);
  });
});
