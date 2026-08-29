/**
 * claudeProvider — the owned, typed "which model/effort does this Claude
 * turn use" capability. `textGeneration/ClaudeTextGeneration.ts` resolves a
 * `ModelSelection` into the Claude CLI's `--model`/`--effort` flags via
 * catalog/effort logic that `provider/Layers/ClaudeProvider.ts` owns
 * (model capability catalog, CLI effort normalization, the `[1m]` context
 * window model-id suffix).
 *
 * This module wraps exactly the five functions `ClaudeTextGeneration.ts`
 * calls. A port that changes the effort-normalization table or the model
 * catalog lookup fails `claudeProvider.test.ts`, not the `claude -p` spawn
 * call.
 *
 * @module claudeProvider
 */
import type { ModelCapabilities, ModelSelection } from "@t3tools/contracts";

import {
  getClaudeModelCapabilities as driverGetClaudeModelCapabilities,
  isClaudeUltracodeEffort as driverIsClaudeUltracodeEffort,
  normalizeClaudeCliEffort as driverNormalizeClaudeCliEffort,
  resolveClaudeApiModelId as driverResolveClaudeApiModelId,
  resolveClaudeEffort as driverResolveClaudeEffort,
} from "../provider/Layers/ClaudeProvider.ts";

/** Looks up the built-in model catalog entry's capabilities, or a safe default for an unknown/custom model. */
export function getClaudeModelCapabilities(model: string | null | undefined): ModelCapabilities {
  return driverGetClaudeModelCapabilities(model);
}

/** Resolves the effective effort value for a model from its capabilities and a raw selection. */
export function resolveClaudeEffort(
  caps: ModelCapabilities,
  raw: string | null | undefined,
): string | undefined {
  return driverResolveClaudeEffort(caps, raw);
}

/**
 * Normalizes a resolved effort value into one valid for the Claude CLI's
 * `--effort` flag: `ultrathink` is filtered out (a prompt-prefix mode, not a
 * CLI flag), `ultracode` maps to `xhigh`, and `xhigh`/`max` get
 * model-specific compatibility remaps for older models.
 */
export function normalizeClaudeCliEffort(
  effort: string | null | undefined,
  model: string | null | undefined,
): string | undefined {
  return driverNormalizeClaudeCliEffort(effort, model);
}

/** True when the resolved effort is the `ultracode` setting (xhigh effort + multi-agent orchestration). */
export function isClaudeUltracodeEffort(effort: string | null | undefined): boolean {
  return driverIsClaudeUltracodeEffort(effort);
}

/** Resolves the `--model` value: the bare model slug, or `<model>[1m]` when the 1M context window is selected. */
export function resolveClaudeApiModelId(modelSelection: ModelSelection): string {
  return driverResolveClaudeApiModelId(modelSelection);
}
