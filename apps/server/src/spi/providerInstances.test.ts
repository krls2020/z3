import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import { ProviderRegistry } from "../provider/Services/ProviderRegistry.ts";
import { agentDefaultInstanceId, layer, ProviderInstances } from "./providerInstances.ts";

describe("agentDefaultInstanceId", () => {
  it("maps claude-code to the claudeAgent driver's default instance", () => {
    expect(agentDefaultInstanceId("claude-code")).toBe("claudeAgent");
  });

  it("maps codex to the codex driver's default instance", () => {
    expect(agentDefaultInstanceId("codex")).toBe("codex");
  });
});

describe("ProviderInstances.layer", () => {
  it.effect("refreshForAgent calls the registry with the agent's default instance id", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make<ReadonlyArray<string>>([]);
      const fakeRegistry = Layer.mock(ProviderRegistry)({
        getProviders: Effect.succeed([]),
        refreshInstance: (instanceId: string) =>
          Ref.update(calls, (all) => [...all, instanceId]).pipe(Effect.as([])),
      });

      const instances = yield* ProviderInstances.pipe(
        Effect.provide(layer.pipe(Layer.provide(fakeRegistry))),
      );
      yield* instances.refreshForAgent("claude-code");
      yield* instances.refreshForAgent("codex");

      expect(yield* Ref.get(calls)).toEqual(["claudeAgent", "codex"]);
    }),
  );
});
