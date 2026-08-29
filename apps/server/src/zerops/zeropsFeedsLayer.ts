/**
 * The Zerops feeds as one layer, so the server's runtime composition takes a
 * single line for both.
 *
 * The three feeds are independent by design — none imports another, and each
 * subscribes to the provider bus (or the provider registry, for agent auth)
 * on its own — so a failure in one never blanks the others.
 */
import * as Layer from "effect/Layer";

import * as ZeropsThreadLifecycle from "../persistence/ZeropsThreadLifecycle.ts";
import * as ZeropsAgentAuth from "./ZeropsAgentAuth.ts";
import * as ZeropsLifecycle from "./ZeropsLifecycle.ts";
import * as ZeropsTopology from "./ZeropsTopology.ts";

export const ZeropsLayerLive = Layer.mergeAll(
  ZeropsTopology.layer,
  ZeropsLifecycle.layer.pipe(Layer.provide(ZeropsThreadLifecycle.layer)),
  ZeropsAgentAuth.layer,
);
