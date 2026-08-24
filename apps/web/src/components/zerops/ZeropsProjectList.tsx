import { useEffect, useRef, useState } from "react";

import {
  fetchServices,
  summarizeServices,
  type ZeropsProject,
  type ZeropsServiceSummary,
} from "~/zerops/api";

import { cn } from "../../lib/utils";
import { Spinner } from "../ui/spinner";
import { StatusPill } from "./statusBadge";

type SummaryResolution =
  | { readonly status: "loading" }
  | { readonly status: "resolved"; readonly summary: ZeropsServiceSummary }
  | { readonly status: "error" };

// Cap concurrent per-project service-stack fetches so a large org doesn't fire
// dozens of requests at once; rows render their summary as each one lands.
const RESOLUTION_CONCURRENCY = 4;

async function resolveSummariesWithConcurrency(
  projects: ReadonlyArray<ZeropsProject>,
  isCancelled: () => boolean,
  onResolved: (projectId: string, resolution: SummaryResolution) => void,
): Promise<void> {
  let cursor = 0;

  async function runNext(): Promise<void> {
    for (;;) {
      if (isCancelled()) return;
      const index = cursor;
      cursor += 1;
      if (index >= projects.length) return;
      const project = projects[index]!;
      try {
        const services = await fetchServices(project.id);
        if (isCancelled()) return;
        onResolved(project.id, { status: "resolved", summary: summarizeServices(services) });
      } catch {
        if (isCancelled()) return;
        onResolved(project.id, { status: "error" });
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(RESOLUTION_CONCURRENCY, projects.length) }, () => runNext()),
  );
}

function formatServiceSummary(summary: ZeropsServiceSummary): string {
  const parts: string[] = [];
  if (summary.runtimeCount > 0) {
    parts.push(`${summary.runtimeCount} runtime${summary.runtimeCount === 1 ? "" : "s"}`);
  }
  if (summary.dataCount > 0) {
    parts.push(`${summary.dataCount} data`);
  }
  if (parts.length === 0) return "No runtimes or data services.";
  return parts.join(" · ");
}

export function ZeropsProjectList({
  projects,
  isLoading,
  error,
  selectedProjectId,
  onSelect,
  loadNonce,
}: {
  readonly projects: ReadonlyArray<ZeropsProject>;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly selectedProjectId: string | null;
  readonly onSelect: (projectId: string) => void;
  readonly loadNonce: number;
}) {
  const [summaries, setSummaries] = useState<ReadonlyMap<string, SummaryResolution>>(new Map());
  // Bumped whenever the project set (re)loads so a slow in-flight resolution
  // from a previous load can't clobber a fresher one.
  const generationRef = useRef(0);

  useEffect(() => {
    if (projects.length === 0) {
      setSummaries(new Map());
      return;
    }

    generationRef.current += 1;
    const generation = generationRef.current;
    const isCancelled = () => generationRef.current !== generation;

    setSummaries(new Map(projects.map((project) => [project.id, { status: "loading" as const }])));

    void resolveSummariesWithConcurrency(projects, isCancelled, (projectId, resolution) => {
      setSummaries((current) => new Map(current).set(projectId, resolution));
    });

    return () => {
      generationRef.current += 1;
    };
  }, [projects, loadNonce]);

  if (error) {
    return <p className="px-3 text-sm text-destructive sm:px-4">{error}</p>;
  }

  if (!isLoading && projects.length === 0) {
    return (
      <p className="px-3 text-sm text-muted-foreground sm:px-4">
        This token's organization doesn't have any projects yet.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-1">
      {isLoading && projects.length === 0
        ? Array.from({ length: 3 }, (_, index) => (
            <li
              key={index}
              className="flex items-center gap-1.5 px-3 py-3 text-sm text-muted-foreground sm:px-4"
            >
              <Spinner className="size-3" />
              Loading…
            </li>
          ))
        : null}
      {projects.map((project) => {
        const resolution = summaries.get(project.id);
        return (
          <li key={project.id}>
            <button
              type="button"
              onClick={() => onSelect(project.id)}
              className={cn(
                "flex w-full flex-col gap-1 rounded-xl px-3 py-3 text-left transition-colors hover:bg-accent sm:px-4",
                selectedProjectId === project.id && "bg-accent",
              )}
            >
              <span className="flex min-h-5 items-center gap-1.5">
                <span className="truncate text-sm font-medium text-foreground">{project.name}</span>
                <StatusPill status={project.status} />
              </span>
              <span className="text-xs text-muted-foreground">
                {!resolution || resolution.status === "loading" ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Spinner className="size-3" />
                    Resolving services…
                  </span>
                ) : resolution.status === "error" ? (
                  "Could not load services."
                ) : (
                  formatServiceSummary(resolution.summary)
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
