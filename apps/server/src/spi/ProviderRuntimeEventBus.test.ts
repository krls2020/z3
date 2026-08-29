/**
 * Measurement: today's delivery semantics of the provider runtime event
 * fan-out, before anything wraps it.
 *
 * `ProviderService.ts:234` creates exactly ONE `PubSub.unbounded<ProviderRuntimeEvent>()`
 * for the life of the service, and `ProviderService.ts:1232-1236` hands every
 * caller of the `streamEvents` getter a FRESH `Stream.fromPubSub(pubsub)` — a
 * brand-new subscription, not a shared one (the comment there says as much:
 * "Each access creates a fresh PubSub subscription"). No adapter/registry
 * logic sits between the pubsub and the getter, so reproducing that
 * construction verbatim (below, `makeFanOut`) measures the real mechanism,
 * not a stand-in for it.
 *
 * Measured, at runtime, in this file:
 *
 * 1. The pubsub's capacity is `Number.MAX_SAFE_INTEGER` — Effect's
 *    `unbounded` strategy. `PubSub.publish` never blocks on it and a
 *    subscriber's queue never drops an accepted message.
 * 2. A subscription only begins when the stream returned by `streamEvents`
 *    is actually RUN (Effect streams are lazy descriptions), not when the
 *    getter is merely read. An event published before that run starts is
 *    invisible to it — there is no replay buffer. This is the real loss
 *    mode: `CheckpointReactor.ts:923`'s "does not reliably deliver" is a
 *    late-subscription race, not a drop.
 * 3. A subscriber that stops pulling (falls behind) does not block the
 *    producer or any other, already-subscribed, consumer — publish keeps
 *    completing immediately — and loses nothing: every event it didn't yet
 *    take is still waiting for it, in order, once it resumes.
 *
 * Conclusion for D6 (corrected 2026-08-29): the existing fan-out is already
 * lossless and non-blocking for a slow subscriber, for as long as that
 * subscriber's fiber is alive. `ProviderRuntimeEventBus` is therefore a thin
 * wrapper that preserves exactly this — no bounded per-subscriber buffer, no
 * drop counter. Building one would be inventing a *worse* guarantee (lossy)
 * than what the reactor's own subscribers already get today.
 */
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

interface FakeEvent {
  readonly id: number;
}

/** Lets a just-forked fiber run to its first suspension point. */
const advanceTestClock = (ms: number) =>
  TestClock.adjust(`${ms} millis`).pipe(Effect.andThen(Effect.yieldNow));

/**
 * Reproduces `ProviderService.ts:234` (pubsub creation) and its
 * `streamEvents` getter at `:1232-1236` verbatim in shape: one unbounded
 * pubsub, and a getter that returns a fresh `Stream.fromPubSub` every time
 * it is read.
 */
const makeFanOut = Effect.gen(function* () {
  const runtimeEventPubSub = yield* PubSub.unbounded<FakeEvent>();
  return {
    emit: (event: FakeEvent) => PubSub.publish(runtimeEventPubSub, event),
    get streamEvents(): Stream.Stream<FakeEvent> {
      return Stream.fromPubSub(runtimeEventPubSub);
    },
    capacity: PubSub.capacity(runtimeEventPubSub),
  };
});

describe("ProviderService's runtime-event fan-out (today's semantics, measured directly)", () => {
  it.effect("the pubsub backing streamEvents has unbounded capacity", () =>
    Effect.gen(function* () {
      const fanOut = yield* makeFanOut;
      expect(fanOut.capacity).toBe(Number.MAX_SAFE_INTEGER);
    }),
  );

  it.effect(
    "an event published before a subscriber starts running is invisible to it (no replay)",
    () =>
      Effect.gen(function* () {
        const fanOut = yield* makeFanOut;

        // Published before anyone has started running `streamEvents` — a
        // subscription does not exist yet to receive it.
        yield* fanOut.emit({ id: 1 });

        const receivedRef = yield* Ref.make<ReadonlyArray<FakeEvent>>([]);
        const consumer = yield* Stream.runForEach(fanOut.streamEvents, (event) =>
          Ref.update(receivedRef, (current) => [...current, event]),
        ).pipe(Effect.forkChild);
        yield* advanceTestClock(50);

        yield* fanOut.emit({ id: 2 });
        yield* advanceTestClock(50);

        yield* Fiber.interrupt(consumer);
        const received = yield* Ref.get(receivedRef);
        // Only the event published AFTER the stream started running arrived.
        expect(received).toEqual([{ id: 2 }]);
      }),
  );

  it.effect(
    "a subscriber that stops pulling never blocks the producer or another subscriber, and loses nothing once it resumes",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const runtimeEventPubSub = yield* PubSub.unbounded<FakeEvent>();

          // Subscriber A: subscribes and drains continuously, never falling behind.
          const subscriptionA = yield* PubSub.subscribe(runtimeEventPubSub);
          const receivedByA = yield* Ref.make<ReadonlyArray<FakeEvent>>([]);
          const consumerA = yield* PubSub.take(subscriptionA)
            .pipe(
              Effect.tap((event) => Ref.update(receivedByA, (current) => [...current, event])),
              Effect.forever,
            )
            .pipe(Effect.forkChild);

          // Subscriber B: subscribes too (so it is not the no-replay case
          // above) but never takes anything — it has fallen behind.
          const subscriptionB = yield* PubSub.subscribe(runtimeEventPubSub);
          yield* advanceTestClock(50);

          // The producer publishes five events in a plain loop. None of
          // these `publish` calls waits on B — an unbounded pubsub accepts
          // every publish immediately regardless of subscriber state.
          const events: ReadonlyArray<FakeEvent> = Array.from({ length: 5 }, (_unused, index) => ({
            id: index + 1,
          }));
          for (const event of events) {
            yield* PubSub.publish(runtimeEventPubSub, event);
            yield* advanceTestClock(1);
          }
          yield* advanceTestClock(50);

          // A, which kept up, already has all five — B's stall never blocked it.
          expect(yield* Ref.get(receivedByA)).toEqual(events);
          yield* Fiber.interrupt(consumerA);

          // B never took a single one, but none were dropped: draining its
          // subscription now returns every one of them, in the order they
          // were published.
          const drained: FakeEvent[] = [];
          for (let index = 0; index < events.length; index += 1) {
            drained.push(yield* PubSub.take(subscriptionB));
          }
          expect(drained).toEqual(events);
        }),
      ),
  );
});
