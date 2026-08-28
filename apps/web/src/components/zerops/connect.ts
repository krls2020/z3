/**
 * The one-click connect sequence for a `ready` Zerops candidate (C2 in the
 * team-lead's brief): read the zcp service's `VSCODE_PASSWORD`, mint a
 * pairing credential from the container itself, then register it through
 * the existing pairing path — no new connection type, no terminal, no
 * human copying a code out of an SSH session.
 *
 * The mint endpoint (`GET {mintOrigin}/z3-pair/{password}`) is being built
 * in parallel in the `zcp` repo and had not landed on any real container as
 * of this writing (see docs/internals/zerops/hacks.md H-02/H-03/H-05) —
 * **this module has never successfully completed a real connect and cannot
 * be end-to-end tested here.** Every failure path below is written against
 * `zcp`'s actual (in-progress) design, not guessed at:
 *  - nginx omits the whole `/z3-pair` location when the container has no
 *    `VSCODE_PASSWORD` set, so the request falls through to the catch-all
 *    `location /` and 302-redirects to `/zcp-login` — measured against the
 *    scratch `z3probe` container, which predates the endpoint entirely
 *    (verified.md, 2026-08-27).
 *  - a literal `404` comes from `z3sidecar` itself refusing to mint (H-02's
 *    belt-and-suspenders check), which per H-02 means "no `VSCODE_PASSWORD`
 *    configured" even if nginx's location block exists.
 *  - a `502` means nginx's upstream, `z3sidecar` on `127.0.0.1:3774`, isn't
 *    running — plausibly H-05's residual manual-bootstrap gap (nobody has
 *    SSHed in to run `zcp init z3sidecar` on this container yet).
 *  - `/healthz` (H-07) always answers `200` with `{initComplete, z3Up}` on
 *    an updated container; anything else (redirect, non-2xx, unparsable
 *    body) means an older container, and is degraded to `"unknown"` rather
 *    than blocking the attempt.
 */

import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommand,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";

import { connectPairing as connectPairingAtom } from "~/connection/onboarding";
import { fetchZcpVscodePassword } from "~/zerops/api";
import type { ZeropsCandidate } from "~/zerops/candidates";

// Derived from the actual `connectPairing` atom's `AtomCommand<W, A, E>` type
// rather than restated, so a signature change there can't silently drift here.
export type ConnectPairingCommand =
  typeof connectPairingAtom extends AtomCommand<infer W, infer A, infer E>
    ? (input: W) => Promise<AtomCommandResult<A, E>>
    : never;

interface Z3PairingMint {
  readonly credential: string;
  readonly expiresAt?: string;
  readonly origin: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * `GET {mintOrigin}/z3-pair/{password}` → `{credential, expiresAt, origin}`.
 * A plain, header-less GET, as specified — a custom header would force a
 * CORS preflight the container doesn't answer. `redirect: "manual"` is used
 * deliberately: a cross-origin fetch that *follows* a same-origin redirect
 * to an uncooperative page (measured: `/zcp-login`, no CORS headers) throws
 * before we ever see a status code, which is a worse error message than
 * catching the redirect itself.
 */
async function mintZ3Pairing(mintOrigin: string, password: string): Promise<Z3PairingMint> {
  let response: Response;
  try {
    response = await fetch(`${mintOrigin}/z3-pair/${encodeURIComponent(password)}`, {
      redirect: "manual",
    });
  } catch {
    throw new Error(
      `Could not reach ${mintOrigin}. The container may be stopped, still starting, or unreachable.`,
    );
  }

  if (response.type === "opaqueredirect") {
    throw new Error(
      "This project's zcp service predates the pairing endpoint — it redirected to the " +
        "code-server login instead of minting a credential. Redeploy the service to pick up the update.",
    );
  }
  if (response.status === 404) {
    throw new Error(
      "This container has no VSCODE_PASSWORD configured, so its zcp service won't mint a pairing credential.",
    );
  }
  if (response.status === 502) {
    throw new Error(
      "The container is reachable, but its pairing sidecar isn't running yet " +
        "(its z3 bootstrap may not have completed — see docs/internals/zerops/hacks.md H-05).",
    );
  }
  if (!response.ok) {
    throw new Error(`Minting a pairing credential failed (HTTP ${response.status}).`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(
      "The container didn't return a pairing credential — its zcp service may predate the pairing endpoint.",
    );
  }
  if (!isRecord(body) || typeof body.credential !== "string" || typeof body.origin !== "string") {
    throw new Error("The container's pairing response was missing a credential or origin.");
  }
  return {
    credential: body.credential,
    origin: body.origin,
    ...(typeof body.expiresAt === "string" ? { expiresAt: body.expiresAt } : {}),
  };
}

export type ZcpHealth = "ready" | "initializing" | "broken" | "unknown";

/**
 * `GET {mintOrigin}/healthz` — outside the auth gate (H-07), always answers
 * `200` on an updated container with `{initComplete, z3Up}`:
 * `initComplete` false means the container's boot steps haven't finished
 * yet; `z3Up` false (with init otherwise complete) means the z3 process
 * itself isn't answering. Degrades to `"unknown"` on anything that doesn't
 * look like that response (redirect, non-2xx, unparsable body) — an older
 * container that predates this endpoint should never block a connect
 * attempt on it, only inform the error message if the mint call also fails.
 */
export async function probeZcpHealth(mintOrigin: string): Promise<ZcpHealth> {
  try {
    const response = await fetch(`${mintOrigin}/healthz`, { redirect: "manual" });
    if (response.type === "opaqueredirect" || !response.ok) return "unknown";
    const body: unknown = await response.json().catch(() => null);
    if (!isRecord(body)) return "unknown";
    if (body.initComplete === false) return "initializing";
    if (body.z3Up === false) return "broken";
    return "ready";
  } catch {
    return "unknown";
  }
}

/**
 * Runs the full one-click connect sequence for a `ready` candidate and
 * returns the resulting environment id. Throws a plain `Error` with a
 * message meant to be shown directly — every step above already turns its
 * failure modes into legible text.
 */
export async function connectReadyZeropsCandidate(
  candidate: ZeropsCandidate,
  connectPairing: ConnectPairingCommand,
): Promise<EnvironmentId> {
  if (candidate.group !== "ready" || !candidate.zcpService || !candidate.mintOrigin) {
    throw new Error("This project isn't ready to connect.");
  }

  const password = await fetchZcpVscodePassword(candidate.zcpService.id);

  let pairing: Z3PairingMint;
  try {
    pairing = await mintZ3Pairing(candidate.mintOrigin, password);
  } catch (cause) {
    const health = await probeZcpHealth(candidate.mintOrigin);
    if (health === "initializing") {
      throw new Error(
        "This container looks like it's still starting up (init hasn't finished). Try again shortly.",
        { cause },
      );
    }
    if (health === "broken") {
      throw new Error(
        "This container finished starting, but its z3 server isn't answering. It may need attention.",
        { cause },
      );
    }
    throw cause;
  }

  const outcome = await connectPairing({ host: pairing.origin, pairingCode: pairing.credential });
  if (outcome._tag === "Failure") {
    if (isAtomCommandInterrupted(outcome)) {
      throw new Error("Connection attempt was interrupted.");
    }
    const error = squashAtomCommandFailure(outcome);
    throw error instanceof Error ? error : new Error("Failed to connect.");
  }
  return outcome.value;
}
