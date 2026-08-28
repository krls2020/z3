/**
 * Is Zerops Code running on this container?
 *
 * Two probes against the container's public origin, both plain header-less
 * GETs with `redirect: "manual"` — any custom header forces a CORS preflight
 * the container's nginx does not answer:
 *
 * - `GET /z3/.well-known/t3/environment` — the z3 server's own environment
 *   document, and the **authority**: if it answers, Zerops Code is up and
 *   reachable, which is the whole question.
 * - `GET /healthz` — `{"initComplete": bool, "initAt": "…"}`, served statically
 *   by nginx outside the code-server cookie gate. Consulted only when the
 *   descriptor does not answer, to tell "still starting" from "this container
 *   predates Zerops Code".
 *
 * The descriptor comes first because it is the one a browser can always read:
 * measured 2026-08-28, `/healthz` carries no `Access-Control-Allow-Origin`, so
 * a cross-origin read of it fails outright, while the z3 descriptor answers
 * `access-control-allow-origin: *`. Ordering it this way means the flow works
 * today and simply gets a sharper "starting" signal once nginx sends the
 * header.
 *
 * Nothing is concluded from a status code alone. A container that predates
 * Zerops Code has neither route, so the cookie gate answers a redirect to
 * `/zcp-login` (measured on two live containers); and under a mis-prefixed
 * proxy the z3 SPA's catch-all turns any path into a valid `200 index.html`.
 * Parse first, then decide.
 */

import { zeropsCodeBaseUrl } from "./candidates";
import type { ZeropsContainerHealth } from "./provisioning";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

type Reading =
  | { readonly kind: "json"; readonly body: Record<string, unknown> }
  /** Answered, but not with the JSON this path is supposed to serve. */
  | { readonly kind: "not-json" }
  /** The cookie gate, or any redirect: this path is not served here. */
  | { readonly kind: "redirect" }
  /** No usable answer — a 5xx, a dead container, or a cross-origin refusal. */
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

/** Whether this document really is a z3 server's, served under the right prefix. */
function isZeropsCodeDescriptor(body: Record<string, unknown>): boolean {
  if (typeof body.environmentId !== "string") return false;
  // Once the server reports its base path, a wrong one means the proxy prefix
  // is mismatched — reachable, but not usable.
  const basePath = body.basePath;
  return typeof basePath === "string" ? basePath === "/z3" : true;
}

export async function probeZeropsContainerHealth(
  origin: string,
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
): Promise<ZeropsContainerHealth> {
  const base = origin.replace(/\/+$/, "");

  const descriptor = await read(`${zeropsCodeBaseUrl(base)}/.well-known/t3/environment`, fetchImpl);
  if (descriptor.kind === "json" && isZeropsCodeDescriptor(descriptor.body)) {
    return "ready";
  }

  const health = await read(`${base}/healthz`, fetchImpl);
  if (health.kind === "json") {
    // zcp is new enough to serve `/healthz`, so a missing z3 is z3 still coming
    // up — never an old container, whatever `initComplete` says.
    return "initializing";
  }
  if (health.kind === "redirect" || health.kind === "not-json") {
    // No `/healthz` either: an older zcp, where a restart is the fix. This must
    // not read as "still starting" — that would poll to a timeout and never
    // offer the one action that works.
    return "predates-z3";
  }

  // `/healthz` could not be read at all. If the descriptor could not be read
  // either, the container itself is away — mid-restart the platform balancer
  // answers 502 for about fourteen seconds.
  return descriptor.kind === "unreachable" ? "unreachable" : "predates-z3";
}
