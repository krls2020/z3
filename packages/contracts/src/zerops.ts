/**
 * Zerops feeds — the additive contract slice the Zerops-aware client renders from.
 *
 * Two independent feeds, neither derived from the other:
 *
 * - **topology** (`ZeropsTopologySnapshot`) — what exists in the Zerops project,
 *   read from `zcp studio topology`. One per server: a z3 environment is one
 *   Zerops project.
 * - **lifecycle** (`ZeropsLifecycle`) — where the agent is, reduced per thread
 *   from the `workflow.StateEnvelope` that zcp's workflow-aware tool results
 *   carry. One per thread.
 *
 * Nothing here mutates: the client renders state, the agent mutates through MCP.
 *
 * ## Why the enum-shaped fields are plain strings
 *
 * `ZeropsStateEnvelope` mirrors a Go type owned by another repo (`zcp`,
 * `internal/workflow/envelope.go`) that gains values independently of this
 * build — `phase` gained `launch-production-active` that way. A
 * `Schema.Literals` union would make the *whole* envelope undecodable the first
 * time zcp ships a new value, taking the strip down over a field the client
 * could have ignored. So every open vocabulary decodes as a string and the
 * known values ship beside it as a `KNOWN_*` const array for the client to
 * switch on with a default branch. Same reasoning for the timestamps zcp
 * produces: they stay strings (`IsoDateTime`), while timestamps this server
 * mints are `Schema.DateTimeUtc`.
 */
import * as Schema from "effect/Schema";

import {
  ForwardCompatibleArray,
  IsoDateTime,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";

// ---------------------------------------------------------------------------
// Topology
// ---------------------------------------------------------------------------

/**
 * The POC's service taxonomy (`runtimes | data | infrastructure`), rebuilt from
 * what `zcp studio topology` carries. The POC grouped on the Zerops API's
 * `serviceStackTypeCategory`, which the topology JSON does not include.
 */
export const ZeropsServiceGroup = Schema.Literals(["runtimes", "data", "infrastructure"]);
export type ZeropsServiceGroup = typeof ZeropsServiceGroup.Type;

/** zcp's six-state adoption classification. Open vocabulary — see the file header. */
export const ZeropsAdoptionState = Schema.String;
export type ZeropsAdoptionState = typeof ZeropsAdoptionState.Type;

export const KNOWN_ZEROPS_ADOPTION_STATES = [
  "adopted",
  "resumable",
  "adoptable",
  "managed-dep",
  "zcp-self",
  "bootstrapping",
] as const;

/**
 * Platform service statuses that are settled. Everything else is treated as
 * transient — a status the platform adds later costs one extra poll, whereas
 * the inverse mistake leaves a service frozen mid-transition on screen.
 */
export const SETTLED_ZEROPS_SERVICE_STATUSES = [
  "ACTIVE",
  "RUNNING",
  "STOPPED",
  "READY_TO_DEPLOY",
  "FAILED",
  "DELETED",
  "ACTION_FAILED",
  "CONTAINER_FAILED",
  "REPAIR_FAILED",
] as const;

export const ZeropsService = Schema.Struct({
  hostname: TrimmedNonEmptyString,
  serviceId: Schema.String,
  /** Type-version as the platform reports it, e.g. `nodejs@22`, `postgresql:single@18`. */
  type: Schema.String,
  status: Schema.String,
  group: ZeropsServiceGroup,
  adoptionState: ZeropsAdoptionState,
  /** True for databases/caches/search/messaging/storage — zcp's `isInfrastructure` flag. */
  isManagedService: Schema.Boolean,
  /** True while `status` is not one of {@link SETTLED_ZEROPS_SERVICE_STATUSES}. */
  transient: Schema.Boolean,
  /** Whether zcp has this service sshfs-mounted; `mountPath` is zcp's own answer. */
  mounted: Schema.Boolean,
  mountPath: Schema.optional(Schema.String),
  subdomainEnabled: Schema.optional(Schema.Boolean),
  subdomainUrl: Schema.optional(Schema.String),
});
export type ZeropsService = typeof ZeropsService.Type;

export const ZeropsProject = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  status: Schema.optional(Schema.String),
});
export type ZeropsProject = typeof ZeropsProject.Type;

/**
 * `available: false` means this is not a Zerops environment (no `zcp` binary) —
 * the feed is off and that is not an error. `degraded: true` means zcp is here
 * but the last read failed; the feed keeps retrying and `services` holds the
 * last good read.
 */
export const ZeropsTopologySnapshot = Schema.Struct({
  available: Schema.Boolean,
  degraded: Schema.Boolean,
  /** Why the feed is unavailable or degraded. Absent when neither. */
  reason: Schema.optional(Schema.String),
  project: Schema.optional(ZeropsProject),
  services: Schema.Array(ZeropsService),
  /** Advisory notes zcp attached to the read (adoptable services, live activity). */
  warnings: Schema.Array(Schema.String),
  /**
   * Whether the push channel (`zcp studio watch`) is currently connected.
   *
   * `true` — service add/delete reaches the map within about a second.
   * `false` — the doorbell is down and the feed has fallen back to polling, so
   * the map is still correct but lags by a few seconds; worth showing.
   * Absent — there is no doorbell to report on, because the feed is
   * unavailable. `false` would read as "the doorbell is down", a different claim.
   */
  doorbellConnected: Schema.optional(Schema.Boolean),
  /** When this server produced the snapshot. */
  readAt: Schema.DateTimeUtc,
});
export type ZeropsTopologySnapshot = typeof ZeropsTopologySnapshot.Type;

// ---------------------------------------------------------------------------
// StateEnvelope mirror — zcp `internal/workflow/envelope.go`
// ---------------------------------------------------------------------------

export const KNOWN_ZEROPS_PHASES = [
  "idle",
  "bootstrap-active",
  "develop-active",
  "develop-closed-auto",
  "strategy-setup",
  "export-active",
  "launch-production-active",
] as const;

export const KNOWN_ZEROPS_IDLE_SCENARIOS = [
  "empty",
  "bootstrapped",
  "adopt",
  "incomplete",
] as const;

export const KNOWN_ZEROPS_BOOTSTRAP_ROUTES = ["recipe", "classic", "adopt", "resume"] as const;

export const ZeropsEnvelopeProject = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
});
export type ZeropsEnvelopeProject = typeof ZeropsEnvelopeProject.Type;

export const ZeropsEnvelopeSelfService = Schema.Struct({
  hostname: Schema.String,
});
export type ZeropsEnvelopeSelfService = typeof ZeropsEnvelopeSelfService.Type;

/** One service's point-in-time lifecycle state — `workflow.ServiceSnapshot`. */
export const ZeropsServiceSnapshot = Schema.Struct({
  hostname: Schema.String,
  typeVersion: Schema.String,
  runtimeClass: Schema.String,
  status: Schema.String,
  bootstrapped: Schema.Boolean,
  deployed: Schema.optional(Schema.Boolean),
  resumable: Schema.optional(Schema.Boolean),
  mode: Schema.optional(Schema.String),
  closeDeployMode: Schema.optional(Schema.String),
  gitPushState: Schema.optional(Schema.String),
  buildIntegration: Schema.optional(Schema.String),
  remoteUrl: Schema.optional(Schema.String),
  feedsProduction: Schema.optional(Schema.Array(Schema.String)),
  stageHostname: Schema.optional(Schema.String),
  setupName: Schema.optional(Schema.String),
  stageSetupName: Schema.optional(Schema.String),
});
export type ZeropsServiceSnapshot = typeof ZeropsServiceSnapshot.Type;

/** One deploy or verify attempt — `workflow.AttemptInfo`. */
export const ZeropsAttemptInfo = Schema.Struct({
  at: IsoDateTime,
  success: Schema.Boolean,
  iteration: Schema.Number,
  setup: Schema.optional(Schema.String),
  strategy: Schema.optional(Schema.String),
  reason: Schema.optional(Schema.String),
  failureClass: Schema.optional(Schema.String),
  summary: Schema.optional(Schema.String),
});
export type ZeropsAttemptInfo = typeof ZeropsAttemptInfo.Type;

export const ZeropsWorkSession = Schema.Struct({
  intent: Schema.String,
  services: Schema.Array(Schema.String),
  /** hostname → `required | deferred | out-of-scope`. Absent entry means required. */
  roles: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  createdAt: IsoDateTime,
  closedAt: Schema.optional(IsoDateTime),
  closeReason: Schema.optional(Schema.String),
  deploys: Schema.optional(Schema.Record(Schema.String, Schema.Array(ZeropsAttemptInfo))),
  verifies: Schema.optional(Schema.Record(Schema.String, Schema.Array(ZeropsAttemptInfo))),
});
export type ZeropsWorkSession = typeof ZeropsWorkSession.Type;

export const ZeropsRecipeMatch = Schema.Struct({
  slug: Schema.String,
  title: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  confidence: Schema.Number,
  importYaml: Schema.optional(Schema.String),
  mode: Schema.optional(Schema.String),
  repo: Schema.optional(Schema.String),
  guiSlug: Schema.optional(Schema.String),
});
export type ZeropsRecipeMatch = typeof ZeropsRecipeMatch.Type;

export const ZeropsBootstrapSession = Schema.Struct({
  route: Schema.String,
  step: Schema.optional(Schema.String),
  intent: Schema.optional(Schema.String),
  recipeMatch: Schema.optional(ZeropsRecipeMatch),
  closed: Schema.optional(Schema.Boolean),
});
export type ZeropsBootstrapSession = typeof ZeropsBootstrapSession.Type;

/**
 * `workflow.StateEnvelope` — the state zcp computes once per workflow-aware
 * tool result and ships inside the result text as a fenced `json zcp-envelope`
 * block. Contract: zcp `docs/spec-z3.md` §1.
 *
 * `services` decodes through {@link ForwardCompatibleArray}: a snapshot this
 * build cannot decode is dropped rather than failing the envelope, so one
 * unfamiliar service never blanks the whole strip.
 */
export const ZeropsStateEnvelope = Schema.Struct({
  phase: Schema.String,
  environment: Schema.String,
  idleScenario: Schema.optional(Schema.String),
  exportStatus: Schema.optional(Schema.String),
  selfService: Schema.optional(ZeropsEnvelopeSelfService),
  project: ZeropsEnvelopeProject,
  services: ForwardCompatibleArray(ZeropsServiceSnapshot),
  workSession: Schema.optional(ZeropsWorkSession),
  bootstrap: Schema.optional(ZeropsBootstrapSession),
  generated: IsoDateTime,
});
export type ZeropsStateEnvelope = typeof ZeropsStateEnvelope.Type;

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export const ZeropsToolStatus = Schema.Literals(["inProgress", "completed", "failed"]);
export type ZeropsToolStatus = typeof ZeropsToolStatus.Type;

/**
 * One `zerops_*` tool call, for the strip's "last action".
 *
 * Recorded for EVERY Zerops tool, whether or not it carries an envelope. The
 * envelope says where the agent IS; it cannot say what is happening right now —
 * a tool still running has no result yet, and a failed one carries no envelope
 * by design — and the strip still has to be able to read "deploying".
 * This is a log, not a state machine: the envelope stays the state.
 */
export const ZeropsRecentTool = Schema.Struct({
  toolName: TrimmedNonEmptyString,
  status: ZeropsToolStatus,
  at: Schema.DateTimeUtc,
  /**
   * The runtime item this call belongs to. Lets a client link a strip entry to
   * its row in the thread timeline, and is what turns a started-then-completed
   * tool into one entry that changes status rather than two rows.
   */
  itemId: Schema.optional(Schema.String),
});
export type ZeropsRecentTool = typeof ZeropsRecentTool.Type;

/** How many `recentTools` entries a thread keeps. */
export const ZEROPS_RECENT_TOOLS_LIMIT = 8;

export const ZeropsLifecycle = Schema.Struct({
  threadId: ThreadId,
  /** Absent until this thread's agent has run a tool that carries an envelope. */
  envelope: Schema.optional(ZeropsStateEnvelope),
  recentTools: Schema.Array(ZeropsRecentTool),
  /** Absent when nothing has been recorded for this thread yet. */
  updatedAt: Schema.optional(Schema.DateTimeUtc),
});
export type ZeropsLifecycle = typeof ZeropsLifecycle.Type;

// ---------------------------------------------------------------------------
// Agent auth — S7 plan D1/D3
// ---------------------------------------------------------------------------

/** The agent CLIs z3 can drive a login for. Closed vocabulary — see plan D6. */
export const ZeropsAgentId = Schema.Literals(["claude-code", "codex"]);
export type ZeropsAgentId = typeof ZeropsAgentId.Type;

/**
 * welcome.js's five-value matrix, verbatim
 * (`vscode-bootstrap-welcome.js:391-401`): whether a credential artifact is
 * present on disk, whether the platform-owned OAuth/token flag agrees, and
 * what that combination means for the card.
 */
export const ZeropsAgentAuthState = Schema.Literals([
  "authorized-token",
  "authorized",
  "reconnect",
  "local-only",
  "not-authorized",
]);
export type ZeropsAgentAuthState = typeof ZeropsAgentAuthState.Type;

export const ZeropsAgentAuth = Schema.Struct({
  agentId: ZeropsAgentId,
  /** Whether the credential artifact (`~/.claude/.credentials.json` etc.) exists. Presence-only — contents are never read. */
  credPresent: Schema.Boolean,
  flagOAuth: Schema.Boolean,
  flagToken: Schema.Boolean,
  state: ZeropsAgentAuthState,
});
export type ZeropsAgentAuth = typeof ZeropsAgentAuth.Type;

/** One per environment (a z3 environment is one Zerops project) — same shape as {@link ZeropsTopologySnapshot}. */
export const ZeropsAgentAuthSnapshot = Schema.Struct({
  /** `false` outside Zerops mode (no `T3CODE_ZEROPS_PROJECT_ID`) — the feed is off, not erroring. */
  available: Schema.Boolean,
  reason: Schema.optional(Schema.String),
  agents: Schema.Array(ZeropsAgentAuth),
});
export type ZeropsAgentAuthSnapshot = typeof ZeropsAgentAuthSnapshot.Type;

// ---------------------------------------------------------------------------
// RPC payloads
// ---------------------------------------------------------------------------

export const ZeropsLifecycleGetInput = Schema.Struct({
  threadId: ThreadId,
});
export type ZeropsLifecycleGetInput = typeof ZeropsLifecycleGetInput.Type;
