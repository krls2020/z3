/**
 * A bounded copy of a `zerops_*` tool result, for the activity payload the web
 * client renders Zerops cards from.
 *
 * ## Why this exists
 *
 * `ActivityPayloadProjection` slims every activity before it leaves the server
 * — on the live WS path, the reconnect snapshot and the thread-detail snapshot
 * alike. For an MCP item it drops `result` outright and substitutes the first
 * non-empty line capped at 84 characters, because full tool output dominates
 * wire size on MCP-heavy threads. That is the right call for tool output in
 * general and fatal for a `zerops_*` result, which is not output to skim but a
 * JSON document (or a prose result carrying a fenced `json zcp-envelope`
 * block) that the client decodes into a deploy / verify / import card.
 *
 * So a copy of the text rides alongside the slimmed item, for `zerops_*` tools
 * only. The parsing stays client-side: this module decides *whether* text
 * travels, never what it means.
 *
 * Contract: `../zcp/plans/z3-s6-ui-plan-2026-08-28.md` D-U1.
 */
import { readZeropsToolCallData } from "./zeropsToolResult.ts";

/**
 * How much result text may ride on one activity, in UTF-16 code units.
 *
 * Sized for the documents zcp actually returns — a `zerops_workflow status`
 * envelope over a handful of services is low single-digit kilobytes — with room
 * for a failed `zerops_deploy`, whose `buildLogs` are the one unbounded field
 * (`ops.DeployResult`).
 */
export const ZEROPS_RESULT_TEXT_LIMIT = 48_000;

export interface ZeropsActivityResult {
  /** Tool name without the `mcp__<server>__` prefix, e.g. `zerops_deploy`. */
  readonly toolName: string;
  /**
   * The result text verbatim. Absent when the call has not returned yet, and
   * when the text was over the limit.
   */
  readonly resultText?: string;
  /** Set only when text was dropped for exceeding {@link ZEROPS_RESULT_TEXT_LIMIT}. */
  readonly truncated?: true;
}

/**
 * The Zerops result carried by an item payload's `data`, or undefined when the
 * item is not a `zerops_*` call.
 *
 * Over the limit the text is dropped WHOLE, never sliced. Half a JSON document
 * parses as nothing, and a card rendering from a truncated document would
 * render a lie; a client that gets `truncated` degrades to the generic tool
 * block, which is what it already does for any payload it cannot decode.
 */
export const projectZeropsResult = (data: unknown): ZeropsActivityResult | undefined => {
  const call = readZeropsToolCallData(data);
  if (call === undefined) {
    return undefined;
  }
  if (call.resultText === undefined) {
    return { toolName: call.toolName };
  }
  return call.resultText.length > ZEROPS_RESULT_TEXT_LIMIT
    ? { toolName: call.toolName, truncated: true }
    : { toolName: call.toolName, resultText: call.resultText };
};
