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
          <p className="text-muted-foreground text-sm">This environment is not a Zerops project.</p>
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
