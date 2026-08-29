/**
 * ProviderRuntimeEventBus - the owned SPI seam for provider runtime events.
 *
 * `apps/server/src/zerops/**` (and, in a future slice, the orchestration
 * reactors that read `ProviderService.streamEvents` today) should depend on
 * this tag instead of reaching into `~/provider/**` directly. `spi/**` is the
 * only owned place allowed to import driver internals — see
 * `docs/internals/zerops/` (SPI plan, D3).
 *
 * This is a THIN wrapper, by measurement (`ProviderRuntimeEventBus.test.ts`,
 * D6): `ProviderService.streamEvents` is already an unbounded, per-access
 * fresh subscription that never drops an accepted event for a live
 * subscriber and never blocks the producer or another subscriber. Adding a
 * second PubSub/bounded buffer here would only make the guarantee WORSE
 * (lossy) while duplicating memory the platform already spends. So `events`
 * forwards the provider stream verbatim — no rebroadcast, no buffering, no
 * drop counter.
 *
 * @module ProviderRuntimeEventBus
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Stream from "effect/Stream";

import { PROVIDER_RUNTIME_SPI_VERSION, type SpiEvent } from "@t3tools/contracts";

import { ProviderService } from "../provider/Services/ProviderService.ts";

export interface ProviderRuntimeEventBusShape {
  /**
   * The SPI version this bus was built against (`providerRuntimeSpi.ts`) — a
   * hook for a future adapter-version gate, not yet read by anything.
   */
  readonly version: typeof PROVIDER_RUNTIME_SPI_VERSION;

  /**
   * The canonical provider runtime event stream, decoupled from
   * `~/provider/**`. Every access is a fresh subscription, exactly as
   * `ProviderService.streamEvents` is today: an event published before a
   * given subscriber starts running is invisible to it, and a subscriber
   * that falls behind is never dropped or blocked against — see the
   * measurement in `ProviderRuntimeEventBus.test.ts`.
   */
  readonly events: Stream.Stream<SpiEvent>;
}

export class ProviderRuntimeEventBus extends Context.Service<
  ProviderRuntimeEventBus,
  ProviderRuntimeEventBusShape
>()("t3/spi/ProviderRuntimeEventBus") {}

export const ProviderRuntimeEventBusLive = Layer.effect(
  ProviderRuntimeEventBus,
  Effect.gen(function* () {
    const provider = yield* ProviderService;
    return {
      version: PROVIDER_RUNTIME_SPI_VERSION,
      events: provider.streamEvents,
    } satisfies ProviderRuntimeEventBusShape;
  }),
);

/**
 * A test double that serves a caller-supplied stream instead of subscribing
 * to a real `ProviderService`. For a test that builds `ZeropsLifecycle.layer`
 * / `ZeropsTopology.layer` directly (rather than calling their `make`
 * escape hatch) and needs `ProviderRuntimeEventBus` satisfied without
 * standing up the provider layer.
 */
export const ProviderRuntimeEventBusTest = {
  make: (events: Stream.Stream<SpiEvent>): Layer.Layer<ProviderRuntimeEventBus> =>
    Layer.succeed(ProviderRuntimeEventBus, {
      version: PROVIDER_RUNTIME_SPI_VERSION,
      events,
    } satisfies ProviderRuntimeEventBusShape),
};
