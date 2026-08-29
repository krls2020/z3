/**
 * Parses the one-line JSON `zcp agent mark-oauth <agent-id>` prints on stdout
 * (`cmd/zcp/agent.go` `agentMarkOAuthOutput`): `{ok, agent, key, changed}`.
 * Never carries an env value or a credential — only the flag key it upserted
 * and whether the upsert actually changed anything.
 */
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export interface MarkAgentOAuthResult {
  readonly key: string;
  readonly changed: boolean;
}

const RawMarkAgentOAuthOutput = Schema.Struct({
  ok: Schema.Boolean,
  agent: Schema.String,
  key: Schema.String,
  changed: Schema.Boolean,
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
  return { key: decoded.key, changed: decoded.changed };
};
