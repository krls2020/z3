import type { EnvironmentId } from "@t3tools/contracts";

import type { ZeropsCandidate } from "~/zerops/candidates";

/**
 * The environment to jump straight into on the hosted-static landing:
 * exactly one already-connected candidate, no more, no less. Zero or
 * several connected candidates both mean "show the picker" — guessing among
 * several would be as wrong as guessing among zero.
 */
export function selectSoleConnectedEnvironmentId(
  candidates: ReadonlyArray<ZeropsCandidate>,
): EnvironmentId | null {
  const connected = candidates.filter(
    (candidate) => candidate.group === "connected" && candidate.environmentId !== undefined,
  );
  return connected.length === 1 ? (connected[0]!.environmentId ?? null) : null;
}
