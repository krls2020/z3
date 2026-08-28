/**
 * The Zerops right-panel surface: the service map for the project this thread
 * runs in.
 *
 * Reads both feeds and renders. Nothing here mutates the project — the agent
 * owns every change, through MCP.
 */
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";

import { ScrollArea } from "~/components/ui/scroll-area";
import { buildZeropsServiceMap } from "../../zerops/serviceMap";
import { useZeropsLifecycle, useZeropsTopology } from "../../zerops/useZeropsFeeds";
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
          <ZeropsServiceMap view={view} />
        )}
      </div>
    </ScrollArea>
  );
}
