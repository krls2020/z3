import { assert, describe, it } from "@effect/vitest";

import { makeZeropsOriginAllowlist } from "./origin.ts";
import { resolveZeropsEnvironment } from "./ZeropsEnvironment.ts";

const CONTAINER_ORIGIN = "https://zcp-26a7-8080.prg1.zerops.app";
const CONTAINER_HOST = "zcp-26a7-8080.prg1.zerops.app";

const allowlist = (allowedOrigins: ReadonlyArray<string> = []) =>
  makeZeropsOriginAllowlist(
    resolveZeropsEnvironment({
      projectId: "nTV3oMB2SS634ImDJnQckg",
      apiHost: undefined,
      allowedOrigins,
      membershipTtlSeconds: undefined,
    })!,
  );

describe("allowsOrigin — what a browser may call cross-origin", () => {
  it("allows any localhost port, the product-level dev convenience", () => {
    const { allowsOrigin } = allowlist();
    for (const origin of [
      "http://localhost:5733",
      "http://localhost:1111",
      "https://localhost:8443",
    ]) {
      assert.isTrue(allowsOrigin(origin), origin);
    }
  });

  it("does not extend that to 127.0.0.1 — the trust is on the hostname", () => {
    const { allowsOrigin } = allowlist();
    assert.isFalse(allowsOrigin("http://127.0.0.1:5733"));
  });

  it("rejects a hostname that merely ends in localhost", () => {
    const { allowsOrigin } = allowlist();
    for (const origin of [
      "http://notlocalhost:5733",
      "http://localhost.evil.example",
      "http://evil.example#localhost",
    ]) {
      assert.isFalse(allowsOrigin(origin), origin);
    }
  });

  it("allows the two desktop shell origins", () => {
    const { allowsOrigin } = allowlist();
    assert.isTrue(allowsOrigin("t3code://app"));
    assert.isTrue(allowsOrigin("t3code-dev://app"));
  });

  it("allows a configured extra origin, exactly", () => {
    const { allowsOrigin } = allowlist(["https://app.zerops.io"]);
    assert.isTrue(allowsOrigin("https://app.zerops.io"));
    assert.isFalse(allowsOrigin("https://app.zerops.io.evil.example"));
    assert.isFalse(allowsOrigin("http://app.zerops.io"));
  });

  it("rejects a missing origin — the CORS middleware asks about every request", () => {
    // `allowsOrigin` is handed `request.headers["origin"]` verbatim on every
    // response, not only preflights, so an absent header arrives as undefined.
    const { allowsOrigin } = allowlist();
    assert.isFalse(allowsOrigin(undefined));
  });

  it("rejects everything else, including the container's own origin", () => {
    // Its own origin needs no CORS entry: a client served under /z3/ is
    // same-origin with this API, and same-origin requests are not subject to
    // CORS at all. The upgrade path is where that case is handled.
    const { allowsOrigin } = allowlist();
    for (const origin of ["https://evil.example", CONTAINER_ORIGIN, "null", ""]) {
      assert.isFalse(allowsOrigin(origin), origin);
    }
  });
});

describe("allowsUpgrade — what may open the websocket", () => {
  it("allows a request with no Origin at all", () => {
    // A non-browser caller cannot be cross-site request forged, and every
    // script, the desktop shell and the mobile app arrive this way.
    const { allowsUpgrade } = allowlist();
    assert.isTrue(allowsUpgrade({ origin: undefined, host: CONTAINER_HOST }));
    assert.isTrue(allowsUpgrade({ origin: "", host: CONTAINER_HOST }));
  });

  it("allows the container's own origin, matched against the request host", () => {
    const { allowsUpgrade } = allowlist();
    assert.isTrue(allowsUpgrade({ origin: CONTAINER_ORIGIN, host: CONTAINER_HOST }));
  });

  it("allows the container's own origin behind a proxy that forwards the host", () => {
    const { allowsUpgrade } = allowlist();
    assert.isTrue(
      allowsUpgrade({
        origin: CONTAINER_ORIGIN,
        host: "127.0.0.1:3773",
        forwardedHost: CONTAINER_HOST,
      }),
    );
  });

  it("rejects a foreign origin even when the host matches nothing", () => {
    const { allowsUpgrade } = allowlist();
    assert.isFalse(allowsUpgrade({ origin: "https://evil.example", host: CONTAINER_HOST }));
  });

  it("rejects a foreign origin that only shares a suffix with the host", () => {
    const { allowsUpgrade } = allowlist();
    assert.isFalse(
      allowsUpgrade({ origin: `https://evil.${CONTAINER_HOST}`, host: CONTAINER_HOST }),
    );
  });

  it("still allows localhost and configured origins", () => {
    const { allowsUpgrade } = allowlist(["https://app.zerops.io"]);
    assert.isTrue(allowsUpgrade({ origin: "http://localhost:5733", host: CONTAINER_HOST }));
    assert.isTrue(allowsUpgrade({ origin: "https://app.zerops.io", host: CONTAINER_HOST }));
  });

  it("rejects a malformed origin rather than trying to make sense of it", () => {
    const { allowsUpgrade } = allowlist();
    assert.isFalse(allowsUpgrade({ origin: "not a url", host: CONTAINER_HOST }));
    assert.isFalse(allowsUpgrade({ origin: "null", host: CONTAINER_HOST }));
  });
});
