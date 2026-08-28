import type { EnvironmentId } from "@t3tools/contracts";
import { FolderIcon, RotateCcwIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { sortScopedProjectsForSidebar } from "~/components/Sidebar.logic";
import { StatusPill } from "~/components/zerops/statusBadge";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { filesystemEnvironment } from "~/state/filesystem";
import { useProjects, useThreadShells } from "~/state/entities";
import { useEnvironmentQuery } from "~/state/query";
import { fetchProjectOverview, ZeropsApiError, type ZeropsService } from "~/zerops/api";
import { useZeropsCandidates } from "~/zerops/candidates";

import { joinVarWwwMounts, type ZeropsMountRow } from "./mountJoin";

/**
 * `/var/www` itself is never browsed with anything but a trailing slash, so
 * this always lists every directory directly under it — see
 * `filesystemEnvironment.browse` (`packages/client-runtime/src/state/filesystem.ts`),
 * which resolves to the server's `WorkspaceEntries.browse` and already
 * filters to directories only.
 */
const VAR_WWW_PARTIAL_PATH = "/var/www/";

type ServicesState =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "resolved"; readonly services: ReadonlyArray<ZeropsService> };

/**
 * Resolves this environment's own workspace root, so it can be excluded
 * from the mount list below rather than rendered as a mount (`hacks.md`
 * H-14). Derived from the connected environment's own project — no
 * hardcoded path guess. If no project has shown up for this environment
 * yet, this stays `null` and `joinVarWwwMounts` skips the exclusion rather
 * than filtering on a guess.
 */
function useEnvironmentWorkspaceRoot(environmentId: EnvironmentId): string | null {
  const projects = useProjects();
  const threads = useThreadShells();
  return useMemo(() => {
    const scoped = sortScopedProjectsForSidebar(
      projects.filter((project) => project.environmentId === environmentId),
      threads,
      "updated_at",
    );
    return scoped[0]?.workspaceRoot ?? null;
  }, [environmentId, projects, threads]);
}

function useProjectServices(zeropsProjectId: string | null): ServicesState {
  const [state, setState] = useState<ServicesState>({ status: "loading" });
  const generationRef = useRef(0);

  useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;
    const isCancelled = () => generationRef.current !== generation;

    if (zeropsProjectId === null) {
      setState({ status: "loading" });
      return;
    }
    setState({ status: "loading" });

    void (async () => {
      try {
        const overview = await fetchProjectOverview(zeropsProjectId);
        if (isCancelled()) return;
        setState({ status: "resolved", services: overview.services });
      } catch (error) {
        if (isCancelled()) return;
        const message =
          error instanceof ZeropsApiError
            ? error.message
            : error instanceof Error
              ? error.message
              : "Failed to load this project's services.";
        setState({ status: "error", message });
      }
    })();

    return () => {
      generationRef.current += 1;
    };
  }, [zeropsProjectId]);

  return state;
}

function MountRowView({ row }: { readonly row: ZeropsMountRow }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-sm font-medium text-foreground">{row.name}</span>
        <code className="truncate text-xs text-muted-foreground">{row.fullPath}</code>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {row.service ? (
          <>
            <Badge variant="outline" className="font-normal text-muted-foreground">
              {row.service.serviceStackTypeInfo.serviceStackTypeName}
              {row.service.serviceStackTypeInfo.serviceStackTypeVersionName
                ? ` · ${row.service.serviceStackTypeInfo.serviceStackTypeVersionName}`
                : ""}
            </Badge>
            <StatusPill status={row.service.status} />
          </>
        ) : (
          <Badge variant="secondary" className="font-normal">
            Unmatched
          </Badge>
        )}
      </div>
    </div>
  );
}

/**
 * Read-only context for what is mounted under `/var/www` inside a connected
 * Zerops project — `zcp` sshfs-mounts each sibling service at
 * `/var/www/<hostname>` (`docs/internals/zerops/map.md`). There is no
 * container-side endpoint for this (`hacks.md` H-08): the list comes from
 * browsing the directory through the environment's own filesystem atoms,
 * joined to the Zerops API's service list for this project by hostname.
 * Offers no mount/unmount actions — see `hacks.md` H-14 for why a mount must
 * never become a workspace root.
 */
export function ZeropsMountsPanel({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const { candidates } = useZeropsCandidates();
  const zeropsProjectId = useMemo(
    () =>
      candidates.find((candidate) => candidate.environmentId === environmentId)?.project.id ?? null,
    [candidates, environmentId],
  );

  const workspaceRoot = useEnvironmentWorkspaceRoot(environmentId);
  const browseQuery = useEnvironmentQuery(
    filesystemEnvironment.browse({
      environmentId,
      input: { partialPath: VAR_WWW_PARTIAL_PATH },
    }),
  );
  const servicesState = useProjectServices(zeropsProjectId);

  const isLoading =
    (browseQuery.data === null && browseQuery.error === null) || servicesState.status === "loading";

  if (isLoading) {
    return (
      <div className="flex items-center gap-1.5 px-1 py-6 text-sm text-muted-foreground">
        <Spinner className="size-3" />
        Loading mounts…
      </div>
    );
  }

  if (browseQuery.error) {
    return (
      <div className="flex flex-col items-start gap-2 px-1 py-6">
        <p className="text-sm text-destructive">Couldn’t list /var/www: {browseQuery.error}</p>
        <Button size="xs" variant="outline" onClick={browseQuery.refresh}>
          <RotateCcwIcon className="size-3.5" />
          Try again
        </Button>
      </div>
    );
  }

  if (servicesState.status === "error") {
    return <p className="px-1 py-6 text-sm text-destructive">{servicesState.message}</p>;
  }

  const rows = joinVarWwwMounts(
    browseQuery.data?.entries ?? [],
    servicesState.services,
    workspaceRoot,
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <FolderIcon className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-medium text-foreground">/var/www</h3>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing is mounted under /var/www yet. Sibling services are mounted opt-in — see{" "}
          <code className="text-xs">ZCP_SSHFS_HOSTNAMES</code>.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((row) => (
            <MountRowView key={row.fullPath} row={row} />
          ))}
        </div>
      )}
    </div>
  );
}
