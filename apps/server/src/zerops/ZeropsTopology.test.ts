import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import type { ItemLifecyclePayload, SpiEvent } from "@t3tools/contracts";

import { applyToolCall } from "../spi/toolCall.ts";
import { ZeropsCliFailed, ZeropsCliNotFound, type ZeropsCli } from "./ZeropsCli.ts";
import * as ZeropsTopology from "./ZeropsTopology.ts";
import type { ZeropsTopologyRead } from "./zeropsTopologyParse.ts";

const read = (hostnames: ReadonlyArray<string>, status = "ACTIVE"): ZeropsTopologyRead => ({
  project: { id: "proj-1", name: "z3-eval" },
  services: hostnames.map((hostname) => ({
    hostname,
    serviceId: `svc-${hostname}`,
    type: "nodejs@22",
    status,
    group: "runtimes" as const,
    adoptionState: "adopted",
    isManagedService: false,
    transient: status !== "ACTIVE",
    mounted: false,
  })),
  warnings: [],
});

interface FakeCli {
  readonly service: ZeropsCli["Service"];
  readonly reads: Ref.Ref<number>;
  /** Resolved by the fake the first time a doorbell watcher is started. */
  readonly ringDoorbell: (type: string) => Effect.Effect<void>;
  readonly watchStarts: Ref.Ref<number>;
}

const makeFakeCli = (
  answer: (
    attempt: number,
  ) => Effect.Effect<ZeropsTopologyRead, ZeropsCliNotFound | ZeropsCliFailed>,
) =>
  Effect.gen(function* () {
    const reads = yield* Ref.make(0);
    const watchStarts = yield* Ref.make(0);
    const onEventRef = yield* Ref.make<
      ((event: { readonly type: string }) => Effect.Effect<void>) | undefined
    >(undefined);
    const watcherAttached = yield* Deferred.make<void>();
    /** Never resolves — a real watcher runs until the child exits. */
    const watcherRunning = yield* Deferred.make<void>();

    const service: ZeropsCli["Service"] = {
      readTopology: Ref.updateAndGet(reads, (n) => n + 1).pipe(Effect.flatMap(answer)),
      watchDoorbell: (onEvent) =>
        Effect.gen(function* () {
          yield* Ref.update(watchStarts, (n) => n + 1);
          yield* Ref.set(onEventRef, onEvent);
          yield* Deferred.succeed(watcherAttached, undefined);
          yield* Deferred.await(watcherRunning);
        }),
    };

    const ringDoorbell = (type: string) =>
      Deferred.await(watcherAttached).pipe(
        Effect.flatMap(() => Ref.get(onEventRef)),
        Effect.flatMap((onEvent) => (onEvent === undefined ? Effect.void : onEvent({ type }))),
      );

    return { service, reads, ringDoorbell, watchStarts } satisfies FakeCli;
  });

const noToolEvents = Stream.empty as Stream.Stream<SpiEvent>;

/** An enriched (`.toolCall` attached) Claude `item.completed` for one `zerops_*` tool. */
const zeropsToolCompletedEvent = (): SpiEvent =>
  applyToolCall({
    eventId: "evt-1",
    provider: "claudeAgent",
    threadId: "thread-1",
    createdAt: "2026-08-29T00:00:00Z",
    type: "item.completed",
    itemId: "item-1",
    payload: {
      itemType: "mcp_tool_call",
      status: "completed",
      data: {
        toolName: "mcp__zerops__zerops_deploy",
        input: { hostname: "kanbandev" },
        result: {
          type: "tool_result",
          content: [{ type: "text", text: '{"status":"ok"}' }],
        },
      },
    } satisfies ItemLifecyclePayload,
  } as SpiEvent);

/** An enriched non-`zerops_*` tool call — must never nudge the poll. */
const otherToolCompletedEvent = (): SpiEvent =>
  applyToolCall({
    eventId: "evt-2",
    provider: "claudeAgent",
    threadId: "thread-1",
    createdAt: "2026-08-29T00:00:00Z",
    type: "item.completed",
    itemId: "item-2",
    payload: {
      itemType: "command_execution",
      status: "completed",
      data: {
        toolName: "Bash",
        input: { command: "ls" },
        result: { type: "tool_result", content: [{ type: "text", text: "ok" }] },
      },
    } satisfies ItemLifecyclePayload,
  } as SpiEvent);

/** Lets a just-forked fiber run to its first suspension point. */
const advanceTestClock = (ms: number) =>
  TestClock.adjust(`${ms} millis`).pipe(Effect.andThen(Effect.yieldNow));

describe("ZeropsTopology", () => {
  it.effect("publishes a snapshot from the first read", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fake = yield* makeFakeCli(() => Effect.succeed(read(["kanbandev"])));
        const topology = yield* ZeropsTopology.make({
          cli: fake.service,
          toolEvents: noToolEvents,
          isZeropsEnvironment: true,
        });
        const snapshot = yield* topology.latest;
        expect(snapshot.available).toBe(true);
        expect(snapshot.degraded).toBe(false);
        expect(snapshot.services.map((service) => service.hostname)).toEqual(["kanbandev"]);
        expect(snapshot.project?.name).toBe("z3-eval");
      }),
    ),
  );

  it.effect("re-reads when the doorbell rings, and publishes the change", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fake = yield* makeFakeCli((attempt) =>
          Effect.succeed(attempt === 1 ? read(["kanbandev"]) : read(["kanbandev", "db"])),
        );
        const topology = yield* ZeropsTopology.make({
          cli: fake.service,
          toolEvents: noToolEvents,
          isZeropsEnvironment: true,
        });
        const subscription = yield* topology.subscribe;
        expect(subscription.latest.services).toHaveLength(1);

        // Receipt-driven: wait for the published snapshot, never for a clock.
        const nextSnapshot = yield* Stream.runHead(subscription.changes).pipe(Effect.forkChild);
        yield* fake.ringDoorbell("topology-changed");
        const published = yield* Fiber.join(nextSnapshot);

        expect(yield* Ref.get(fake.reads)).toBe(2);
        expect(
          published._tag === "Some"
            ? published.value.services.map((service) => service.hostname)
            : [],
        ).toEqual(["kanbandev", "db"]);
      }),
    ),
  );

  it.effect("never touches zcp outside a Zerops environment", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fake = yield* makeFakeCli(() => Effect.succeed(read(["kanbandev"])));
        const topology = yield* ZeropsTopology.make({
          cli: fake.service,
          toolEvents: noToolEvents,
          isZeropsEnvironment: false,
        });

        const snapshot = yield* topology.latest;
        expect(snapshot.available).toBe(false);
        expect(snapshot.degraded).toBe(false);
        expect(snapshot.reason).toContain("Zerops");

        // Not one spawn: a laptop running T3 has no project to read, so probing
        // for a binary there is work with no possible answer.
        expect(yield* Ref.get(fake.reads)).toBe(0);
        expect(yield* Ref.get(fake.watchStarts)).toBe(0);
        yield* topology.refresh;
        expect(yield* Ref.get(fake.reads)).toBe(0);
      }),
    ),
  );

  it.effect("switches the feed off when zcp is not installed", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fake = yield* makeFakeCli(() =>
          Effect.fail(new ZeropsCliNotFound({ command: "zcp" })),
        );
        const topology = yield* ZeropsTopology.make({
          cli: fake.service,
          toolEvents: noToolEvents,
          isZeropsEnvironment: true,
        });
        const snapshot = yield* topology.latest;
        expect(snapshot.available).toBe(false);
        expect(snapshot.degraded).toBe(false);
        expect(snapshot.reason).toContain("zcp");
        expect(snapshot.services).toEqual([]);

        // No doorbell child on a machine that has no zcp, and a refresh does not
        // try again — this is a non-Zerops environment, not a transient failure.
        expect(yield* Ref.get(fake.watchStarts)).toBe(0);
        yield* topology.refresh;
        expect(yield* Ref.get(fake.reads)).toBe(1);
      }),
    ),
  );

  it.effect("stays available but degraded when zcp is present and failing", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fake = yield* makeFakeCli((attempt) =>
          attempt === 1
            ? Effect.succeed(read(["kanbandev"]))
            : Effect.fail(new ZeropsCliFailed({ command: "zcp", reason: "auth: token expired" })),
        );
        const topology = yield* ZeropsTopology.make({
          cli: fake.service,
          toolEvents: noToolEvents,
          isZeropsEnvironment: true,
        });
        const snapshot = yield* topology.refresh;
        expect(snapshot.available).toBe(true);
        expect(snapshot.degraded).toBe(true);
        expect(snapshot.reason).toContain("auth: token expired");
        // The last good read is kept — blanking the map on a transient failure
        // would be worse than showing state that is a few seconds old.
        expect(snapshot.services.map((service) => service.hostname)).toEqual(["kanbandev"]);
      }),
    ),
  );

  it.effect("recovers from degraded on the next successful read", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fake = yield* makeFakeCli((attempt) =>
          attempt === 2
            ? Effect.fail(new ZeropsCliFailed({ command: "zcp", reason: "boom" }))
            : Effect.succeed(read(["kanbandev"])),
        );
        const topology = yield* ZeropsTopology.make({
          cli: fake.service,
          toolEvents: noToolEvents,
          isZeropsEnvironment: true,
        });
        yield* topology.refresh;
        const recovered = yield* topology.refresh;
        expect(recovered.degraded).toBe(false);
        expect(recovered.reason).toBeUndefined();
      }),
    ),
  );

  it.effect("does not republish an unchanged topology", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fake = yield* makeFakeCli((attempt) =>
          Effect.succeed(attempt <= 3 ? read(["kanbandev"]) : read(["kanbandev", "db"])),
        );
        const topology = yield* ZeropsTopology.make({
          cli: fake.service,
          toolEvents: noToolEvents,
          isZeropsEnvironment: true,
        });
        const subscription = yield* topology.subscribe;
        const firstPublished = yield* Stream.runHead(subscription.changes).pipe(Effect.forkChild);

        // Two reads that find nothing new must not reach a subscriber: only a
        // real change wakes one, or an idle project would repaint the map on
        // every poll. The fourth read differs, and IS the first thing published.
        yield* topology.refresh;
        yield* topology.refresh;
        yield* fake.ringDoorbell("topology-changed");

        const published = yield* Fiber.join(firstPublished);
        expect(yield* Ref.get(fake.reads)).toBe(4);
        expect(
          published._tag === "Some"
            ? published.value.services.map((service) => service.hostname)
            : [],
        ).toEqual(["kanbandev", "db"]);
      }),
    ),
  );
});

describe("ZeropsTopology — the shape ws.ts subscribes through", () => {
  it.effect("keeps pushing after the first frame", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fake = yield* makeFakeCli((attempt) =>
          Effect.succeed(attempt === 1 ? read(["kanbandev"]) : read(["kanbandev", "db"])),
        );
        const topology = yield* ZeropsTopology.make({
          cli: fake.service,
          toolEvents: noToolEvents,
          isZeropsEnvironment: true,
        });

        // Verbatim the expression `ws.ts` hands to `observeRpcStream`. The
        // service's own `subscribe` is already covered above; what this pins is
        // that wrapping it this way does not cut the subscription's lifetime
        // short — the live symptom was exactly one frame and then silence.
        const stream = Stream.unwrap(
          Effect.map(topology.subscribe, ({ latest, changes }) =>
            Stream.concat(Stream.make(latest), changes),
          ),
        );

        const seen = yield* Queue.unbounded<number>();
        yield* Stream.runForEach(stream, (snapshot) =>
          Queue.offer(seen, snapshot.services.length),
        ).pipe(Effect.forkChild);

        // Taking the first frame is the receipt that the subscription is live,
        // so the doorbell below cannot race it. No clock involved.
        expect(yield* Queue.take(seen)).toBe(1);
        yield* fake.ringDoorbell("topology-changed");
        expect(yield* Queue.take(seen)).toBe(2);
      }),
    ),
  );
});

describe("ZeropsTopology — doorbell health on the snapshot", () => {
  it.effect("reports the doorbell down until it connects, then up", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fake = yield* makeFakeCli(() => Effect.succeed(read(["kanbandev"])));
        const topology = yield* ZeropsTopology.make({
          cli: fake.service,
          toolEvents: noToolEvents,
          isZeropsEnvironment: true,
        });

        // Before the watcher says `connected` the feed is polling, and a client
        // deserves to know that rather than trusting a map that may be frozen.
        expect((yield* topology.latest).doorbellConnected).toBe(false);

        yield* fake.ringDoorbell("connected");
        expect((yield* topology.latest).doorbellConnected).toBe(true);
      }),
    ),
  );

  it.effect("republishes when the doorbell drops, so a live map can say it is polling", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fake = yield* makeFakeCli(() => Effect.succeed(read(["kanbandev"])));
        const topology = yield* ZeropsTopology.make({
          cli: fake.service,
          toolEvents: noToolEvents,
          isZeropsEnvironment: true,
        });
        const subscription = yield* topology.subscribe;

        const seen = yield* Queue.unbounded<boolean | undefined>();
        yield* Stream.runForEach(subscription.changes, (snapshot) =>
          Queue.offer(seen, snapshot.doorbellConnected),
        ).pipe(Effect.forkChild);

        yield* fake.ringDoorbell("connected");
        expect(yield* Queue.take(seen)).toBe(true);

        // A drop changes nothing about the services, so without the flag in the
        // published content this transition would never reach a subscriber and
        // the map would keep claiming to be live.
        yield* fake.ringDoorbell("disconnected");
        expect(yield* Queue.take(seen)).toBe(false);
      }),
    ),
  );

  it.effect("says nothing about a doorbell that does not exist", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fake = yield* makeFakeCli(() => Effect.succeed(read(["kanbandev"])));
        const topology = yield* ZeropsTopology.make({
          cli: fake.service,
          toolEvents: noToolEvents,
          isZeropsEnvironment: false,
        });
        // An unavailable feed has no doorbell to report on; `false` would read
        // as "the doorbell is down", which is a different claim.
        expect((yield* topology.latest).doorbellConnected).toBeUndefined();
      }),
    ),
  );
});

describe("ZeropsTopology — more than one subscriber over the server's life", () => {
  it.effect("still pushes to a subscriber that arrives after an earlier one has gone", () =>
    Effect.scoped(
      Effect.gen(function* () {
        // The live server is long-lived: every websocket connection subscribes
        // and its scope closes when the socket does. Every earlier test used a
        // freshly made service with exactly one subscriber, which is the one
        // case that cannot catch a subscription being shared or reused.
        // make() takes read 1; the refresh below takes read 2 and must differ,
        // or there is nothing to publish and the test proves nothing.
        const fake = yield* makeFakeCli((attempt) =>
          Effect.succeed(attempt <= 1 ? read(["kanbandev"]) : read(["kanbandev", "db"])),
        );
        const topology = yield* ZeropsTopology.make({
          cli: fake.service,
          toolEvents: noToolEvents,
          isZeropsEnvironment: true,
        });

        // A first subscriber that comes and goes, like a closed socket.
        yield* Effect.scoped(
          Effect.gen(function* () {
            const first = yield* topology.subscribe;
            expect(first.latest.services).toHaveLength(1);
          }),
        );

        const second = yield* topology.subscribe;
        const seen = yield* Queue.unbounded<number>();
        yield* Stream.runForEach(second.changes, (snapshot) =>
          Queue.offer(seen, snapshot.services.length),
        ).pipe(Effect.forkChild);

        yield* topology.refresh;
        expect(yield* Queue.take(seen)).toBe(2);
      }),
    ),
  );
});

describe("ZeropsTopology — the post-tool nudge (SPI-4: gated on event.toolCall)", () => {
  it.effect("nudges a refresh after a completed zerops_* tool call", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fake = yield* makeFakeCli((attempt) =>
          Effect.succeed(attempt === 1 ? read(["kanbandev"]) : read(["kanbandev", "db"])),
        );
        const toolEvents = yield* Queue.unbounded<SpiEvent>();
        const topology = yield* ZeropsTopology.make({
          cli: fake.service,
          toolEvents: Stream.fromQueue(toolEvents),
          isZeropsEnvironment: true,
        });

        const subscription = yield* topology.subscribe;
        const nextSnapshot = yield* Stream.runHead(subscription.changes).pipe(Effect.forkChild);

        yield* Queue.offer(toolEvents, zeropsToolCompletedEvent());
        const published = yield* Fiber.join(nextSnapshot);

        expect(yield* Ref.get(fake.reads)).toBe(2);
        expect(
          published._tag === "Some"
            ? published.value.services.map((service) => service.hostname)
            : [],
        ).toEqual(["kanbandev", "db"]);
      }),
    ),
  );

  it.effect("does not nudge for a completed tool call that is not zerops_*", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fake = yield* makeFakeCli(() => Effect.succeed(read(["kanbandev"])));
        const toolEvents = yield* Queue.unbounded<SpiEvent>();
        const topology = yield* ZeropsTopology.make({
          cli: fake.service,
          toolEvents: Stream.fromQueue(toolEvents),
          isZeropsEnvironment: true,
        });

        yield* Queue.offer(toolEvents, otherToolCompletedEvent());
        yield* advanceTestClock(50);

        // Only the one read from `make()`'s initial refresh — no nudge fired.
        expect(yield* Ref.get(fake.reads)).toBe(1);
      }),
    ),
  );
});
