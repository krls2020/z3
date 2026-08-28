import { describe, expect, it } from "@effect/vitest";

import { ZEROPS_RESULT_TEXT_LIMIT, projectZeropsResult } from "./zeropsActivityResult.ts";

/** Claude's `payload.data` — `ClaudeAdapter.ts:2762-2766`. */
const claudeData = (options: {
  readonly toolName?: string;
  readonly content?: unknown;
  readonly started?: boolean;
}): Record<string, unknown> => ({
  toolName: options.toolName ?? "mcp__zerops__zerops_deploy",
  input: { hostname: "kanbandev" },
  ...(options.started === true
    ? {}
    : {
        result: {
          type: "tool_result",
          tool_use_id: "toolu_01",
          content: options.content ?? [{ type: "text", text: '{"status":"DEPLOYED"}' }],
        },
      }),
});

/** Codex's `payload.data` — `CodexAdapter.ts:466-501`. */
const codexData = (options: {
  readonly tool?: string;
  readonly content?: unknown;
  readonly started?: boolean;
}): Record<string, unknown> => ({
  item: {
    type: "mcpToolCall",
    server: "zerops",
    tool: options.tool ?? "zerops_deploy",
    arguments: { hostname: "kanbandev" },
    status: options.started === true ? "inProgress" : "completed",
    ...(options.started === true
      ? {}
      : {
          result: {
            content: options.content ?? [{ type: "text", text: '{"status":"DEPLOYED"}' }],
          },
        }),
  },
});

describe("projectZeropsResult", () => {
  it("carries a Claude zerops result verbatim, tool name normalized", () => {
    const projected = projectZeropsResult(claudeData({}));

    expect(projected?.toolName).toBe("zerops_deploy");
    expect(projected?.resultText).toBe('{"status":"DEPLOYED"}');
    expect(projected?.truncated).toBeUndefined();
  });

  it("carries a Codex zerops result verbatim", () => {
    const projected = projectZeropsResult(codexData({}));

    expect(projected?.toolName).toBe("zerops_deploy");
    expect(projected?.resultText).toBe('{"status":"DEPLOYED"}');
  });

  /**
   * Text split across content blocks is concatenated without a separator: zcp's
   * envelope fence sits at the end of the LAST block and a joiner would corrupt
   * a document split mid-token (`zeropsToolResult.ts:50-55`).
   */
  it("concatenates multi-block text without a separator", () => {
    const projected = projectZeropsResult(
      claudeData({
        content: [
          { type: "text", text: '{"stat' },
          { type: "image", data: "ignored" },
          { type: "text", text: 'us":"DEPLOYED"}' },
        ],
      }),
    );

    expect(projected?.resultText).toBe('{"status":"DEPLOYED"}');
  });

  it("ignores a tool that is not zerops", () => {
    expect(projectZeropsResult(claudeData({ toolName: "Bash" }))).toBeUndefined();
    expect(projectZeropsResult(codexData({ tool: "read_file" }))).toBeUndefined();
  });

  /**
   * The gate is the tool NAME. Claude's `classifyToolItemType` tests `…delete…`
   * before `…mcp…`, so this call arrives typed `file_change` — which is exactly
   * why the projection hook cannot live inside the `mcp_tool_call` branch.
   */
  it("accepts zerops_delete, whose itemType Claude misclassifies", () => {
    const projected = projectZeropsResult(claudeData({ toolName: "mcp__zerops__zerops_delete" }));

    expect(projected?.toolName).toBe("zerops_delete");
  });

  it("reports the tool with no text when the call has not returned yet", () => {
    const projected = projectZeropsResult(claudeData({ started: true }));

    expect(projected?.toolName).toBe("zerops_deploy");
    expect(projected?.resultText).toBeUndefined();
    expect(projected?.truncated).toBeUndefined();
  });

  /**
   * Over the cap the text is DROPPED, never sliced. Half a JSON document parses
   * as nothing, and a card rendering from a truncated document would render a
   * lie; the client degrades to the generic tool block instead.
   */
  it("drops the text whole when it exceeds the cap, and says so", () => {
    const oversized = "x".repeat(ZEROPS_RESULT_TEXT_LIMIT + 1);
    const projected = projectZeropsResult(
      claudeData({ content: [{ type: "text", text: oversized }] }),
    );

    expect(projected?.toolName).toBe("zerops_deploy");
    expect(projected?.resultText).toBeUndefined();
    expect(projected?.truncated).toBe(true);
  });

  it("keeps a result sitting exactly on the cap", () => {
    const exact = "x".repeat(ZEROPS_RESULT_TEXT_LIMIT);
    const projected = projectZeropsResult(claudeData({ content: [{ type: "text", text: exact }] }));

    expect(projected?.resultText).toBe(exact);
    expect(projected?.truncated).toBeUndefined();
  });

  it("ignores anything that is not a data record", () => {
    expect(projectZeropsResult(undefined)).toBeUndefined();
    expect(projectZeropsResult("text")).toBeUndefined();
    expect(projectZeropsResult([])).toBeUndefined();
    expect(projectZeropsResult({})).toBeUndefined();
  });
});
