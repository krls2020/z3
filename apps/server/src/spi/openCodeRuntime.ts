/**
 * openCodeRuntime — the owned, narrow OpenCode capability
 * `textGeneration/OpenCodeTextGeneration.ts` uses, cut down from the
 * driver's full `OpenCodeRuntimeShape` (`provider/opencodeRuntime.ts`,
 * 6 members: server lifecycle, CLI passthrough, and inventory loading).
 * `OpenCodeTextGeneration.ts` only ever spawns/reuses a server
 * (`startOpenCodeServerProcess`) and talks to it over the SDK client
 * (`createOpenCodeSdkClient`) — the other four members (`connectToOpenCodeServer`,
 * `runOpenCodeCommand`, `loadOpenCodeInventory`, `loadInventoryFromCli`) serve
 * other callers and are deliberately NOT part of this capability.
 *
 * `openCodeRuntimeCapability` is an Effect whose R channel is still exactly
 * `OpenCodeRuntime.OpenCodeRuntime` (the driver's own Context.Service tag) —
 * unchanged so that `provider/Drivers/OpenCodeDriver.ts` (ported zone, not
 * touched by this slice) keeps providing it via `OpenCodeRuntimeLive` with
 * zero changes. What's owned is the NARROWING: `OpenCodeTextGeneration.ts`
 * never names the driver's tag or its 6-method shape — it only sees
 * `OpenCodeRuntimeCapability`, so a driver-side rename/removal of one of
 * these two members fails `openCodeRuntime.test.ts`, not the text-generation
 * spawn/prompt call sites.
 *
 * The three parsing/formatting helpers below (`openCodeRuntimeErrorDetail`,
 * `parseOpenCodeModelSlug`, `toOpenCodeFileParts`) are pure logic the driver
 * owns; they're wrapped the same way as the other SPI capability modules.
 *
 * @module openCodeRuntime
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import type { OpencodeClient } from "@opencode-ai/sdk/v2";

import {
  OpenCodeRuntime,
  openCodeRuntimeErrorDetail as driverOpenCodeRuntimeErrorDetail,
  parseOpenCodeModelSlug as driverParseOpenCodeModelSlug,
  toOpenCodeFileParts as driverToOpenCodeFileParts,
  type OpenCodeRuntimeError,
  type ParsedOpenCodeModelSlug,
} from "../provider/opencodeRuntime.ts";

export type { OpenCodeRuntimeError, ParsedOpenCodeModelSlug };

/** A running (or externally-managed) OpenCode server process handle. */
export interface OpenCodeServerProcess {
  readonly url: string;
  readonly exitCode: Effect.Effect<number, never>;
}

/** The narrow OpenCode capability `OpenCodeTextGeneration.ts` depends on. */
export interface OpenCodeRuntimeCapability {
  /**
   * Spawns a local OpenCode server process, bound to the caller's
   * `Scope.Scope`. Callers format the error via `openCodeRuntimeErrorDetail`
   * rather than narrowing on `OpenCodeRuntimeError`'s tag/fields directly.
   */
  readonly startOpenCodeServerProcess: (input: {
    readonly binaryPath: string;
    readonly environment?: NodeJS.ProcessEnv;
  }) => Effect.Effect<OpenCodeServerProcess, OpenCodeRuntimeError, Scope.Scope>;

  /** Builds an OpenCode SDK client bound to a running server's base URL. */
  readonly createOpenCodeSdkClient: (input: {
    readonly baseUrl: string;
    readonly directory: string;
    readonly serverPassword?: string;
  }) => OpencodeClient;
}

function toOpenCodeRuntimeCapability(shape: OpenCodeRuntime["Service"]): OpenCodeRuntimeCapability {
  return {
    startOpenCodeServerProcess: shape.startOpenCodeServerProcess,
    createOpenCodeSdkClient: shape.createOpenCodeSdkClient,
  };
}

/** Resolves the narrow OpenCode capability from the driver's runtime service. */
export const openCodeRuntimeCapability: Effect.Effect<
  OpenCodeRuntimeCapability,
  never,
  OpenCodeRuntime
> = Effect.map(OpenCodeRuntime, toOpenCodeRuntimeCapability);

/**
 * A test double factory: serves a caller-supplied fake `OpenCodeRuntimeCapability`
 * by satisfying the real `OpenCodeRuntime.OpenCodeRuntime` tag underneath it (the
 * four members `OpenCodeTextGeneration.ts` never calls die loudly if exercised —
 * an unexpected new dependency on one of them fails fast instead of silently
 * succeeding). For a test that builds `makeOpenCodeTextGeneration` directly and
 * needs its R channel satisfied without standing up the real OpenCode driver.
 */
export const OpenCodeRuntimeCapabilityTest = {
  make: (capability: OpenCodeRuntimeCapability): Layer.Layer<OpenCodeRuntime> =>
    Layer.succeed(OpenCodeRuntime, {
      startOpenCodeServerProcess: capability.startOpenCodeServerProcess,
      createOpenCodeSdkClient: capability.createOpenCodeSdkClient,
      connectToOpenCodeServer: () =>
        Effect.die("OpenCodeRuntimeCapabilityTest double: connectToOpenCodeServer not configured"),
      runOpenCodeCommand: () =>
        Effect.die("OpenCodeRuntimeCapabilityTest double: runOpenCodeCommand not configured"),
      loadOpenCodeInventory: () =>
        Effect.die("OpenCodeRuntimeCapabilityTest double: loadOpenCodeInventory not configured"),
      loadInventoryFromCli: () =>
        Effect.die("OpenCodeRuntimeCapabilityTest double: loadInventoryFromCli not configured"),
    } satisfies OpenCodeRuntime["Service"]),
};

/** Formats an OpenCode runtime/SDK failure cause into a display-ready detail string. */
export function openCodeRuntimeErrorDetail(cause: unknown): string {
  return driverOpenCodeRuntimeErrorDetail(cause);
}

/** Parses a `provider/model` slug; `null` when the slug is missing or malformed. */
export function parseOpenCodeModelSlug(
  slug: string | null | undefined,
): ParsedOpenCodeModelSlug | null {
  return driverParseOpenCodeModelSlug(slug);
}

/** Converts eligible chat attachments into OpenCode's native file parts. */
export function toOpenCodeFileParts(
  input: Parameters<typeof driverToOpenCodeFileParts>[0],
): ReturnType<typeof driverToOpenCodeFileParts> {
  return driverToOpenCodeFileParts(input);
}
