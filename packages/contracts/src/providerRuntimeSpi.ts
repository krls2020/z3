/**
 * The provider runtime SPI — the declared contract between the ported
 * driver zone (`apps/server/src/provider/**`, `./provider*.ts` in this
 * package) and everything owned that consumes provider events
 * (`apps/server/src/spi/**` and, through it, the Zerops feeds).
 *
 * This module re-exports the event union rather than moving or renaming it:
 * `./providerRuntime.ts` stays upstream's file, edited on every port; this
 * file is the one owned place that names a version for what that union
 * currently guarantees.
 *
 * SPI changelog:
 * - 2.0 (2026-08-29, SPI-1): declared. Surface = `ProviderRuntimeEventV2`
 *   (49 `type`-discriminated members) + the `streamEvents` port. No typed
 *   `toolCall` view yet (SPI-4); no versioned adapter gate reads this
 *   constant yet — it exists so a later slice has one to check against.
 *
 * @module providerRuntimeSpi
 */
import type { ProviderRuntimeEvent } from "./providerRuntime.ts";

/**
 * The current SPI version. Bump this — and add a changelog entry above —
 * whenever a change to `ProviderRuntimeEventV2` changes what owned code may
 * depend on (a new member, a renamed field, a narrowed payload shape).
 */
export const PROVIDER_RUNTIME_SPI_VERSION = "2.0";

/**
 * The event type owned code depends on. An alias today; SPI-4 widens it with
 * an owned `toolCall` enrichment field without touching the driver-emitted
 * union underneath.
 */
export type SpiEvent = ProviderRuntimeEvent;
