import { describe, expect, it } from "vite-plus/test";

import { probeZeropsContainerHealth } from "./containerHealth";

const ORIGIN = "https://zcp-26a7-8080.prg1.zerops.app";
const HEALTHZ = `${ORIGIN}/healthz`;
const WELL_KNOWN = `${ORIGIN}/z3/.well-known/t3/environment`;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function html(status = 200): Response {
  return new Response("<!doctype html><title>hi</title>", {
    status,
    headers: { "content-type": "text/html" },
  });
}

/** What a browser hands back for a redirect it was told not to follow. */
function opaqueRedirect(): Response {
  return { type: "opaqueredirect", status: 0, ok: false } as unknown as Response;
}

/** The live payloads, 2026-08-28. */
const LIVE_HEALTHZ = { initComplete: true, initAt: "2026-08-28T15:21:25Z" };
const LIVE_WELL_KNOWN = {
  environmentId: "5779c9c3-4eb9-4872-a37e-c29b287209f6",
  label: "node-id-1.runtime.zcp.zerops",
  platform: { os: "linux", arch: "x64" },
  serverVersion: "0.0.35",
};

function stub(routes: Record<string, () => Response | Promise<Response>>) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  return {
    calls,
    fetch: (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const route = routes[url];
      if (!route) throw new TypeError(`unexpected request: ${url}`);
      return Promise.resolve(route());
    },
  };
}

describe("probeZeropsContainerHealth", () => {
  it("reads a container that is fully up as ready", async () => {
    const spy = stub({
      [HEALTHZ]: () => json(LIVE_HEALTHZ),
      [WELL_KNOWN]: () => json(LIVE_WELL_KNOWN),
    });

    await expect(probeZeropsContainerHealth(ORIGIN, spy.fetch)).resolves.toBe("ready");
  });

  it("asks with nothing that would trigger a CORS preflight the container cannot answer", async () => {
    const spy = stub({
      [HEALTHZ]: () => json(LIVE_HEALTHZ),
      [WELL_KNOWN]: () => json(LIVE_WELL_KNOWN),
    });

    await probeZeropsContainerHealth(ORIGIN, spy.fetch);

    expect(spy.calls).toHaveLength(2);
    for (const call of spy.calls) {
      expect(call.init?.headers).toBeUndefined();
      expect(call.init?.redirect).toBe("manual");
      expect(call.init?.method ?? "GET").toBe("GET");
    }
  });

  it("reads the cookie gate's redirect as a container that predates Zerops Code", async () => {
    // Measured on two live pre-z3 containers: every path, /healthz included,
    // answers 302 to /zcp-login because the location does not exist yet.
    const opaque = stub({ [HEALTHZ]: opaqueRedirect });
    await expect(probeZeropsContainerHealth(ORIGIN, opaque.fetch)).resolves.toBe("predates-z3");

    const seen = stub({
      [HEALTHZ]: () => new Response(null, { status: 302, headers: { location: "/zcp-login" } }),
    });
    await expect(probeZeropsContainerHealth(ORIGIN, seen.fetch)).resolves.toBe("predates-z3");
  });

  it("never trusts a 200 without parsing it", async () => {
    // A mis-prefixed proxy turns any path into the SPA's index.html, which is
    // a perfectly good 200 and a completely wrong answer.
    const spy = stub({ [HEALTHZ]: () => html(200) });
    await expect(probeZeropsContainerHealth(ORIGIN, spy.fetch)).resolves.toBe("predates-z3");

    const missing = stub({ [HEALTHZ]: () => html(404) });
    await expect(probeZeropsContainerHealth(ORIGIN, missing.fetch)).resolves.toBe("predates-z3");
  });

  it("keeps waiting while zcp init has not finished", async () => {
    const spy = stub({ [HEALTHZ]: () => json({ initComplete: false }) });
    await expect(probeZeropsContainerHealth(ORIGIN, spy.fetch)).resolves.toBe("initializing");
  });

  it("keeps waiting when zcp is up but Zerops Code has not answered yet", async () => {
    const notYet = stub({
      [HEALTHZ]: () => json(LIVE_HEALTHZ),
      [WELL_KNOWN]: () => html(404),
    });
    await expect(probeZeropsContainerHealth(ORIGIN, notYet.fetch)).resolves.toBe("initializing");

    // A 200 that is really the SPA shell is the same "not yet".
    const catchAll = stub({
      [HEALTHZ]: () => json(LIVE_HEALTHZ),
      [WELL_KNOWN]: () => html(200),
    });
    await expect(probeZeropsContainerHealth(ORIGIN, catchAll.fetch)).resolves.toBe("initializing");
  });

  it("refuses a server that answers from the wrong base path", async () => {
    const wrong = stub({
      [HEALTHZ]: () => json(LIVE_HEALTHZ),
      [WELL_KNOWN]: () => json({ ...LIVE_WELL_KNOWN, basePath: "/" }),
    });
    await expect(probeZeropsContainerHealth(ORIGIN, wrong.fetch)).resolves.toBe("initializing");

    const right = stub({
      [HEALTHZ]: () => json(LIVE_HEALTHZ),
      [WELL_KNOWN]: () => json({ ...LIVE_WELL_KNOWN, basePath: "/z3" }),
    });
    await expect(probeZeropsContainerHealth(ORIGIN, right.fetch)).resolves.toBe("ready");
  });

  it("reads a restarting container as unreachable, not as broken", async () => {
    // The platform balancer answers 502 for about fourteen seconds after a
    // restart; that is the container coming back, not a failure.
    const balancer = stub({ [HEALTHZ]: () => html(502) });
    await expect(probeZeropsContainerHealth(ORIGIN, balancer.fetch)).resolves.toBe("unreachable");

    const offline = {
      fetch: () => Promise.reject(new TypeError("Failed to fetch")),
    };
    await expect(probeZeropsContainerHealth(ORIGIN, offline.fetch)).resolves.toBe("unreachable");
  });

  it("tolerates a trailing slash on the origin", async () => {
    const spy = stub({
      [HEALTHZ]: () => json(LIVE_HEALTHZ),
      [WELL_KNOWN]: () => json(LIVE_WELL_KNOWN),
    });

    await expect(probeZeropsContainerHealth(`${ORIGIN}/`, spy.fetch)).resolves.toBe("ready");
  });
});
