/**
 * The Zerops right-panel surface: the service map for the project this thread
 * runs in.
 *
 * Reads both feeds and renders. Nothing here mutates the project — the agent
 * owns every change, through MCP.
 */
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";

import { ScrollArea } from "~/components/ui/scroll-area";
import { zeropsQuickActions } from "../../zerops/quickActions";
import { buildZeropsServiceMap } from "../../zerops/serviceMap";
import { useZeropsLifecycle, useZeropsTopology } from "../../zerops/useZeropsFeeds";
import { ZeropsQuickActions } from "./ZeropsQuickActions";
import { ZeropsServiceMap } from "./ZeropsServiceMap";

export function ZeropsPanel({
  environmentId,
  threadId,
}: {
  readonly environmentId: EnvironmentId | null;
  readonly threadId: ThreadId | null;
}) {
  const topology = useZeropsTopology(environmentId);
  const lifecycle = useZeropsLifecycle(environmentId, threadId);
  const view = buildZeropsServiceMap(topology, lifecycle);

  return (
    <ScrollArea className="h-full">
      <div className="p-4">
        {view === undefined ? (
          <ZeropsPanelPlaceholder waiting={topology === undefined} />
        ) : (
          <div className="space-y-4">
            <ZeropsServiceMap view={view} />
            <ZeropsQuickActions actions={zeropsQuickActions(topology)} />
          </div>
        )}
      </div>
    </ScrollArea>
  );
}

/**
 * Two different reasons the map is absent, and they must not share a sentence.
 *
 * The panel's tab is persisted per thread, so a reload can render this surface
 * before the first snapshot has arrived. Saying "not a Zerops project" then
 * would be a confident lie about the very project the user is looking at, told
 * for the second or so before the feed answers.
 */
export function ZeropsPanelPlaceholder({ waiting }: { readonly waiting: boolean }) {
  return (
    <p className="text-muted-foreground text-sm" data-zerops-panel-placeholder>
      {waiting ? "Reading the project…" : "This environment is not a Zerops project."}
    </p>
  );
}
