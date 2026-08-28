/**
 * The grouping model behind the Zerops project picker: every project across
 * every org the signed-in account belongs to, sorted into three groups —
 * `connected` (already paired as an environment), `ready` (a `zcp` service
 * exists and is usable), and `unavailable` (with a reason). Mirrors zcli's
 * `Candidate{Project, Service, Agents, Reason}` model
 * (`../zcli/src/zcpSession/target.go:24`, `catalog.go:168-195`) rather than
 * inventing new states — the exact reason strings match
 * `../zcli/src/i18n/en.go:302-305`.
 *
 * The pure derivation (`deriveZeropsCandidate`) takes already-fetched data
 * and contains all the branching logic; `useZeropsCandidates` is the thin
 * React shell that fetches, caps concurrency, and re-renders as results
 * stream in. `useConnectedZeropsOrigins`/`resolveConnectedEnvironmentId` are
 * a lighter pair for a caller (`ZeropsProjectDetail.tsx`) that already has
 * one project's overview and only needs its connected-environment id, not
 * the whole account-wide sweep.
 */

import type { EnvironmentId } from "@t3tools/contracts";
import { useEffect, useMemo, useRef, useState } from "react";

import { useEnvironments } from "~/state/environments";

import {
  buildContainerUrl,
  fetchAllProjects,
  fetchProjectOverview,
  ZeropsApiError,
  type ZeropsProject,
  type ZeropsProjectOverview,
  type ZeropsService,
} from "./api";

export type ZeropsCandidateGroup = "connected" | "ready" | "unavailable";

export interface ZeropsCandidate {
  readonly project: ZeropsProject;
  readonly group: ZeropsCandidateGroup;
  readonly reason?: string;
  readonly zcpService?: { readonly id: string; readonly name: string; readonly status: string };
  readonly z3Origin?: string;
  readonly mintOrigin?: string;
  readonly environmentId?: EnvironmentId;
}

// z3's own declared port, and the zcp default port the pairing mint
// endpoint lives behind (H-02 in hacks.md). Neither is guaranteed to be
// declared on a given zcp service — see C3 in the team-lead's brief and the
// "ready without z3Origin" branch below.
const Z3_PORT = 3773;
const MINT_PORT = 8080;

/**
 * A zcp container is identified by its service *type*, not its hostname.
 * `zcli` matches the literal name "zcp" because that is what its own flow
 * creates, but a project can hold a zcp@1 service under any hostname — and
 * matching by name reports "zcp service is missing" for a project that
 * demonstrably has one. The type is authoritative and costs nothing extra:
 * it already rides on every service in the stack response.
 */
const ZCP_SERVICE_TYPE_PREFIX = "zcp@";

function isZcpService(service: ZeropsService): boolean {
  return service.serviceStackTypeInfo.serviceStackTypeVersionName.startsWith(
    ZCP_SERVICE_TYPE_PREFIX,
  );
}

/** `https://…` → its origin, lowercased, for comparing against a registered environment's `displayUrl`. */
function normalizeOrigin(url: string): string | null {
  try {
    return new URL(url).origin.toLowerCase();
  } catch {
    return null;
  }
}

function derivePortOrigin(
  zcp: ZeropsService,
  overview: Pick<ZeropsProjectOverview, "subdomainPrefix" | "region">,
  port: number,
): string | undefined {
  if (!overview.subdomainPrefix || !overview.region) return undefined;
  if (!zcp.ports.some((candidate) => candidate.port === port)) return undefined;
  return buildContainerUrl(zcp.name, overview.subdomainPrefix, port, overview.region);
}

/**
 * Pure grouping decision for one project. `overview` is `null` whenever the
 * project itself isn't ACTIVE (in which case its services are never even
 * fetched — matching `catalog.go`'s `resolveProject`, which returns before
 * calling `GetNonSystemServicesByProject`) — or, defensively, if it's
 * somehow missing despite the project being active.
 *
 * A `ready` candidate whose `z3Origin` is absent means the zcp service
 * exists and is active but hasn't declared the z3 port — connecting it
 * needs a redeploy that replaces the container (see hacks.md H-10). That is
 * the fifth state the zcli model doesn't have (C3): it is deliberately not
 * a separate `group` value, just `ready` with no derivable `z3Origin`, so a
 * caller that only cares about "can I click connect" doesn't need to know
 * about it, and one that needs to warn about the redeploy tests that field.
 */
export function deriveZeropsCandidate(
  project: ZeropsProject,
  overview: ZeropsProjectOverview | null,
  connectedOrigins: ReadonlyMap<string, EnvironmentId>,
): ZeropsCandidate {
  if (project.status !== "ACTIVE") {
    return { project, group: "unavailable", reason: `project is ${project.status}` };
  }
  if (!overview) {
    return { project, group: "unavailable", reason: "zcp service is missing" };
  }

  const zcpServices = overview.services.filter(isZcpService);
  if (zcpServices.length === 0) {
    return { project, group: "unavailable", reason: "zcp service is missing" };
  }

  // "Ambiguous" has to mean "several containers we could actually use", not
  // "several containers". A project that has an old zcp alongside one that
  // declares the z3 port has exactly one usable answer, and reporting it as
  // ambiguous hides a container that is ready to connect. Only when more than
  // one *usable* container exists is the choice genuinely the user's.
  const usable = zcpServices.filter((service) => derivePortOrigin(service, overview, Z3_PORT));
  const chosen = usable.length > 0 ? usable : zcpServices;
  if (chosen.length > 1) {
    return { project, group: "unavailable", reason: "multiple zcp services found" };
  }

  const zcp = chosen[0]!;
  if (zcp.status !== "ACTIVE") {
    return { project, group: "unavailable", reason: `zcp service is ${zcp.status}` };
  }

  const zcpService = { id: zcp.id, name: zcp.name, status: zcp.status };
  const z3Origin = derivePortOrigin(zcp, overview, Z3_PORT);
  const mintOrigin = derivePortOrigin(zcp, overview, MINT_PORT);

  if (z3Origin) {
    const environmentId = connectedOrigins.get(normalizeOrigin(z3Origin) ?? z3Origin);
    if (environmentId) {
      return {
        project,
        group: "connected",
        zcpService,
        z3Origin,
        ...(mintOrigin ? { mintOrigin } : {}),
        environmentId,
      };
    }
  }

  return {
    project,
    group: "ready",
    zcpService,
    ...(z3Origin ? { z3Origin } : {}),
    ...(mintOrigin ? { mintOrigin } : {}),
  };
}

/** Buckets an already-derived candidate list by group, preserving order. */
export function groupZeropsCandidates(candidates: ReadonlyArray<ZeropsCandidate>): {
  readonly connected: ReadonlyArray<ZeropsCandidate>;
  readonly ready: ReadonlyArray<ZeropsCandidate>;
  readonly unavailable: ReadonlyArray<ZeropsCandidate>;
} {
  const connected: ZeropsCandidate[] = [];
  const ready: ZeropsCandidate[] = [];
  const unavailable: ZeropsCandidate[] = [];
  for (const candidate of candidates) {
    if (candidate.group === "connected") connected.push(candidate);
    else if (candidate.group === "ready") ready.push(candidate);
    else unavailable.push(candidate);
  }
  return { connected, ready, unavailable };
}

type OverviewOutcome =
  | { readonly status: "resolved"; readonly overview: ZeropsProjectOverview }
  | { readonly status: "error"; readonly message: string };

// Cap concurrent per-project overview fetches (project detail + service
// stack) so an org with many projects doesn't fire dozens of requests at
// once — mirrors the existing Settings/list resolution pattern.
const RESOLUTION_CONCURRENCY = 4;

function overviewErrorMessage(error: unknown): string {
  if (error instanceof ZeropsApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Failed to load this project.";
}

async function resolveOverviewsWithConcurrency(
  projectIds: ReadonlyArray<string>,
  limit: number,
  isCancelled: () => boolean,
  onResolved: (projectId: string, outcome: OverviewOutcome) => void,
): Promise<void> {
  let cursor = 0;

  async function runNext(): Promise<void> {
    for (;;) {
      if (isCancelled()) return;
      const index = cursor;
      cursor += 1;
      if (index >= projectIds.length) return;
      const projectId = projectIds[index]!;
      try {
        const overview = await fetchProjectOverview(projectId);
        if (isCancelled()) return;
        onResolved(projectId, { status: "resolved", overview });
      } catch (error) {
        if (isCancelled()) return;
        onResolved(projectId, { status: "error", message: overviewErrorMessage(error) });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, projectIds.length) }, () => runNext()));
}

/**
 * Registered environments keyed by their normalized origin, so a derived z3
 * origin can be matched to the environment already connected to it. Exported
 * (separately from `useZeropsCandidates`, which uses this internally) because
 * the project detail view resolves one project's environment from an
 * overview it has already fetched via `resolveConnectedEnvironmentId` below,
 * rather than re-running the whole candidate sweep just to learn one id.
 */
export function useConnectedZeropsOrigins(): ReadonlyMap<string, EnvironmentId> {
  const { environments } = useEnvironments();
  return useMemo(() => {
    const map = new Map<string, EnvironmentId>();
    for (const environment of environments) {
      if (!environment.displayUrl) continue;
      const normalized = normalizeOrigin(environment.displayUrl);
      if (normalized) map.set(normalized, environment.environmentId);
    }
    return map;
  }, [environments]);
}

/**
 * The environment already connected to this project's z3 origin, or `null`.
 * Takes an overview the caller has already fetched, so a view that only
 * needs one project's environment id does not have to run the whole
 * candidate sweep (which fetches every project plus an overview each) to
 * find it — see hacks.md H-19.
 */
export function resolveConnectedEnvironmentId(
  overview: ZeropsProjectOverview,
  connectedOrigins: ReadonlyMap<string, EnvironmentId>,
): EnvironmentId | null {
  const zcpServices = overview.services.filter(isZcpService);
  if (zcpServices.length !== 1) return null;
  const zcp = zcpServices[0]!;
  if (zcp.status !== "ACTIVE") return null;
  const z3Origin = derivePortOrigin(zcp, overview, Z3_PORT);
  if (!z3Origin) return null;
  return connectedOrigins.get(normalizeOrigin(z3Origin) ?? z3Origin) ?? null;
}

/**
 * Every project across every org the signed-in account belongs to, grouped
 * and reasoned about. `isLoading` covers both the project list fetch and
 * every active project's overview resolution — a project only appears in
 * `candidates` once its group is known, so there is no "resolving…"
 * sub-state to represent per candidate.
 */
export function useZeropsCandidates(): {
  readonly candidates: ReadonlyArray<ZeropsCandidate>;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly refresh: () => void;
} {
  const [projects, setProjects] = useState<ReadonlyArray<ZeropsProject>>([]);
  const [overviews, setOverviews] = useState<ReadonlyMap<string, OverviewOutcome>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  // Bumped on every reload so an in-flight load's callbacks become no-ops.
  const generationRef = useRef(0);

  useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;
    const isCancelled = () => generationRef.current !== generation;

    setIsLoading(true);
    setError(null);
    setProjects([]);
    setOverviews(new Map());

    void (async () => {
      try {
        const list = await fetchAllProjects();
        if (isCancelled()) return;
        setProjects(list);

        const activeProjectIds = list
          .filter((project) => project.status === "ACTIVE")
          .map((project) => project.id);

        if (activeProjectIds.length === 0) {
          setIsLoading(false);
          return;
        }

        await resolveOverviewsWithConcurrency(
          activeProjectIds,
          RESOLUTION_CONCURRENCY,
          isCancelled,
          (projectId, outcome) => {
            setOverviews((current) => new Map(current).set(projectId, outcome));
          },
        );
        if (isCancelled()) return;
        setIsLoading(false);
      } catch (err) {
        if (isCancelled()) return;
        setError(overviewErrorMessage(err));
        setIsLoading(false);
      }
    })();

    return () => {
      generationRef.current += 1;
    };
  }, [nonce]);

  const connectedOrigins = useConnectedZeropsOrigins();

  const candidates = useMemo(() => {
    const result: ZeropsCandidate[] = [];
    for (const project of projects) {
      if (project.status !== "ACTIVE") {
        result.push(deriveZeropsCandidate(project, null, connectedOrigins));
        continue;
      }
      const outcome = overviews.get(project.id);
      if (!outcome) continue; // still resolving — omitted while isLoading is true
      if (outcome.status === "error") {
        result.push({ project, group: "unavailable", reason: outcome.message });
        continue;
      }
      result.push(deriveZeropsCandidate(project, outcome.overview, connectedOrigins));
    }
    return result;
  }, [projects, overviews, connectedOrigins]);

  return {
    candidates,
    isLoading,
    error,
    refresh: () => setNonce((n) => n + 1),
  };
}
