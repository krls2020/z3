/**
 * The Zerops feeds as one layer, so the server's runtime composition takes a
 * single line for both.
 *
 * The two feeds are independent by design — neither imports the other, and each
 * subscribes to the provider bus on its own — so a failure in one never blanks
 * the other.
 */
import * as Layer from "effect/Layer";

import * as ZeropsThreadLifecycle from "../persistence/ZeropsThreadLifecycle.ts";
import * as ZeropsLifecycle from "./ZeropsLifecycle.ts";
import * as ZeropsTopology from "./ZeropsTopology.ts";

export const ZeropsLayerLive = Layer.mergeAll(
  ZeropsTopology.layer,
  ZeropsLifecycle.layer.pipe(Layer.provide(ZeropsThreadLifecycle.layer)),
);
