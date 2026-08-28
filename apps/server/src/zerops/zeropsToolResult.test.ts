import { describe, expect, it } from "@effect/vitest";

import type { ItemLifecyclePayload } from "@t3tools/contracts";

import {
  isZeropsToolName,
  normalizeZeropsToolName,
  readZeropsToolCall,
} from "./zeropsToolResult.ts";

/**
 * Claude's shape — `ClaudeAdapter.ts:2762-2766`: `data = {toolName, input, result}`
 * where `result` is the raw Anthropic `tool_result` block assembled at
 * `ClaudeAdapter.ts:1501-1546`. `itemType` comes from `classifyToolItemType`,
 * which is an ORDERED substring match on the tool name — see the `zerops_delete`
 * case below.
 */
const claudePayload = (options: {
  readonly toolName?: string;
  readonly itemType?: ItemLifecyclePayload["itemType"];
  readonly content?: unknown;
  readonly isError?: boolean;
  readonly started?: boolean;
}): ItemLifecyclePayload =>
  ({
    itemType: options.itemType ?? "mcp_tool_call",
    status:
      options.started === true ? "inProgress" : options.isError === true ? "failed" : "completed",
    title: "zerops",
    data: {
      toolName: options.toolName ?? "mcp__zerops__zerops_workflow",
      input: { action: "status" },
      ...(options.started === true
        ? {}
        : {
            result: {
              type: "tool_result",
              tool_use_id: "toolu_01",
              content: options.content ?? [{ type: "text", text: "## Status\n" }],
              ...(options.isError === true ? { is_error: true } : {}),
            },
          }),
    },
  }) as ItemLifecyclePayload;

/**
 * Codex's shape — `CodexAdapter.ts:466-501`: `data` is the raw
 * `V2ItemCompletedNotification`, whose `item` is the `mcpToolCall` variant from
 * `schema.gen.ts:20433-20445`. `server` is the MCP server, `tool` the bare name.
 */
const codexPayload = (options: {
  readonly tool?: string;
  readonly content?: ReadonlyArray<unknown>;
  readonly failed?: boolean;
  readonly started?: boolean;
  readonly itemType?: ItemLifecyclePayload["itemType"];
}): ItemLifecyclePayload =>
  ({
    itemType: options.itemType ?? "mcp_tool_call",
    status:
      options.started === true ? "inProgress" : options.failed === true ? "failed" : "completed",
    title: `zerops · ${options.tool ?? "zerops_workflow"}`,
    data: {
      item: {
        id: "item_01",
        type: "mcpToolCall",
        server: "zerops",
        tool: options.tool ?? "zerops_workflow",
        arguments: { action: "status" },
        status:
          options.started === true
            ? "inProgress"
            : options.failed === true
              ? "failed"
              : "completed",
        ...(options.started === true
          ? {}
          : {
              result: { content: options.content ?? [{ type: "text", text: "## Status\n" }] },
            }),
        ...(options.failed === true ? { error: { message: "tool failed" } } : {}),
      },
    },
  }) as ItemLifecyclePayload;

describe("normalizeZeropsToolName", () => {
  it.each([
    ["mcp__zerops__zerops_workflow", "zerops_workflow"],
    ["mcp__t3-code__browser_open", "browser_open"],
    ["zerops_deploy", "zerops_deploy"],
    ["Bash", "Bash"],
  ])("strips the mcp server prefix from %s", (raw, expected) => {
    expect(normalizeZeropsToolName(raw)).toBe(expected);
  });
});

describe("isZeropsToolName", () => {
  it.each(["mcp__zerops__zerops_workflow", "zerops_deploy", "mcp__anything__zerops_import"])(
    "accepts %s",
    (raw) => {
      expect(isZeropsToolName(raw)).toBe(true);
    },
  );

  it.each(["Bash", "mcp__t3-code__browser_open", "zeropsish", "", "mcp__zerops__other_tool"])(
    "rejects %s",
    (raw) => {
      expect(isZeropsToolName(raw)).toBe(false);
    },
  );
});

describe("readZeropsToolCall — Claude", () => {
  it("reads the tool name and the result text", () => {
    const call = readZeropsToolCall(
      claudePayload({ content: [{ type: "text", text: "## Status\n\nPhase: idle\n" }] }),
    );
    expect(call?.toolName).toBe("zerops_workflow");
    expect(call?.rawToolName).toBe("mcp__zerops__zerops_workflow");
    expect(call?.resultText).toBe("## Status\n\nPhase: idle\n");
    expect(call?.failed).toBe(false);
  });

  it("accepts a bare string result content", () => {
    const call = readZeropsToolCall(claudePayload({ content: "plain text result" }));
    expect(call?.resultText).toBe("plain text result");
  });

  it("concatenates several text blocks in order", () => {
    const call = readZeropsToolCall(
      claudePayload({
        content: [
          { type: "text", text: "first" },
          { type: "image", source: {} },
          { type: "text", text: "second" },
        ],
      }),
    );
    expect(call?.resultText).toBe("firstsecond");
  });

  it("marks an errored result as failed", () => {
    expect(readZeropsToolCall(claudePayload({ isError: true }))?.failed).toBe(true);
  });

  it("reads a started call, which carries no result", () => {
    const call = readZeropsToolCall(claudePayload({ started: true }));
    expect(call?.toolName).toBe("zerops_workflow");
    expect(call?.resultText).toBeUndefined();
  });

  it("accepts zerops_delete even though Claude types it as a file change", () => {
    // `classifyToolItemType` (ClaudeAdapter.ts:736-771) tests `…delete…` BEFORE
    // `…mcp…`, so `mcp__zerops__zerops_delete` never arrives as
    // `mcp_tool_call`. Gating the reducer on `itemType` would silently drop it,
    // and every future zerops tool whose name contains create/edit/write/file.
    const call = readZeropsToolCall(
      claudePayload({ toolName: "mcp__zerops__zerops_delete", itemType: "file_change" }),
    );
    expect(call?.toolName).toBe("zerops_delete");
  });
});

describe("readZeropsToolCall — Codex", () => {
  it("reads the tool name and the result text", () => {
    const call = readZeropsToolCall(
      codexPayload({ content: [{ type: "text", text: "## Status\n\nPhase: idle\n" }] }),
    );
    expect(call?.toolName).toBe("zerops_workflow");
    expect(call?.rawToolName).toBe("zerops_workflow");
    expect(call?.resultText).toBe("## Status\n\nPhase: idle\n");
    expect(call?.failed).toBe(false);
  });

  it("marks an errored call as failed", () => {
    expect(readZeropsToolCall(codexPayload({ failed: true }))?.failed).toBe(true);
  });

  it("reads a started call, which carries no result", () => {
    const call = readZeropsToolCall(codexPayload({ started: true }));
    expect(call?.toolName).toBe("zerops_workflow");
    expect(call?.resultText).toBeUndefined();
  });
});

describe("readZeropsToolCall — not a Zerops tool call", () => {
  it.each([
    ["a non-zerops MCP tool", claudePayload({ toolName: "mcp__t3-code__browser_open" })],
    ["a native Claude tool", claudePayload({ toolName: "Bash", itemType: "command_execution" })],
    ["a non-zerops Codex tool", codexPayload({ tool: "browser_open" })],
    ["a payload with no data", { itemType: "mcp_tool_call" } as ItemLifecyclePayload],
    [
      "a payload whose data is not an object",
      { itemType: "mcp_tool_call", data: 7 } as ItemLifecyclePayload,
    ],
    [
      "a Codex item that is not an mcpToolCall",
      {
        itemType: "dynamic_tool_call",
        data: {
          item: { id: "i", type: "dynamicToolCall", tool: "zerops_workflow", arguments: {} },
        },
      } as ItemLifecyclePayload,
    ],
  ])("returns undefined for %s", (_label, payload) => {
    expect(readZeropsToolCall(payload)).toBeUndefined();
  });
});
