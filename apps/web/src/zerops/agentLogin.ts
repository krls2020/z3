/**
 * Agent CLI login, driven from z3's own terminal — S7 plan D4.
 *
 * The card's "Sign in" button never calls a Zerops API: it types the agent
 * CLI's own login command into z3's terminal and lets the CLI's own flow
 * (a URL, a device code, whatever it prints) carry the user the rest of the
 * way. z3's Ghostty terminal regex-links a plain `https://…` line, so the
 * OAuth URL these commands print is already clickable — nothing
 * credential-shaped ever has to enter the chat.
 *
 * Command strings are lifted verbatim from the Zerops GUI's own walker
 * (`zcp-agent-auth-dialog.handlers.ts:145,174`), which hit the same
 * constraint this card has to work around: plain `codex login` opens a
 * `localhost:1455` OAuth callback the CLI's own machine can reach but a
 * browser on the user's laptop cannot, so Codex needs the device-auth flow
 * instead of its default.
 */
import type {
  ScopedThreadRef,
  TerminalOpenInput,
  TerminalWriteInput,
  ZeropsAgentAuthSnapshot,
  ZeropsAgentAuthState,
  ZeropsAgentId,
} from "@t3tools/contracts";

export const AGENT_LOGIN_COMMANDS: Record<ZeropsAgentId, string> = {
  "claude-code": "claude /login",
  codex: "codex login --device-auth",
};

export function agentLoginCommand(agentId: ZeropsAgentId): string {
  return AGENT_LOGIN_COMMANDS[agentId];
}

/** Copy per state in welcome.js's five-value matrix — see `ZeropsAgentAuthState`. */
const AGENT_AUTH_LABELS: Record<ZeropsAgentAuthState, string> = {
  "not-authorized": "Not signed in",
  "local-only": "Signed in on the container — registering with Zerops…",
  reconnect: "Reconnect needed — sign in again",
  authorized: "Authorized",
  "authorized-token": "Authorized (token)",
};

export function agentAuthLabel(state: ZeropsAgentAuthState): string {
  return AGENT_AUTH_LABELS[state];
}

/** Where the login terminal opens — the sshfs-mounted project root every z3 terminal defaults to. */
const AGENT_LOGIN_CWD = "/var/www";

/** Terminal id the login flow reuses: z3's primary shell (`terminalUiStateStore`'s default). */
const AGENT_LOGIN_TERMINAL_ID = "term-1";

export interface AgentLoginTerminalPlan {
  readonly terminalId: string;
  readonly openInput: TerminalOpenInput;
  readonly writeInput: TerminalWriteInput;
}

/**
 * The three-call terminal move (`setTerminalOpen` → open → write) needs an
 * open payload and a write payload; this is the pure half of that move —
 * everything decided without touching React or the RPC layer, so it can be
 * asserted directly. `useAgentLogin` is the thin wrapper that actually fires
 * the calls this returns.
 */
export function buildAgentLoginTerminalPlan(
  threadRef: ScopedThreadRef,
  agentId: ZeropsAgentId,
): AgentLoginTerminalPlan {
  const terminalId = AGENT_LOGIN_TERMINAL_ID;
  return {
    terminalId,
    openInput: {
      threadId: threadRef.threadId,
      terminalId,
      cwd: AGENT_LOGIN_CWD,
    },
    writeInput: {
      threadId: threadRef.threadId,
      terminalId,
      // `\r`, not `\n` — the same terminator `runProjectScript` uses
      // (`ChatView.tsx`'s `${script.command}\r`) to submit a typed command.
      data: `${agentLoginCommand(agentId)}\r`,
    },
  };
}

/**
 * Whether the card is worth showing at all: the feed has to be available
 * (this is a Zerops environment) and at least one agent has to need the
 * user's attention. `authorized` / `authorized-token` are the only states
 * that don't.
 */
export function zeropsAgentAuthNeedsAttention(snapshot: ZeropsAgentAuthSnapshot): boolean {
  return (
    snapshot.available &&
    snapshot.agents.some(
      (agent) => agent.state !== "authorized" && agent.state !== "authorized-token",
    )
  );
}
