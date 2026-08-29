import { remoteHttpClientLayer } from "@t3tools/client-runtime/rpc";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { FetchHttpClient } from "effect/unstable/http";

import { resolvePrimaryEnvironmentHttpUrl } from "./target";

function isSameOriginBrowserPrimary(): boolean {
  if (
    typeof window === "undefined" ||
    window.desktopBridge !== undefined ||
    !window.location.origin.startsWith("http")
  ) {
    return false;
  }

  return new URL(resolvePrimaryEnvironmentHttpUrl("/")).origin === window.location.origin;
}

export function makePrimaryEnvironmentHttpLayer() {
  return Layer.unwrap(
    Effect.sync(() => {
      const baseLayer = remoteHttpClientLayer(globalThis.fetch);
      // Same-origin browser primaries (self-hosted deployments) authenticate
      // with the session cookie; every other primary target (including the
      // desktop app, which always reaches a primary cross-origin) carries no
      // cookie and no bearer credential here — its auth, if any, is handled
      // by the connection/pairing flow instead.
      return Layer.merge(
        baseLayer,
        Layer.succeed(FetchHttpClient.RequestInit, {
          credentials: isSameOriginBrowserPrimary() ? "include" : "omit",
        }),
      );
    }),
  );
}

export const primaryEnvironmentHttpLayer = makePrimaryEnvironmentHttpLayer();
