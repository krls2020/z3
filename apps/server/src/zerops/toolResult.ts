/**
 * Recognises a `zerops_*` MCP tool call inside a provider runtime item event,
 * and pulls the result text out of it.
 *
 * Every provider's tool results reach one bus unmodified
 * (`ProviderService.streamEvents`), but the two adapters put different shapes in
 * `payload.data`:
 *
 * - Claude — `{toolName, input, result}`, `result` being the raw Anthropic
 *   `tool_result` block (`ClaudeAdapter.ts:2762-2766`, built at `:1501-1546`).
 * - Codex — the raw `V2ItemCompletedNotification`, whose `item` is the
 *   `mcpToolCall` variant (`CodexAdapter.ts:466-501`).
 *
 * The dispatch below is SHAPE-driven, not provider-driven: a third adapter that
 * mirrors either shape works without a change here, and nothing keys on a
 * provider name that could be renamed.
 */
import type { ItemLifecyclePayload } from "@t3tools/contracts";

/** Tool names ZCP exposes over MCP all start with this. */
const ZEROPS_TOOL_PREFIX = "zerops_";

/** Claude's SDK prefixes MCP tools with `mcp__<server>__`; Codex reports the bare name. */
const MCP_PREFIX_PATTERN = /^mcp__[^_]+(?:_[^_]+)*?__/;

export interface ZeropsToolCall {
  /** Tool name without the `mcp__<server>__` prefix, e.g. `zerops_workflow`. */
  readonly toolName: string;
  /** The name exactly as the provider reported it. */
  readonly rawToolName: string;
  /**
   * Concatenated text of the tool result, or undefined when the event carries
   * no result yet (`item.started`).
   */
  readonly resultText: string | undefined;
  readonly failed: boolean;
}

export const normalizeZeropsToolName = (raw: string): string => raw.replace(MCP_PREFIX_PATTERN, "");

export const isZeropsToolName = (raw: string): boolean =>
  normalizeZeropsToolName(raw).startsWith(ZEROPS_TOOL_PREFIX);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

/**
 * MCP result content is an array of content blocks; only the text ones carry the
 * result. Claude also permits a bare string. Blocks are concatenated in order —
 * zcp's envelope block is at the end of the LAST text block, and joining with a
 * separator would corrupt a result split across blocks.
 */
const readContentText = (content: unknown): string | undefined => {
  const asString = readString(content);
  if (asString !== undefined) {
    return asString;
  }
  if (!Array.isArray(content)) {
    return undefined;
  }
  let text = "";
  for (const block of content) {
    if (isRecord(block) && block.type === "text") {
      text += readString(block.text) ?? "";
    }
  }
  return text;
};

/** Claude: `data = {toolName, input, result?}`. */
const readClaudeShape = (data: Record<string, unknown>): ZeropsToolCall | undefined => {
  const rawToolName = readString(data.toolName);
  if (rawToolName === undefined || !isZeropsToolName(rawToolName)) {
    return undefined;
  }
  const result = isRecord(data.result) ? data.result : undefined;
  return {
    toolName: normalizeZeropsToolName(rawToolName),
    rawToolName,
    resultText: result === undefined ? undefined : readContentText(result.content),
    failed: result?.is_error === true,
  };
};

/** Codex: `data = {item: {type: "mcpToolCall", server, tool, result?, error?, status}}`. */
const readCodexShape = (data: Record<string, unknown>): ZeropsToolCall | undefined => {
  const item = isRecord(data.item) ? data.item : undefined;
  if (item === undefined || item.type !== "mcpToolCall") {
    return undefined;
  }
  const rawToolName = readString(item.tool);
  if (rawToolName === undefined || !isZeropsToolName(rawToolName)) {
    return undefined;
  }
  const result = isRecord(item.result) ? item.result : undefined;
  return {
    toolName: normalizeZeropsToolName(rawToolName),
    rawToolName,
    resultText: result === undefined ? undefined : readContentText(result.content),
    failed: item.error != null || item.status === "failed",
  };
};

/**
 * The `zerops_*` tool call this item event describes, or undefined when it is
 * not one.
 *
 * The gate is the TOOL NAME, never `payload.itemType`. Claude's
 * `classifyToolItemType` (`ClaudeAdapter.ts:736-771`) is an ordered substring
 * match that tests `…delete…` before `…mcp…`, so `mcp__zerops__zerops_delete`
 * arrives typed `file_change`; an `itemType` gate would drop it, and every
 * future zerops tool whose name happens to contain create/edit/write/file.
 */
export const readZeropsToolCall = (payload: ItemLifecyclePayload): ZeropsToolCall | undefined => {
  const data: unknown = payload.data;
  if (!isRecord(data)) {
    return undefined;
  }
  const call = readClaudeShape(data) ?? readCodexShape(data);
  if (call === undefined) {
    return undefined;
  }
  return payload.status === "failed" && !call.failed ? { ...call, failed: true } : call;
};
