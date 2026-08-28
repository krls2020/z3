/**
 * Is Zerops Code running on this container?
 *
 * Two probes against the container's public origin, both plain header-less
 * GETs with `redirect: "manual"` — any custom header forces a CORS preflight
 * the container's nginx does not answer:
 *
 * - `GET /healthz` → `{"initComplete": bool, "initAt": "…"}`, served statically
 *   by nginx outside the code-server cookie gate.
 * - `GET /z3/.well-known/t3/environment` → the z3 server's own environment
 *   document. Zerops Code is up only when this answers JSON.
 *
 * Nothing is concluded from a status code alone. A container that predates
 * Zerops Code has no `/healthz` location, so the cookie gate catches the path
 * and answers a redirect to `/zcp-login` (measured on two live containers,
 * 2026-08-28); and under a mis-prefixed proxy the z3 SPA's catch-all turns any
 * path into a perfectly valid `200 index.html`. Parse first, then decide.
 */

import type { ZeropsContainerHealth } from "./provisioning";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

type Reading =
  | { readonly kind: "json"; readonly body: Record<string, unknown> }
  /** Answered, but not with the JSON this path is supposed to serve. */
  | { readonly kind: "not-json" }
  /** The cookie gate, or any redirect: this path is not served here. */
  | { readonly kind: "redirect" }
  /** No usable answer — mid-restart the platform balancer answers 502. */
  | { readonly kind: "unreachable" };

async function read(url: string, fetchImpl: FetchLike): Promise<Reading> {
  let response: Response;
  try {
    response = await fetchImpl(url, { redirect: "manual" });
  } catch {
    return { kind: "unreachable" };
  }

  // A browser reports a redirect it was told not to follow as an opaque
  // response with status 0; Node hands back the 3xx itself.
  if (response.type === "opaqueredirect") return { kind: "redirect" };
  if (response.status >= 300 && response.status < 400) return { kind: "redirect" };
  if (response.status === 0 || response.status >= 500) return { kind: "unreachable" };
  if (!(response.headers.get("content-type") ?? "").includes("application/json")) {
    return { kind: "not-json" };
  }

  try {
    const body: unknown = await response.json();
    if (!body || typeof body !== "object") return { kind: "not-json" };
    return { kind: "json", body: body as Record<string, unknown> };
  } catch {
    return { kind: "not-json" };
  }
}

export async function probeZeropsContainerHealth(
  origin: string,
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
): Promise<ZeropsContainerHealth> {
  const base = origin.replace(/\/+$/, "");

  const health = await read(`${base}/healthz`, fetchImpl);
  if (health.kind === "unreachable") return "unreachable";
  // No `/healthz` at all — a redirect to the login gate, a 404, or the SPA
  // shell. All mean the container is running an older zcp, and a restart is
  // what fixes it, so this must not read as "still starting": that would poll
  // to a timeout and never offer the one action that works.
  if (health.kind !== "json") return "predates-z3";
  if (health.body.initComplete !== true) return "initializing";

  const environment = await read(`${base}/z3/.well-known/t3/environment`, fetchImpl);
  if (environment.kind === "unreachable") return "unreachable";
  // zcp is new enough to serve `/healthz`, so a missing z3 here is z3 still
  // coming up, never an old container.
  if (environment.kind !== "json") return "initializing";
  if (typeof environment.body.environmentId !== "string") return "initializing";
  // Once the server reports its base path, a wrong one means the proxy prefix
  // is mismatched — reachable, but not usable.
  const basePath = environment.body.basePath;
  if (typeof basePath === "string" && basePath !== "/z3") return "initializing";

  return "ready";
}
