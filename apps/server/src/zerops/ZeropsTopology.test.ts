import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import type { ProviderRuntimeEvent } from "@t3tools/contracts";

import { ZeropsCliFailed, ZeropsCliNotFound, type ZeropsCli } from "./ZeropsCli.ts";
import * as ZeropsTopology from "./ZeropsTopology.ts";
import type { ZeropsTopologyRead } from "./topologyParse.ts";

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

const noToolEvents = Stream.empty as Stream.Stream<ProviderRuntimeEvent>;

describe("ZeropsTopology", () => {
  it.effect("publishes a snapshot from the first read", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fake = yield* makeFakeCli(() => Effect.succeed(read(["kanbandev"])));
        const topology = yield* ZeropsTopology.make({
          cli: fake.service,
          toolEvents: noToolEvents,
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

  it.effect("switches the feed off when zcp is not installed", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fake = yield* makeFakeCli(() =>
          Effect.fail(new ZeropsCliNotFound({ command: "zcp" })),
        );
        const topology = yield* ZeropsTopology.make({
          cli: fake.service,
          toolEvents: noToolEvents,
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
