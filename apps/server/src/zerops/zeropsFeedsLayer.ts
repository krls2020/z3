/**
 * The Zerops feeds as one layer, so the server's runtime composition takes a
 * single line for both.
 *
 * The three feeds are independent by design — none imports another, and each
 * subscribes to the provider bus (or the provider registry, for agent auth)
 * on its own — so a failure in one never blanks the others. `ZeropsAgentLogin`
 * (S7 follow-up F8) is the one exception: it calls `ZeropsAgentAuth.recheckNow`
 * on a login success, so it `provideMerge`s that layer rather than depending
 * on a second, separately-constructed instance — `ws.ts` and this module end
 * up sharing the SAME `ZeropsAgentAuth` service.
 */
import * as Layer from "effect/Layer";

import * as ZeropsThreadLifecycle from "../persistence/ZeropsThreadLifecycle.ts";
import { layer as providerInstancesLayer } from "../spi/providerInstances.ts";
import * as ZeropsAgentAuth from "./ZeropsAgentAuth.ts";
import * as ZeropsAgentLoginModule from "./ZeropsAgentLogin.ts";
import * as ZeropsLifecycle from "./ZeropsLifecycle.ts";
import * as ZeropsTopology from "./ZeropsTopology.ts";

/**
 * `ZeropsAgentAuth.layer` reaches provider internals only through
 * `ProviderInstances` (`spi/providerInstances.ts`) — discharged here rather
 * than in `ZeropsAgentAuth.ts` itself, leaving `ProviderRegistry` (which
 * `ProviderInstances.layer` still requires) to bubble up and be satisfied by
 * the SAME shared, memoized instance `server.ts`'s runtime composition
 * already provides everywhere else (never a second provider registry).
 */
const ZeropsAgentAuthLive = ZeropsAgentAuth.layer.pipe(Layer.provide(providerInstancesLayer));

export const ZeropsLayerLive = Layer.mergeAll(
  ZeropsTopology.layer,
  ZeropsLifecycle.layer.pipe(Layer.provide(ZeropsThreadLifecycle.layer)),
  ZeropsAgentLoginModule.layer.pipe(Layer.provideMerge(ZeropsAgentAuthLive)),
);
