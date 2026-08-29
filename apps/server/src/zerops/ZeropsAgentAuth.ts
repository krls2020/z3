/**
 * The agent authorization feed: whether Claude Code and Codex are signed in,
 * from inside this Zerops project (docs/spec-welcome-mode.md §3 W-STATE, z3
 * S7-1 plan §1 D1).
 *
 * Two independent inputs compose a five-value matrix, never a boolean union
 * (§3): the platform flag (`ZCP_AGENT_OAUTH_<SUFFIX>` / `ZCP_AGENT_TOKEN_<SUFFIX>`
 * in the zembed env store, `/etc/zerops-zembed/env.json`) and the local
 * credential artifact (`~/.claude/.credentials.json`, `~/.codex/auth.json`) —
 * presence only, never read for content. `computeAgentAuthState` mirrors
 * `vscode-bootstrap-welcome.js`'s `computeAgentState` verbatim.
 *
 * On a credential artifact's absent -> present transition, this feed spawns
 * `zcp agent mark-oauth <agent-id>` once (through {@link ZeropsCli}) and then
 * refreshes the provider registry, so the platform flag and the provider
 * picker agree within seconds instead of the registry's own ~5 min cadence.
 */
import type {
  ZeropsAgentAuthSnapshot,
  ZeropsAgentAuthState,
  ZeropsAgentId,
} from "@t3tools/contracts";

/** The two agents this feed reports on (docs/spec-welcome-mode.md §3: only agents with a verified probe). */
export const KNOWN_AGENT_IDS: ReadonlyArray<ZeropsAgentId> = ["claude-code", "codex"];

/**
 * `ZCP_AGENT_OAUTH_<SUFFIX>` / `ZCP_AGENT_TOKEN_<SUFFIX>` suffixes, mirroring
 * `internal/ops/agent_oauth.go`'s `agentOAuthSuffixes` map — one intentional
 * duplication across the Go/TS boundary, like welcome.js's own CRED_PROBE
 * duplication (that file's header comment). Only the two agents this feed
 * supports; the Go map also carries antigravity/grok/cursor, out of scope here.
 */
export const AGENT_OAUTH_SUFFIX: Readonly<Record<ZeropsAgentId, string>> = {
  "claude-code": "CLAUDE_CODE",
  codex: "CODEX",
};

/**
 * The §3 W-STATE matrix, verbatim from `vscode-bootstrap-welcome.js`'s
 * `computeAgentState`. That function also takes `credVerifiable`, but both
 * agents this feed reports on always have a verified probe (welcome.js's own
 * `CRED_PROBE` table), so every row here is already fully determined by these
 * three fields — the same reduction the matrix's spec table documents.
 */
export const computeAgentAuthState = (inputs: {
  readonly flagOAuth: boolean;
  readonly flagToken: boolean;
  readonly credPresent: boolean;
}): ZeropsAgentAuthState => {
  if (inputs.flagToken) {
    return "authorized-token";
  }
  if (inputs.flagOAuth) {
    return inputs.credPresent ? "authorized" : "reconnect";
  }
  return inputs.credPresent ? "local-only" : "not-authorized";
};

/** The zembed env store, decoded loosely: only string values are ever read from it. */
export type ZembedEnv = Readonly<Record<string, string>>;

/**
 * Assembles the full snapshot from already-collected inputs — pure, no I/O of
 * its own (the service does the reading). `env` absent means the store could
 * not be read (missing or invalid file): every flag reads as unset, never a
 * fallback that treats absence as authorized.
 */
export const buildSnapshot = (
  env: ZembedEnv | undefined,
  credPresence: Readonly<Record<ZeropsAgentId, boolean>>,
): ZeropsAgentAuthSnapshot => {
  const agents = KNOWN_AGENT_IDS.map((agentId) => {
    const suffix = AGENT_OAUTH_SUFFIX[agentId];
    const flagOAuth = env?.[`ZCP_AGENT_OAUTH_${suffix}`] === "true";
    const flagToken = !!env?.[`ZCP_AGENT_TOKEN_${suffix}`];
    const credPresent = credPresence[agentId];
    return {
      agentId,
      credPresent,
      flagOAuth,
      flagToken,
      state: computeAgentAuthState({ flagOAuth, flagToken, credPresent }),
    };
  });
  return { available: true, agents };
};
