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
import type { SpiEvent, SpiToolCall } from "@t3tools/contracts";

import { readZeropsToolCall } from "./zeropsToolResult.ts";

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
 * The bounded projection of one already-resolved `zerops_*` tool call, or
 * undefined when there is none. Shared core: `projectZeropsResult` below is
 * the SPI-boundary-respecting entry point (`event.toolCall`, filtered by
 * name); `apps/server/src/orchestration/ActivityPayloadProjection.ts` — the
 * one caller with no `SpiEvent` to read `.toolCall` from — reaches this
 * through `apps/server/src/spi/toolCall.ts`'s `sniffToolCallShape` instead.
 *
 * Over the limit the text is dropped WHOLE, never sliced. Half a JSON document
 * parses as nothing, and a card rendering from a truncated document would
 * render a lie; a client that gets `truncated` degrades to the generic tool
 * block, which is what it already does for any payload it cannot decode.
 */
export const projectZeropsToolCall = (
  call: SpiToolCall | undefined,
): ZeropsActivityResult | undefined => {
  if (call === undefined) {
    return undefined;
  }
  if (call.result === undefined) {
    return { toolName: call.name };
  }
  return call.result.text.length > ZEROPS_RESULT_TEXT_LIMIT
    ? { toolName: call.name, truncated: true }
    : { toolName: call.name, resultText: call.result.text };
};

/**
 * The Zerops result carried by one event's `toolCall`, or undefined when the
 * event is not a `zerops_*` call.
 */
export const projectZeropsResult = (event: SpiEvent): ZeropsActivityResult | undefined =>
  projectZeropsToolCall(readZeropsToolCall(event));
