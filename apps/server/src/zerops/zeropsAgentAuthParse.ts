/**
 * Parses the one-line JSON `zcp agent mark-oauth <agent-id>` prints on stdout
 * (`cmd/zcp/agent.go` `agentMarkOAuthOutput`): `{ok, agent, key, changed,
 * migrated}` — `migrated` is `omitempty` on the Go side (absent means
 * false: no org-owner env migration happened, spec-welcome-mode.md §4.2).
 * Never carries an env value or a credential — only the flag key it
 * upserted, whether the upsert actually changed anything, and whether it
 * migrated an existing org-owner-scoped flag while doing so.
 */
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export interface MarkAgentOAuthResult {
  readonly key: string;
  readonly changed: boolean;
  readonly migrated: boolean;
}

const RawMarkAgentOAuthOutput = Schema.Struct({
  ok: Schema.Boolean,
  agent: Schema.String,
  key: Schema.String,
  changed: Schema.Boolean,
  migrated: Schema.optional(Schema.Boolean),
});

const decodeMarkAgentOAuthOutput = Schema.decodeUnknownOption(RawMarkAgentOAuthOutput);

/**
 * The result of a `mark-oauth` run, or undefined when the text is not one —
 * unreadable JSON, a document missing a required field, or `ok: false`.
 * Never throws.
 */
export const parseMarkAgentOAuthOutput = (text: string): MarkAgentOAuthResult | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.trim());
  } catch {
    return undefined;
  }
  const decoded = Option.getOrUndefined(decodeMarkAgentOAuthOutput(parsed));
  if (decoded === undefined || !decoded.ok) {
    return undefined;
  }
  return { key: decoded.key, changed: decoded.changed, migrated: decoded.migrated ?? false };
};
