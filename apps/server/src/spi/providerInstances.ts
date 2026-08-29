/**
 * The provider-instance capability `apps/server/src/zerops/**` needs — a
 * proper Context.Service, not a bare function, so a caller that `yield*`s
 * it gets an already-resolved capability (`R = never` on every method,
 * exactly like `ZeropsCli`'s own shape) rather than leaking a `ProviderRegistry`
 * requirement into every closure that reaches for it. Keeps providers the
 * ported zone's own concern (methodology §3.2): owned product reaches
 * provider internals only through `spi/**`, never `provider/**` directly —
 * this file is the one place under `spi/` allowed to import
 * `provider/Services/ProviderRegistry.ts`.
 *
 * @module spi/providerInstances
 */
import {
  defaultInstanceIdForDriver,
  ProviderDriverKind,
  type ProviderInstanceId,
  type ZeropsAgentId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ProviderRegistry } from "../provider/Services/ProviderRegistry.ts";

/**
 * `ProviderDriverKind` for each agent's built-in driver
 * (`apps/server/src/provider/Drivers/{Claude,Codex}Driver.ts`'s own
 * `DRIVER_KIND` constants) — Claude Code's driver kind is `"claudeAgent"`,
 * not `"claude-code"` or `"claude"`.
 */
const AGENT_DRIVER_KIND: Readonly<Record<ZeropsAgentId, string>> = {
  "claude-code": "claudeAgent",
  codex: "codex",
};

/**
 * The provider instance `apps/server/src/zerops/**` checks for each agent —
 * the driver's default (single-instance) id, per `defaultInstanceIdForDriver`.
 * A user who configures a SECOND instance of the same driver (e.g.
 * `codex_work`) is not specially handled: the agent-auth feed, like the rest
 * of the §3 credential-probe model, assumes one login per container. Pure —
 * exported separately from the service so it stays directly testable.
 */
export const agentDefaultInstanceId = (agentId: ZeropsAgentId): ProviderInstanceId =>
  defaultInstanceIdForDriver(ProviderDriverKind.make(AGENT_DRIVER_KIND[agentId]));

export class ProviderInstances extends Context.Service<
  ProviderInstances,
  {
    /**
     * Best-effort cache warm for the provider driver picker's own TTL'd
     * cache (`ProviderRegistry.refreshInstance`, targeted to one instance —
     * never the registry-wide refresh, which probes every configured
     * provider). Never a source of truth for anything `zerops/**` reads
     * (`ZeropsAgentAuth.ts`'s own verification owns that); a caller that
     * wants a failure here to never disturb its own check wraps this in
     * `Effect.ignore` itself.
     */
    readonly refreshForAgent: (agentId: ZeropsAgentId) => Effect.Effect<void>;
  }
>()("t3/spi/providerInstances") {}

export const layer = Layer.effect(
  ProviderInstances,
  Effect.gen(function* () {
    const registry = yield* ProviderRegistry;
    return {
      refreshForAgent: (agentId) =>
        registry.refreshInstance(agentDefaultInstanceId(agentId)).pipe(Effect.asVoid),
    } satisfies ProviderInstances["Service"];
  }),
);
