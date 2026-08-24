import { CloudIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommand,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";

import { connectPairing as connectPairingAtom } from "~/connection/onboarding";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  clearToken,
  fetchAllProjects,
  getToken,
  resolveProjectZcpService,
  setToken,
  ZeropsApiError,
  type ZeropsProject,
} from "~/zerops/api";

import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";
import { StatusPill } from "../zerops/statusBadge";
import { ITEM_ROW_CLASSNAME, ITEM_ROW_INNER_CLASSNAME } from "./itemRows";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";

// Rows are resolved lazily and independently, so each project carries its own
// tri-state resolution status alongside whatever the projects list already told us.
type ServiceResolution =
  | { readonly status: "pending" }
  | { readonly status: "loading" }
  | { readonly status: "resolved" }
  | { readonly status: "error"; readonly message: string };

interface ZeropsProjectRow {
  readonly project: ZeropsProject;
  readonly resolution: ServiceResolution;
}

// Cap concurrent per-project resolution (detail + service-stack fetches) so a
// large org doesn't fire dozens of requests at once.
const RESOLUTION_CONCURRENCY = 4;

type ResolutionOutcome =
  | { readonly status: "resolved"; readonly project: Partial<ZeropsProject> }
  | { readonly status: "error"; readonly message: string };

async function resolveRowsWithConcurrency(
  projectIds: ReadonlyArray<string>,
  limit: number,
  isCancelled: () => boolean,
  onResolved: (projectId: string, outcome: ResolutionOutcome) => void,
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
        const resolved = await resolveProjectZcpService(projectId);
        if (isCancelled()) return;
        onResolved(projectId, { status: "resolved", project: resolved });
      } catch (error) {
        if (isCancelled()) return;
        const message =
          error instanceof ZeropsApiError
            ? error.message
            : error instanceof Error
              ? error.message
              : "Failed to resolve services.";
        onResolved(projectId, { status: "error", message });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, projectIds.length) }, () => runNext()));
}

function TokenGate({ onTokenSaved }: { readonly onTokenSaved: (token: string) => void }) {
  const [tokenInput, setTokenInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSave = useCallback(() => {
    const trimmed = tokenInput.trim();
    if (!trimmed) {
      setError("Enter a personal access token.");
      return;
    }
    try {
      setToken(trimmed);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to save token.");
      return;
    }
    setError(null);
    onTokenSaved(trimmed);
  }, [onTokenSaved, tokenInput]);

  return (
    <SettingsRow
      title="Personal access token"
      description="Stored only in this browser's local storage — it is never sent anywhere but the Zerops API."
      status={error}
      control={
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <Input
            type="password"
            value={tokenInput}
            placeholder="Zerops personal access token"
            autoComplete="off"
            onChange={(event) => setTokenInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") handleSave();
            }}
            className="sm:w-72"
          />
          <Button size="xs" onClick={handleSave} disabled={tokenInput.trim().length === 0}>
            Save
          </Button>
        </div>
      }
    />
  );
}

// Derived from the actual `connectPairing` atom's `AtomCommand<W, A, E>` type
// rather than restated, so a signature change there can't silently drift here.
type ConnectPairingCommand =
  typeof connectPairingAtom extends AtomCommand<infer W, infer A, infer E>
    ? (input: W) => Promise<AtomCommandResult<A, E>>
    : never;

function ConnectProjectForm({
  project,
  connectPairing,
  onDone,
}: {
  readonly project: ZeropsProject;
  readonly connectPairing: ConnectPairingCommand;
  readonly onDone: () => void;
}) {
  const [pairingCode, setPairingCode] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const host = project.zcpService?.url ?? "";

  const handleConnect = useCallback(async () => {
    const trimmedCode = pairingCode.trim();
    if (!trimmedCode) {
      setResult({ ok: false, message: "Enter the pairing code." });
      return;
    }
    setIsConnecting(true);
    setResult(null);
    const outcome = await connectPairing({ host, pairingCode: trimmedCode });
    setIsConnecting(false);
    if (outcome._tag === "Failure") {
      if (isAtomCommandInterrupted(outcome)) return;
      const error = squashAtomCommandFailure(outcome);
      const message = error instanceof Error ? error.message : "Failed to connect.";
      setResult({ ok: false, message });
      return;
    }
    setResult({ ok: true, message: `Connected to ${project.name}.` });
    onDone();
  }, [connectPairing, host, onDone, pairingCode, project.name]);

  return (
    <div className="mt-3 space-y-2 border-t border-border/50 pt-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input value={host} readOnly disabled className="sm:w-72" />
        <Input
          value={pairingCode}
          onChange={(event) => setPairingCode(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void handleConnect();
          }}
          placeholder="Pairing code"
          autoComplete="off"
          disabled={isConnecting}
          className="sm:w-48"
        />
        <Button size="xs" onClick={() => void handleConnect()} disabled={isConnecting}>
          {isConnecting ? "Connecting…" : "Connect"}
        </Button>
      </div>
      {result ? (
        <p className={cnResultText(result.ok)}>{result.message}</p>
      ) : (
        <p className="text-[11px] text-muted-foreground/70">
          Find the pairing code in the code-server terminal of this project's{" "}
          <code className="font-mono">zcp</code> service.
        </p>
      )}
    </div>
  );
}

function cnResultText(ok: boolean): string {
  return ok ? "text-xs text-success" : "text-xs text-destructive";
}

function ProjectRow({
  row,
  connectPairing,
}: {
  readonly row: ZeropsProjectRow;
  readonly connectPairing: ConnectPairingCommand;
}) {
  const [isConnectOpen, setIsConnectOpen] = useState(false);
  const { project, resolution } = row;

  return (
    <div className={ITEM_ROW_CLASSNAME}>
      <div className={ITEM_ROW_INNER_CLASSNAME}>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex min-h-5 items-center gap-1.5">
            <h3 className="truncate text-sm font-medium text-foreground">{project.name}</h3>
            <StatusPill status={project.status} />
          </div>
          <p className="text-xs text-muted-foreground">
            {resolution.status === "loading" || resolution.status === "pending" ? (
              <span className="inline-flex items-center gap-1.5">
                <Spinner className="size-3" />
                Resolving services…
              </span>
            ) : resolution.status === "error" ? (
              <span className="text-destructive">{resolution.message}</span>
            ) : project.zcpService ? (
              <span className="truncate font-mono text-[11px]">{project.zcpService.url}</span>
            ) : (
              "No zcp service in this project."
            )}
          </p>
        </div>
        <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto sm:justify-end">
          {resolution.status === "resolved" && project.zcpService ? (
            <Button size="xs" variant="outline" onClick={() => setIsConnectOpen((open) => !open)}>
              {isConnectOpen ? "Cancel" : "Connect"}
            </Button>
          ) : null}
        </div>
      </div>
      {isConnectOpen && project.zcpService ? (
        <ConnectProjectForm
          project={project}
          connectPairing={connectPairing}
          onDone={() => setIsConnectOpen(false)}
        />
      ) : null}
    </div>
  );
}

export function ZeropsSettings() {
  const [token, setTokenState] = useState<string | null>(() => getToken());
  const [rows, setRows] = useState<ReadonlyArray<ZeropsProjectRow>>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [loadNonce, setLoadNonce] = useState(0);

  const connectPairing = useAtomCommand(connectPairingAtom, { reportFailure: false });

  // Bumped on every unmount/refresh so an in-flight load's callbacks become no-ops.
  const loadGenerationRef = useRef(0);

  useEffect(() => {
    if (!token) {
      setRows([]);
      return;
    }

    loadGenerationRef.current += 1;
    const generation = loadGenerationRef.current;
    const isCancelled = () => loadGenerationRef.current !== generation;

    setIsLoadingProjects(true);
    setProjectsError(null);
    setRows([]);

    void (async () => {
      try {
        const projects = await fetchAllProjects();
        if (isCancelled()) return;
        setRows(
          projects.map((project) => ({ project, resolution: { status: "pending" as const } })),
        );
        setIsLoadingProjects(false);

        setRows((current) =>
          current.map((row) => ({ ...row, resolution: { status: "loading" as const } })),
        );

        await resolveRowsWithConcurrency(
          projects.map((project) => project.id),
          RESOLUTION_CONCURRENCY,
          isCancelled,
          (projectId, outcome) => {
            setRows((current) =>
              current.map((row) => {
                if (row.project.id !== projectId) return row;
                if (outcome.status === "resolved") {
                  const nextProject: ZeropsProject = { ...row.project, ...outcome.project };
                  return { project: nextProject, resolution: { status: "resolved" as const } };
                }
                return {
                  ...row,
                  resolution: { status: "error" as const, message: outcome.message },
                };
              }),
            );
          },
        );
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

  const handleForgetToken = useCallback(() => {
    clearToken();
    setTokenState(null);
    setRows([]);
    setProjectsError(null);
  }, []);

  const handleRefresh = useCallback(() => {
    setLoadNonce((n) => n + 1);
  }, []);

  return (
    <SettingsPageContainer>
      <SettingsSection
        title="Zerops"
        icon={<CloudIcon className="size-4.5 text-muted-foreground" />}
        headerAction={
          token ? (
            <div className="flex items-center gap-2">
              <Button
                size="xs"
                variant="ghost"
                onClick={handleRefresh}
                disabled={isLoadingProjects}
                aria-label="Refresh projects"
              >
                <RefreshCwIcon className={isLoadingProjects ? "size-3 animate-spin" : "size-3"} />
                Refresh
              </Button>
              <Button size="xs" variant="destructive-outline" onClick={handleForgetToken}>
                Forget token
              </Button>
            </div>
          ) : undefined
        }
      >
        {!token ? (
          <TokenGate onTokenSaved={(saved) => setTokenState(saved)} />
        ) : (
          <>
            {projectsError ? (
              <SettingsRow title="Could not load projects" description={projectsError} />
            ) : null}
            {!projectsError && isLoadingProjects && rows.length === 0 ? (
              <div className={ITEM_ROW_CLASSNAME}>
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Spinner className="size-3" />
                  Loading projects…
                </p>
              </div>
            ) : null}
            {!projectsError && !isLoadingProjects && rows.length === 0 ? (
              <Empty className="min-h-52">
                <EmptyMedia variant="icon">
                  <CloudIcon />
                </EmptyMedia>
                <EmptyHeader>
                  <EmptyTitle>No Zerops projects</EmptyTitle>
                  <EmptyDescription>
                    This token's organization doesn't have any projects yet.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : null}
            {rows.map((row) => (
              <ProjectRow key={row.project.id} row={row} connectPairing={connectPairing} />
            ))}
          </>
        )}
      </SettingsSection>
    </SettingsPageContainer>
  );
}
