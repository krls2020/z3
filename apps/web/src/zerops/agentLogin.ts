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
  ZeropsAgentAuth,
  ZeropsAgentAuthSnapshot,
  ZeropsAgentId,
} from "@t3tools/contracts";

export const AGENT_LOGIN_COMMANDS: Record<ZeropsAgentId, string> = {
  "claude-code": "claude /login",
  codex: "codex login --device-auth",
};

export function agentLoginCommand(agentId: ZeropsAgentId): string {
  return AGENT_LOGIN_COMMANDS[agentId];
}

type AgentAuthFields = Pick<ZeropsAgentAuth, "credPresent" | "providerAuth" | "state">;

/**
 * The card's whole decision tree in one place: `agentAuthLabel` and
 * `agentAuthAction` are two views onto the same classification, so a state
 * can never get a label from one branch and a button from another.
 *
 * `state` (the local container/platform-flag matrix) and `providerAuth` (a
 * live check against Claude/Codex's own account endpoint) can disagree — a
 * credential file that is present but expired, revoked, or belongs to a
 * signed-out account. `not-authorized` and `reconnect` have no credential to
 * check, so `providerAuth` is ignored for them; for the three states that
 * imply a credential is present (`authorized`, `authorized-token`,
 * `local-only`), `providerAuth` wins over `state`.
 */
type AgentAuthPresentation =
  | { readonly kind: "not-authorized" }
  | { readonly kind: "reconnect" }
  /** Credential present, but Claude/Codex itself no longer accepts it. */
  | { readonly kind: "needs-reauth" }
  /** Credential present; the live provider check hasn't answered yet. */
  | { readonly kind: "checking" }
  /** `local-only` with nothing contradicting it: the watcher will flip this within seconds. */
  | { readonly kind: "registering" }
  | { readonly kind: "authorized"; readonly token: boolean };

function classifyAgentAuth(agent: AgentAuthFields): AgentAuthPresentation {
  if (agent.state === "not-authorized") {
    return { kind: "not-authorized" };
  }
  if (agent.state === "reconnect") {
    return { kind: "reconnect" };
  }
  // From here, state is authorized | authorized-token | local-only — a
  // credential is present locally, and providerAuth is meaningful.
  if (agent.providerAuth === "unauthenticated") {
    return { kind: "needs-reauth" };
  }
  if (agent.providerAuth === "unknown" && agent.credPresent) {
    return { kind: "checking" };
  }
  if (agent.state === "local-only") {
    return { kind: "registering" };
  }
  return { kind: "authorized", token: agent.state === "authorized-token" };
}

export function agentAuthLabel(agent: AgentAuthFields): string {
  const presentation = classifyAgentAuth(agent);
  switch (presentation.kind) {
    case "not-authorized":
      return "Not signed in";
    case "reconnect":
      return "Reconnect needed — sign in again";
    case "needs-reauth":
      return "Signed in on the container, but Claude/Codex reports not authenticated — sign in again";
    case "checking":
      return "Checking…";
    case "registering":
      return "Signed in on the container — registering with Zerops…";
    case "authorized":
      return presentation.token ? "Authorized (token)" : "Authorized";
  }
}

/** What the row's action slot should render: an enabled sign-in button, a disabled placeholder, or nothing. */
export type ZeropsAgentAuthAction = "sign-in" | "registering" | "checking" | "none";

export function agentAuthAction(agent: AgentAuthFields): ZeropsAgentAuthAction {
  const presentation = classifyAgentAuth(agent);
  switch (presentation.kind) {
    case "not-authorized":
    case "reconnect":
    case "needs-reauth":
      return "sign-in";
    case "checking":
      return "checking";
    case "registering":
      return "registering";
    case "authorized":
      return "none";
  }
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
 * user's attention. Only the fully-`authorized` classification (state says
 * authorized AND the live provider check agrees) doesn't — notably, an
 * agent whose `state` says `authorized*` but whose `providerAuth` disagrees
 * still counts, or the user would never learn they need to re-auth.
 */
export function zeropsAgentAuthNeedsAttention(snapshot: ZeropsAgentAuthSnapshot): boolean {
  return (
    snapshot.available &&
    snapshot.agents.some((agent) => classifyAgentAuth(agent).kind !== "authorized")
  );
}
