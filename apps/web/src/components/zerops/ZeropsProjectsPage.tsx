import { Link } from "@tanstack/react-router";
import { CloudIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import {
  fetchAllProjects,
  getToken,
  subscribeToken,
  ZeropsApiError,
  type ZeropsProject,
} from "~/zerops/api";

import { isElectron } from "../../env";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { ScrollArea } from "../ui/scroll-area";
import { SidebarInset } from "../ui/sidebar";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "../WorkspaceBreadcrumb";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { ZeropsProjectDetail } from "./ZeropsProjectDetail";
import { ZeropsProjectList } from "./ZeropsProjectList";

export function ZeropsProjectsPage() {
  // Subscribed, not sampled: the token is entered in Settings and this page
  // is reached by client-side navigation, so a mount-time read would show the
  // empty state until a hard reload.
  const token = useSyncExternalStore(subscribeToken, getToken, () => null);
  const [projects, setProjects] = useState<ReadonlyArray<ZeropsProject>>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [loadNonce, setLoadNonce] = useState(0);

  // Bumped on every reload so an in-flight load's callbacks become no-ops.
  const loadGenerationRef = useRef(0);

  useEffect(() => {
    if (!token) return;

    loadGenerationRef.current += 1;
    const generation = loadGenerationRef.current;
    const isCancelled = () => loadGenerationRef.current !== generation;

    setIsLoadingProjects(true);
    setProjectsError(null);

    void (async () => {
      try {
        const list = await fetchAllProjects();
        if (isCancelled()) return;
        setProjects(list);
        setIsLoadingProjects(false);
        setSelectedProjectId((current) => current ?? list[0]?.id ?? null);
      } catch (error) {
        if (isCancelled()) return;
        const message =
          error instanceof ZeropsApiError
            ? error.message
            : error instanceof Error
              ? error.message
              : "Failed to load Zerops projects.";
        setProjectsError(message);
        setIsLoadingProjects(false);
      }
    })();

    return () => {
      loadGenerationRef.current += 1;
    };
  }, [token, loadNonce]);

  const handleRefresh = useCallback(() => {
    setLoadNonce((n) => n + 1);
  }, []);

  const topbarContent = (
    <div className="flex w-full min-w-0 items-center gap-3">
      <WorkspaceBreadcrumb ariaLabel="Zerops breadcrumb" className="min-w-0">
        <WorkspaceBreadcrumbItem current>
          <h1>Zerops</h1>
        </WorkspaceBreadcrumbItem>
      </WorkspaceBreadcrumb>
      {token ? (
        <Button
          onClick={handleRefresh}
          aria-label="Refresh Zerops projects"
          size="icon-sm"
          variant="ghost"
          className="ms-auto"
          disabled={isLoadingProjects}
        >
          <RefreshCwIcon className={isLoadingProjects ? "size-3.5 animate-spin" : "size-3.5"} />
        </Button>
      ) : null}
    </div>
  );

  return (
    <SidebarInset className="isolate h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        <WorkspacePageHeader electron={isElectron}>{topbarContent}</WorkspacePageHeader>

        <ScrollArea className="min-h-0 flex-1">
          <WorkspacePageContainer width="wide">
            {!token ? (
              <Empty className="min-h-72">
                <EmptyMedia variant="icon">
                  <CloudIcon />
                </EmptyMedia>
                <EmptyHeader>
                  <EmptyTitle>No Zerops token yet</EmptyTitle>
                  <EmptyDescription>
                    Add a personal access token in{" "}
                    <Link to="/settings/zerops" className="underline underline-offset-4">
                      Settings → Zerops
                    </Link>{" "}
                    to see your projects here.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <section className="grid gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
                <div className="flex min-w-0 flex-col gap-1">
                  <ZeropsProjectList
                    projects={projects}
                    isLoading={isLoadingProjects}
                    error={projectsError}
                    selectedProjectId={selectedProjectId}
                    onSelect={setSelectedProjectId}
                    loadNonce={loadNonce}
                  />
                </div>
                <div className="min-w-0 border-border/50 lg:border-l lg:pl-6">
                  {selectedProjectId ? (
                    <ZeropsProjectDetail projectId={selectedProjectId} loadNonce={loadNonce} />
                  ) : (
                    <p className="px-1 py-6 text-sm text-muted-foreground">
                      Select a project to see what's inside it.
                    </p>
                  )}
                </div>
              </section>
            )}
          </WorkspacePageContainer>
        </ScrollArea>
      </div>
    </SidebarInset>
  );
}
