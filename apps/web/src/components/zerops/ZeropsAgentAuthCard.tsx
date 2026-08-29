/**
 * One row per agent CLI (Claude Code, Codex): its authorization state and,
 * when the user needs to act, a "Sign in" button.
 *
 * The button's handler is a prop — this component never reaches the terminal
 * or the RPC layer itself, so it renders with `renderToStaticMarkup` alone.
 * `useAgentLogin` is what the handler actually does; deciding whether the
 * card is worth showing at all is `zeropsAgentAuthNeedsAttention`
 * (`../../zerops/agentLogin`), left to the caller so this stays pure.
 */
import type { ZeropsAgentAuth, ZeropsAgentAuthSnapshot, ZeropsAgentId } from "@t3tools/contracts";

import { Button } from "~/components/ui/button";
import { agentAuthAction, agentAuthLabel } from "../../zerops/agentLogin";

const AGENT_NAMES: Record<ZeropsAgentId, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
};

const AGENT_SIGN_IN_LABELS: Record<ZeropsAgentId, string> = {
  "claude-code": "Sign in to Claude",
  codex: "Sign in to Codex",
};

export function ZeropsAgentAuthCard({
  snapshot,
  onSignIn,
}: {
  readonly snapshot: ZeropsAgentAuthSnapshot;
  readonly onSignIn: (agentId: ZeropsAgentId) => void;
}) {
  if (!snapshot.available) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3" data-zerops-agent-auth-card>
      {snapshot.agents.map((agent) => (
        <ZeropsAgentAuthRow key={agent.agentId} agent={agent} onSignIn={onSignIn} />
      ))}
    </div>
  );
}

function ZeropsAgentAuthRow({
  agent,
  onSignIn,
}: {
  readonly agent: ZeropsAgentAuth;
  readonly onSignIn: (agentId: ZeropsAgentId) => void;
}) {
  return (
    <div
      className="flex items-center justify-between gap-3 text-sm"
      data-agent-id={agent.agentId}
      data-agent-state={agent.state}
      data-zerops-agent-auth-row
    >
      <div className="flex min-w-0 flex-col">
        <span className="font-medium">{AGENT_NAMES[agent.agentId]}</span>
        <span className="text-muted-foreground text-xs">{agentAuthLabel(agent)}</span>
      </div>
      <ZeropsAgentAuthActionButton agent={agent} onSignIn={onSignIn} />
    </div>
  );
}

function ZeropsAgentAuthActionButton({
  agent,
  onSignIn,
}: {
  readonly agent: ZeropsAgentAuth;
  readonly onSignIn: (agentId: ZeropsAgentId) => void;
}) {
  const action = agentAuthAction(agent);
  if (action === "sign-in") {
    return (
      <Button
        onClick={() => {
          onSignIn(agent.agentId);
        }}
        size="compact"
        variant="outline"
      >
        {AGENT_SIGN_IN_LABELS[agent.agentId]}
      </Button>
    );
  }
  if (action === "registering") {
    // The watcher marks this within seconds of the credential artifact
    // appearing — there is nothing for the user to click while it does.
    return (
      <Button disabled size="compact" variant="outline">
        Registering…
      </Button>
    );
  }
  if (action === "checking") {
    // The live provider check hasn't answered yet — same idea as
    // "registering", worded for what is actually pending.
    return (
      <Button disabled size="compact" variant="outline">
        Checking…
      </Button>
    );
  }
  return null;
}
