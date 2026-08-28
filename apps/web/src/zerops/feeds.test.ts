import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId, ThreadId, WS_METHODS } from "@t3tools/contracts";
import type { ZeropsLifecycle, ZeropsTopologySnapshot } from "@t3tools/contracts";
import { EnvironmentRegistry, EnvironmentSupervisor } from "@t3tools/client-runtime/connection";
import { type RpcSession } from "@t3tools/client-runtime/rpc";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";

import { createZeropsFeedAtoms } from "./feeds";

const ENVIRONMENT_ID = EnvironmentId.make("env-zerops-1");
const THREAD_A = ThreadId.make("thread-a");
const THREAD_B = ThreadId.make("thread-b");

const snapshot = (
  services: ReadonlyArray<string>,
  overrides?: Record<string, unknown>,
): ZeropsTopologySnapshot =>
  ({
    available: true,
    degraded: false,
    services: services.map((hostname) => ({
      hostname,
      serviceId: `id-${hostname}`,
      type: "ubuntu/nodejs@22",
      status: "ACTIVE",
      group: "runtimes",
      adoptionState: "adopted",
      isManagedService: false,
      transient: false,
      mounted: true,
    })),
    warnings: [],
    readAt: new Date("2026-08-28T10:00:00Z"),
    ...overrides,
  }) as unknown as ZeropsTopologySnapshot;

const lifecycleOf = (threadId: ThreadId): ZeropsLifecycle =>
  ({ threadId, recentTools: [] }) as unknown as ZeropsLifecycle;

/**
 * A registry whose session can be replaced, which is exactly what a reconnect
 * looks like from below: `subscribeDynamic` follows `supervisor.session` and
 * switch-maps onto the new one.
 *
 * Both feeds are modelled snapshot-then-changes, like the server's own
 * `subscribeBeforeSnapshot`: a subscriber gets the current state at once and
 * every later one after. A plain PubSub would drop whatever was published
 * before the stream attached, and these tests would be racing the runtime
 * rather than testing it.
 */
const makeHarness = Effect.gen(function* () {
  const calls: string[] = [];
  const topologyRef = yield* SubscriptionRef.make(Option.none<ZeropsTopologySnapshot>());
  const lifecycleRef = yield* SubscriptionRef.make(Option.none<ZeropsLifecycle>());

  const makeSession = (): RpcSession => {
    const client = {
      [WS_METHODS.subscribeZeropsTopology]: () => {
        calls.push("topology");
        return SubscriptionRef.changes(topologyRef).pipe(
          Stream.filter(Option.isSome),
          Stream.map((value) => value.value),
        );
      },
      [WS_METHODS.subscribeZeropsLifecycle]: (input: { readonly threadId: string }) => {
        calls.push(`lifecycle:${input.threadId}`);
        return SubscriptionRef.changes(lifecycleRef).pipe(
          Stream.filter(Option.isSome),
          Stream.map((value) => value.value),
          Stream.filter((entry) => entry.threadId === input.threadId),
        );
      },
    } as unknown as RpcSession["client"];
    return {
      client,
      initialConfig: Effect.never,
      ready: Effect.void,
      probe: Effect.void,
      closed: Effect.never,
    } as unknown as RpcSession;
  };

  const session = yield* SubscriptionRef.make(Option.some(makeSession()));
  const supervisor = {
    target: { environmentId: ENVIRONMENT_ID },
    session,
    connect: Effect.void,
    disconnect: Effect.void,
    retryNow: Effect.void,
  } as unknown as EnvironmentSupervisor["Service"];

  const layer = Layer.succeed(EnvironmentRegistry, {
    run: <A, E, R>(_id: EnvironmentId, effect: Effect.Effect<A, E, R>) =>
      Effect.provideService(effect, EnvironmentSupervisor, supervisor),
    runStream: <A, E, R>(_id: EnvironmentId, stream: Stream.Stream<A, E, R>) =>
      Stream.provideService(stream, EnvironmentSupervisor, supervisor),
    // Subscription atoms go through followStream, not runStream: it is what
    // keeps a subscription attached across connection state changes.
    followStream: <A, E, R>(_id: EnvironmentId, stream: Stream.Stream<A, E, R>) =>
      Stream.provideService(stream, EnvironmentSupervisor, supervisor),
  } as unknown as EnvironmentRegistry["Service"]);

  const registry = AtomRegistry.make();
  yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()));

  return {
    calls,
    registry,
    feeds: createZeropsFeedAtoms(Atom.runtime(layer)),
    publishTopology: (value: ZeropsTopologySnapshot) =>
      SubscriptionRef.set(topologyRef, Option.some(value)),
    publishLifecycle: (value: ZeropsLifecycle) =>
      SubscriptionRef.set(lifecycleRef, Option.some(value)),
    /** The socket dropped and came back: a brand-new client for the same environment. */
    reconnect: SubscriptionRef.set(session, Option.some(makeSession())),
  };
});

/** Waits for a condition rather than a fixed delay, so no test sleeps on a guess. */
const until = <A>(read: () => A, holds: (value: A) => boolean): Effect.Effect<A> =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const value = read();
      if (holds(value)) {
        return value;
      }
      yield* Effect.sleep("5 millis");
    }
    return read();
  });

const present = <A>(value: A | undefined): boolean => value !== undefined;

describe("createZeropsFeedAtoms", () => {
  it.live("delivers the topology snapshot the server publishes", () =>
    Effect.gen(function* () {
      const rig = yield* makeHarness;
      const atom = rig.feeds.topologyValue({ environmentId: ENVIRONMENT_ID, input: {} });
      rig.registry.mount(atom);

      yield* rig.publishTopology(snapshot(["kanbandev"]));
      const value = yield* until(() => rig.registry.get(atom), present);

      expect(value?.services.map((service) => service.hostname)).toEqual(["kanbandev"]);
    }).pipe(Effect.scoped),
  );

  it.live("replaces the snapshot on the next publish", () =>
    Effect.gen(function* () {
      const rig = yield* makeHarness;
      const atom = rig.feeds.topologyValue({ environmentId: ENVIRONMENT_ID, input: {} });
      rig.registry.mount(atom);

      yield* rig.publishTopology(snapshot(["kanbandev"]));
      yield* until(() => rig.registry.get(atom), present);
      yield* rig.publishTopology(snapshot(["kanbandev", "kanbanstage"]));

      const value = yield* until(
        () => rig.registry.get(atom),
        (snap) => snap?.services.length === 2,
      );
      expect(value?.services.map((service) => service.hostname)).toEqual([
        "kanbandev",
        "kanbanstage",
      ]);
    }).pipe(Effect.scoped),
  );

  /**
   * The brief requires the feeds to survive a reconnect and re-`get` on connect.
   * They do, but not through anything this file owns: `subscribeDynamic`
   * switch-maps over the supervisor's session, so a new session re-invokes the
   * same RPC — and both Zerops methods answer with a whole snapshot rather than
   * a delta, which is what makes that re-invocation the re-`get`.
   *
   * Pinned rather than assumed, because the failure would be silent: the
   * service map would simply freeze on stale rows after every reconnect.
   */
  it.live("re-subscribes after a reconnect and takes the fresh snapshot", () =>
    Effect.gen(function* () {
      const rig = yield* makeHarness;
      const atom = rig.feeds.topologyValue({ environmentId: ENVIRONMENT_ID, input: {} });
      rig.registry.mount(atom);

      yield* rig.publishTopology(snapshot(["kanbandev"]));
      yield* until(() => rig.registry.get(atom), present);
      expect(rig.calls.filter((call) => call === "topology")).toHaveLength(1);

      yield* rig.reconnect;
      yield* until(
        () => rig.calls.filter((call) => call === "topology").length,
        (count) => count === 2,
      );
      expect(rig.calls.filter((call) => call === "topology")).toHaveLength(2);

      yield* rig.publishTopology(snapshot(["kanbandev", "db"]));
      const value = yield* until(
        () => rig.registry.get(atom),
        (snap) => snap?.services.length === 2,
      );
      expect(value?.services.map((service) => service.hostname)).toEqual(["kanbandev", "db"]);
    }).pipe(Effect.scoped),
  );

  it.live("keeps two threads' lifecycles apart", () =>
    Effect.gen(function* () {
      const rig = yield* makeHarness;
      const first = rig.feeds.lifecycleValue({
        environmentId: ENVIRONMENT_ID,
        input: { threadId: THREAD_A },
      });
      const second = rig.feeds.lifecycleValue({
        environmentId: ENVIRONMENT_ID,
        input: { threadId: THREAD_B },
      });
      rig.registry.mount(first);
      rig.registry.mount(second);

      yield* rig.publishLifecycle(lifecycleOf(THREAD_A));
      const value = yield* until(() => rig.registry.get(first), present);

      expect(value?.threadId).toBe(THREAD_A);
      expect(rig.registry.get(second)).toBeUndefined();
      expect(rig.calls).toContain("lifecycle:thread-a");
      expect(rig.calls).toContain("lifecycle:thread-b");
    }).pipe(Effect.scoped),
  );

  /**
   * `available: false` means "this is not a Zerops environment" — the panel is
   * absent and nothing is wrong. It must reach the UI as a value, never as an
   * error, or a plain T3 environment would grow an error banner.
   */
  it.live("passes an unavailable feed through as a value, not a failure", () =>
    Effect.gen(function* () {
      const rig = yield* makeHarness;
      const atom = rig.feeds.topologyValue({ environmentId: ENVIRONMENT_ID, input: {} });
      rig.registry.mount(atom);

      yield* rig.publishTopology(snapshot([], { available: false, reason: "zcp-not-found" }));
      const value = yield* until(() => rig.registry.get(atom), present);

      expect(value?.available).toBe(false);
      expect(value?.reason).toBe("zcp-not-found");
    }).pipe(Effect.scoped),
  );
});
