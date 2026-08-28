import type { EnvironmentId } from "@t3tools/contracts";
import { CloudIcon, RefreshCwIcon, TriangleAlertIcon } from "lucide-react";
import { useCallback, useState } from "react";

import { connectPairing as connectPairingAtom } from "~/connection/onboarding";
import { useAtomCommand } from "~/state/use-atom-command";
import { useEnvironment } from "~/state/environments";
import {
  groupZeropsCandidates,
  useZeropsCandidates,
  type ZeropsCandidate,
} from "~/zerops/candidates";

import { cn } from "../../lib/utils";
import { Alert, AlertDescription } from "../ui/alert";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { Spinner } from "../ui/spinner";
import { ITEM_ROW_CLASSNAME, ITEM_ROW_INNER_CLASSNAME } from "../settings/itemRows";
import { connectReadyZeropsCandidate, type ConnectPairingCommand } from "./connect";
import { StatusPill } from "./statusBadge";

export interface ZeropsProjectPickerProps {
  readonly onConnected?: (environmentId: EnvironmentId) => void;
  readonly className?: string;
}

function GroupHeading({ children }: { readonly children: string }) {
  return (
    <h3 className="px-3 pt-3 pb-1 text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase sm:px-4">
      {children}
    </h3>
  );
}

function ProjectIdentity({ candidate }: { readonly candidate: ZeropsCandidate }) {
  return (
    <div className="min-w-0 flex-1 space-y-1">
      <div className="flex min-h-5 items-center gap-1.5">
        <h4 className="truncate text-sm font-medium text-foreground">{candidate.project.name}</h4>
        <StatusPill status={candidate.project.status} />
      </div>
      <p className="truncate text-xs text-muted-foreground">{candidate.project.clientName}</p>
    </div>
  );
}

function ConnectedRow({ candidate }: { readonly candidate: ZeropsCandidate }) {
  const environment = useEnvironment(candidate.environmentId ?? null);
  return (
    <div className={ITEM_ROW_CLASSNAME}>
      <div className={ITEM_ROW_INNER_CLASSNAME}>
        <ProjectIdentity candidate={candidate} />
        <span className="shrink-0 text-xs text-muted-foreground">
          Connected{environment ? ` as ${environment.label}` : ""}
        </span>
      </div>
    </div>
  );
}

/**
 * The C3 sub-state: this zcp service is active but hasn't declared the z3
 * port, so connecting it means a redeploy that replaces the container —
 * destructive per hacks.md H-10 (lost thread history, a killed agent
 * session). This dialog surfaces that consequence and gates it behind an
 * explicit confirmation; it deliberately does not perform the redeploy —
 * see connect.ts's doc comment and the report back to the team lead.
 */
function RedeployConfirmDialog({
  candidate,
  open,
  onOpenChange,
}: {
  readonly candidate: ZeropsCandidate;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const [confirmedMessage, setConfirmedMessage] = useState<string | null>(null);

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setConfirmedMessage(null);
        onOpenChange(next);
      }}
    >
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>Redeploy {candidate.project.name}'s zcp service?</AlertDialogTitle>
          <AlertDialogDescription>
            This project's <code className="font-mono">zcp</code> service doesn't declare the z3
            port yet. Connecting it means redeploying the service to add one — the container gets
            replaced with a new one, which loses this project's agent thread history and interrupts
            any agent session currently running there. This can't be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {confirmedMessage ? (
          <div className="px-6 pb-4">
            <Alert variant="warning">
              <AlertDescription>{confirmedMessage}</AlertDescription>
            </Alert>
          </div>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
          <Button
            variant="destructive"
            onClick={() =>
              setConfirmedMessage(
                "Automatic redeploy isn't implemented yet. Add { port: 3773, httpSupport: true } to " +
                  "this service's run.ports in its zerops.yml and redeploy it, then reconnect here.",
              )
            }
          >
            Redeploy and connect
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}

function ReadyRow({
  candidate,
  connectPairing,
  onConnected,
}: {
  readonly candidate: ZeropsCandidate;
  readonly connectPairing: ConnectPairingCommand;
  readonly onConnected?: (environmentId: EnvironmentId) => void;
}) {
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRedeployDialogOpen, setIsRedeployDialogOpen] = useState(false);

  const handleConnect = useCallback(async () => {
    setIsConnecting(true);
    setError(null);
    try {
      const environmentId = await connectReadyZeropsCandidate(candidate, connectPairing);
      onConnected?.(environmentId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to connect.");
    } finally {
      setIsConnecting(false);
    }
  }, [candidate, connectPairing, onConnected]);

  return (
    <div className={ITEM_ROW_CLASSNAME}>
      <div className={ITEM_ROW_INNER_CLASSNAME}>
        <ProjectIdentity candidate={candidate} />
        {candidate.z3Origin ? (
          <Button size="xs" onClick={() => void handleConnect()} disabled={isConnecting}>
            {isConnecting ? (
              <>
                <Spinner className="size-3.5" /> Connecting…
              </>
            ) : (
              "Connect"
            )}
          </Button>
        ) : (
          <>
            <Button size="xs" variant="outline" onClick={() => setIsRedeployDialogOpen(true)}>
              <TriangleAlertIcon className="size-3.5" />
              Needs a redeploy to connect
            </Button>
            <RedeployConfirmDialog
              candidate={candidate}
              open={isRedeployDialogOpen}
              onOpenChange={setIsRedeployDialogOpen}
            />
          </>
        )}
      </div>
      {error ? <p className="mt-1.5 text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

function UnavailableRow({ candidate }: { readonly candidate: ZeropsCandidate }) {
  return (
    <div className={ITEM_ROW_CLASSNAME}>
      <div className={ITEM_ROW_INNER_CLASSNAME}>
        <ProjectIdentity candidate={candidate} />
        <span className="shrink-0 text-xs text-muted-foreground">{candidate.reason}</span>
      </div>
    </div>
  );
}

/**
 * Every Zerops project across every org the signed-in account belongs to,
 * grouped into connected / ready / unavailable (see `zerops/candidates.ts`
 * for the grouping model) with one-click connect for a ready project.
 * Mounted from Settings → Zerops and, elsewhere, an onboarding surface —
 * both render this one component rather than divergent lists.
 */
export function ZeropsProjectPicker({ onConnected, className }: ZeropsProjectPickerProps) {
  const { candidates, isLoading, error, refresh } = useZeropsCandidates();
  const connectPairing = useAtomCommand(connectPairingAtom, { reportFailure: false });
  const { connected, ready, unavailable } = groupZeropsCandidates(candidates);

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex items-center justify-end px-1">
        <Button
          size="xs"
          variant="ghost"
          onClick={refresh}
          disabled={isLoading}
          aria-label="Refresh Zerops projects"
        >
          <RefreshCwIcon className={isLoading ? "size-3 animate-spin" : "size-3"} />
          Refresh
        </Button>
      </div>

      {error ? (
        <Alert variant="error" className="mx-1">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {!error && isLoading && candidates.length === 0 ? (
        <div className={ITEM_ROW_CLASSNAME}>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Spinner className="size-3" />
            Loading your Zerops projects…
          </p>
        </div>
      ) : null}

      {!error && !isLoading && candidates.length === 0 ? (
        <Empty className="min-h-52">
          <EmptyMedia variant="icon">
            <CloudIcon />
          </EmptyMedia>
          <EmptyHeader>
            <EmptyTitle>No Zerops projects</EmptyTitle>
            <EmptyDescription>This account doesn't have any projects yet.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}

      {connected.length > 0 ? (
        <>
          <GroupHeading>Connected</GroupHeading>
          {connected.map((candidate) => (
            <ConnectedRow key={candidate.project.id} candidate={candidate} />
          ))}
        </>
      ) : null}

      {ready.length > 0 ? (
        <>
          <GroupHeading>Ready to connect</GroupHeading>
          {ready.map((candidate) => (
            <ReadyRow
              key={candidate.project.id}
              candidate={candidate}
              connectPairing={connectPairing}
              {...(onConnected ? { onConnected } : {})}
            />
          ))}
        </>
      ) : null}

      {unavailable.length > 0 ? (
        <>
          <GroupHeading>Unavailable</GroupHeading>
          {unavailable.map((candidate) => (
            <UnavailableRow key={candidate.project.id} candidate={candidate} />
          ))}
        </>
      ) : null}
    </div>
  );
}
