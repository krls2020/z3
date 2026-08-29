import { describe, expect, it } from "@effect/vitest";

import { ProviderInstanceId } from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";

import {
  getClaudeModelCapabilities,
  isClaudeUltracodeEffort,
  normalizeClaudeCliEffort,
  resolveClaudeApiModelId,
  resolveClaudeEffort,
} from "./claudeProvider.ts";

const INSTANCE_ID = ProviderInstanceId.make("claudeAgent");

describe("getClaudeModelCapabilities", () => {
  it("returns a built-in catalog entry's capabilities for a known model", () => {
    const caps = getClaudeModelCapabilities("claude-fable-5");
    expect(caps.optionDescriptors ?? []).not.toEqual([]);
  });

  it("falls back to the default capabilities (no option descriptors) for an unknown model", () => {
    const caps = getClaudeModelCapabilities("some-future-custom-model");
    expect(caps.optionDescriptors ?? []).toEqual([]);
  });
});

describe("resolveClaudeEffort + normalizeClaudeCliEffort + isClaudeUltracodeEffort", () => {
  it("resolves the ultracode effort selection and maps it to the CLI's xhigh flag", () => {
    const caps = getClaudeModelCapabilities("claude-fable-5");
    const resolved = resolveClaudeEffort(caps, "ultracode");
    expect(resolved).toBe("ultracode");
    expect(isClaudeUltracodeEffort(resolved)).toBe(true);
    expect(normalizeClaudeCliEffort(resolved, "claude-fable-5")).toBe("xhigh");
  });

  it("filters ultrathink out entirely (a prompt-prefix mode, not a CLI flag)", () => {
    expect(normalizeClaudeCliEffort("ultrathink", "claude-fable-5")).toBeUndefined();
  });

  it("keeps xhigh as-is for current flagship models", () => {
    expect(normalizeClaudeCliEffort("xhigh", "claude-fable-5")).toBe("xhigh");
    expect(normalizeClaudeCliEffort("xhigh", "claude-opus-5")).toBe("xhigh");
  });

  it("remaps xhigh to max for models outside the current flagship set", () => {
    expect(normalizeClaudeCliEffort("xhigh", "claude-opus-4-7")).toBe("max");
  });

  it("remaps max to high for claude-sonnet-4-6 only", () => {
    expect(normalizeClaudeCliEffort("max", "claude-sonnet-4-6")).toBe("high");
    expect(normalizeClaudeCliEffort("max", "claude-opus-5")).toBe("max");
  });
});

describe("resolveClaudeApiModelId", () => {
  it("returns the bare model slug for an unknown/custom model (no contextWindow option exists)", () => {
    const modelSelection = createModelSelection(INSTANCE_ID, "some-future-custom-model");
    expect(resolveClaudeApiModelId(modelSelection)).toBe("some-future-custom-model");
  });

  it("appends [1m] for a known model whose contextWindow option defaults to 1m", () => {
    const modelSelection = createModelSelection(INSTANCE_ID, "claude-fable-5");
    expect(resolveClaudeApiModelId(modelSelection)).toBe("claude-fable-5[1m]");
  });

  it("drops the [1m] suffix when the 200k context window is explicitly selected", () => {
    const modelSelection = createModelSelection(INSTANCE_ID, "claude-fable-5", [
      { id: "contextWindow", value: "200k" },
    ]);
    expect(resolveClaudeApiModelId(modelSelection)).toBe("claude-fable-5");
  });
});
