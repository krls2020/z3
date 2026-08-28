import { assert, describe, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Logger from "effect/Logger";
import * as Ref from "effect/Ref";
import { TestClock } from "effect/testing";

import { ZeropsCliFailed, ZeropsCliNotFound } from "./ZeropsCli.ts";
import { parseZeropsTopology, type ZeropsTopologyRead } from "./zeropsTopologyParse.ts";
import {
  REPOSITORY_CACHE_TTL,
  makeZeropsRepositorySource,
  selectRepositories,
} from "./ZeropsRepositorySource.ts";

/**
 * A `zcp studio topology` payload in the exact shape `ops.DiscoverResult`
 * marshals (`internal/ops/discover.go`): `mountPath` present only for a
 * service whose `/var/www/<hostname>` directory exists on the container.
 */
const topologyRead = (json: string): ZeropsTopologyRead => {
  const parsed = parseZeropsTopology(json);
  assert.isDefined(parsed);
  return parsed;
};

const topology = topologyRead(
  JSON.stringify({
    project: { id: "nTV3oMB2SS634ImDJnQckg", name: "z3-eval", status: "ACTIVE" },
    services: [
      {
        hostname: "kanbandev",
        serviceId: "aaa",
        type: "ubuntu/nodejs@22",
        status: "ACTIVE",
        adoptionState: "adopted",
        isInfrastructure: false,
        mountPath: "/var/www/kanbandev",
      },
      {
        hostname: "apidev",
        serviceId: "bbb",
        type: "ubuntu/go@1.22",
        status: "ACTIVE",
        adoptionState: "adoptable",
        isInfrastructure: false,
        mountPath: "/var/www/apidev",
      },
      {
        hostname: "kanbanstage",
        serviceId: "ccc",
        type: "ubuntu/nodejs@22",
        status: "ACTIVE",
        adoptionState: "adopted",
        isInfrastructure: false,
      },
      {
        hostname: "db",
        serviceId: "ddd",
        type: "postgresql@16",
        status: "ACTIVE",
        adoptionState: "managed-dep",
        isInfrastructure: true,
        mountPath: "/var/www/db",
      },
    ],
  }),
);

/** A reader that answers from a script, counting how often it was consulted. */
const scriptedReader = (
  answers: ReadonlyArray<Effect.Effect<ZeropsTopologyRead, ZeropsCliFailed | ZeropsCliNotFound>>,
) =>
  Effect.gen(function* () {
    const calls = yield* Ref.make(0);
    const read = Effect.gen(function* () {
      const index = yield* Ref.getAndUpdate(calls, (n) => n + 1);
      const answer = answers[Math.min(index, answers.length - 1)];
      assert.isDefined(answer);
      return yield* answer;
    });
    return { read, calls } as const;
  });

describe("selectRepositories — topology JSON to the repository set", () => {
  it("keeps mounted runtimes and drops everything else", () => {
    const result = selectRepositories(topology);
    assert.strictEqual(result._tag, "available");
    if (result._tag !== "available") {
      return;
    }
    assert.deepStrictEqual(result.repositories, [
      { host: "kanbandev", mountPath: "/var/www/kanbandev", remotePath: "/var/www" },
      { host: "apidev", mountPath: "/var/www/apidev", remotePath: "/var/www" },
    ]);
  });

  it("a project with no mounted runtime is available and empty, never unavailable", () => {
    const result = selectRepositories(
      topologyRead(
        JSON.stringify({
          project: { id: "p", name: "p" },
          services: [
            {
              hostname: "db",
              serviceId: "d",
              type: "postgresql@16",
              status: "ACTIVE",
              isInfrastructure: true,
            },
          ],
        }),
      ),
    );
    assert.strictEqual(result._tag, "available");
    if (result._tag === "available") {
      assert.deepStrictEqual(result.repositories, []);
    }
  });

  it("output that is not a topology never reaches the mapper at all", () => {
    // Parsing is zcp's CLI seam now; an unparseable answer is a ZeropsCliFailed
    // before it gets here, which is what the source turns into `unavailable`.
    assert.isUndefined(parseZeropsTopology("auth: no credentials\n"));
  });
});

describe("ZeropsRepositorySource", () => {
  it.effect("is disabled off Zerops and never consults the reader", () =>
    Effect.gen(function* () {
      const reader = yield* scriptedReader([Effect.succeed(topology)]);
      const source = yield* makeZeropsRepositorySource({ enabled: false, read: reader.read });

      const result = yield* source.list;

      assert.strictEqual(result._tag, "disabled");
      assert.strictEqual(yield* Ref.get(reader.calls), 0);
    }),
  );

  it.effect("reads once and serves the cached answer inside the TTL", () =>
    Effect.gen(function* () {
      const reader = yield* scriptedReader([Effect.succeed(topology)]);
      const source = yield* makeZeropsRepositorySource({ enabled: true, read: reader.read });

      yield* source.list;
      yield* TestClock.adjust(Duration.millis(Duration.toMillis(REPOSITORY_CACHE_TTL) - 1));
      const second = yield* source.list;

      assert.strictEqual(second._tag, "available");
      assert.strictEqual(yield* Ref.get(reader.calls), 1);
    }),
  );

  it.effect("re-reads once the TTL has elapsed", () =>
    Effect.gen(function* () {
      const reader = yield* scriptedReader([Effect.succeed(topology)]);
      const source = yield* makeZeropsRepositorySource({ enabled: true, read: reader.read });

      yield* source.list;
      yield* TestClock.adjust(REPOSITORY_CACHE_TTL);
      yield* source.list;

      assert.strictEqual(yield* Ref.get(reader.calls), 2);
    }),
  );

  it.effect("refresh bypasses the TTL", () =>
    Effect.gen(function* () {
      const reader = yield* scriptedReader([Effect.succeed(topology)]);
      const source = yield* makeZeropsRepositorySource({ enabled: true, read: reader.read });

      yield* source.list;
      yield* source.refresh;

      assert.strictEqual(yield* Ref.get(reader.calls), 2);
    }),
  );

  it.effect("a failing topology read degrades to unavailable and names the reason", () =>
    Effect.gen(function* () {
      const reader = yield* scriptedReader([
        Effect.fail(
          new ZeropsCliFailed({ command: "zcp", reason: "zcp studio topology exited 1" }),
        ),
      ]);
      const source = yield* makeZeropsRepositorySource({ enabled: true, read: reader.read });

      const result = yield* source.list;

      assert.strictEqual(result._tag, "unavailable");
      if (result._tag === "unavailable") {
        assert.include(result.reason, "exited 1");
      }
    }),
  );

  it.effect("warns once however often the topology read keeps failing", () => {
    const messages: Array<unknown> = [];
    const logger = Logger.make<unknown, void>((options) => {
      messages.push(options.message);
    });

    return Effect.gen(function* () {
      const reader = yield* scriptedReader([
        Effect.fail(new ZeropsCliFailed({ command: "zcp", reason: "no credentials" })),
      ]);
      const source = yield* makeZeropsRepositorySource({ enabled: true, read: reader.read });

      yield* source.refresh;
      yield* source.refresh;
      yield* source.refresh;

      assert.strictEqual(yield* Ref.get(reader.calls), 3);
      const warnings = messages.filter((message) =>
        JSON.stringify(message ?? "").includes("no credentials"),
      );
      assert.strictEqual(warnings.length, 1);
    }).pipe(Effect.provide(Logger.layer([logger], { mergeWithExisting: false })));
  });

  it.effect("recovers on a later read after an unavailable one", () =>
    Effect.gen(function* () {
      const reader = yield* scriptedReader([
        Effect.fail(new ZeropsCliFailed({ command: "zcp", reason: "boot race" })),
        Effect.succeed(topology),
      ]);
      const source = yield* makeZeropsRepositorySource({ enabled: true, read: reader.read });

      const first = yield* source.list;
      const second = yield* source.refresh;

      assert.strictEqual(first._tag, "unavailable");
      assert.strictEqual(second._tag, "available");
    }),
  );
});
