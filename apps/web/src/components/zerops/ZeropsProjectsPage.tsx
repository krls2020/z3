/**
 * `/zerops` — the project picker for a signed-in Zerops account, and the
 * "New project" path beside it (which is also what an exhausted pool falls
 * back to: create a project, import the container recipe, wait for it).
 */

import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";

import { connectZeropsIdentity as connectZeropsIdentityAtom } from "../../connection/onboarding";
import { isElectron } from "../../env";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { ScrollArea } from "../ui/scroll-area";
import { SidebarInset } from "../ui/sidebar";
import { Spinner } from "../ui/spinner";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "../WorkspaceBreadcrumb";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { zeropsCodeBaseUrl, type ZeropsCandidate } from "~/zerops/candidates";
import { rememberZeropsEnvironment } from "~/zerops/firstPrompt";
import { useZeropsCandidates } from "~/zerops/useZeropsCandidates";
import { useZeropsProvisioning } from "~/zerops/useZeropsProvisioning";
import { useZeropsSession, zeropsErrorMessage } from "~/zerops/ZeropsSessionProvider";

import { ZeropsProjectPicker } from "./ZeropsProjectPicker";
import { ZeropsProvisioningPanel } from "./ZeropsProvisioningPanel";

function SignedOutNotice({ message }: { readonly message: string }) {
  return <p className="text-sm text-muted-foreground">{message}</p>;
}

function NewProjectForm({
  onCreate,
  busy,
  error,
}: {
  readonly onCreate: (input: { readonly clientId: string; readonly name: string }) => void;
  readonly busy: boolean;
  readonly error: string | null;
}) {
  const { organizations } = useZeropsSession();
  const [name, setName] = useState("zerops-code");

  if (organizations.length === 0) return null;

  return (
    <section className="space-y-3 rounded-xl border border-border/55 bg-card/20 px-4 py-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground">New project</h2>
        <p className="text-xs text-muted-foreground">
          Creates a Zerops project with a Zerops Code container in it.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="zerops-new-project">Project name</Label>
        <Input
          id="zerops-new-project"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        {organizations.map((organization) => (
          <Button
            key={organization.id}
            size="sm"
            disabled={busy || name.trim().length === 0}
            onClick={() => {
              onCreate({ clientId: organization.id, name });
            }}
          >
            {busy ? <Spinner className="size-4" /> : null}
            {organizations.length === 1 ? "Create project" : `Create in ${organization.name}`}
          </Button>
        ))}
      </div>
      {error ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/8 px-3 py-2 text-sm text-destructive-foreground">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function ZeropsProjectsContent() {
  const { status, client } = useZeropsSession();
  const { candidates, isLoading, error, refresh } = useZeropsCandidates();
  const [creatingIn, setCreatingIn] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const provisioning = useZeropsProvisioning(creatingIn);
  const connectZerops = useAtomCommand(connectZeropsIdentityAtom, { reportFailure: false });
  const navigate = useNavigate();
  const [connectError, setConnectError] = useState<string | null>(null);
  // One connect per settled wait, however many renders that takes.
  const connectingRef = useRef<string | null>(null);

  const connectContainer = useCallback(
    async (containerOrigin: string) => {
      const zeropsToken = client.session?.accessToken;
      if (!zeropsToken) {
        setConnectError("Sign in to Zerops again to connect this container.");
        return;
      }
      const result = await connectZerops({
        httpBaseUrl: zeropsCodeBaseUrl(containerOrigin),
        zeropsToken,
      });
      if (result._tag === "Failure") {
        setConnectError("This container refused the connection. Check the project in Zerops.");
        return;
      }
      // The landing composes the opening message on the draft it creates; it
      // only needs to know this environment came through the Zerops door.
      rememberZeropsEnvironment(String(result.value));
      provisioning.cancel();
      setCreatingIn(null);
      await navigate({ to: "/" });
    },
    [client, connectZerops, navigate, provisioning],
  );

  const readyOrigin =
    provisioning.state?.phase === "ready" ? provisioning.state.containerOrigin : null;

  useEffect(() => {
    if (!readyOrigin || connectingRef.current === readyOrigin) return;
    connectingRef.current = readyOrigin;
    void connectContainer(readyOrigin);
  }, [connectContainer, readyOrigin]);

  if (status === "loading") {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="size-4" />
        Checking your Zerops session…
      </div>
    );
  }
  if (status === "signed-out") {
    return <SignedOutNotice message="Sign in with your Zerops account to see your projects." />;
  }
  if (status === "totp-required") {
    return <SignedOutNotice message="Finish signing in with your two-factor code." />;
  }

  if (provisioning.state) {
    return (
      <div className="space-y-4">
        <ZeropsProvisioningPanel
          state={provisioning.state}
          busy={provisioning.busy}
          error={provisioning.error}
          onRetry={provisioning.retry}
          onEnable={provisioning.enable}
        />
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            provisioning.cancel();
            setCreatingIn(null);
            refresh();
          }}
        >
          {provisioning.state.phase === "ready" ? "Back to projects" : "Stop waiting"}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <ZeropsProjectPicker
        candidates={candidates}
        isLoading={isLoading}
        error={connectError ?? error}
        onRefresh={refresh}
        onConnect={(candidate: ZeropsCandidate) => {
          if (!candidate.containerOrigin) return;
          setConnectError(null);
          connectingRef.current = null;
          setCreatingIn(candidate.project.clientId ?? null);
          provisioning.startForContainer({
            projectId: candidate.project.id,
            serviceId: candidate.service?.id ?? null,
            containerOrigin: candidate.containerOrigin,
          });
        }}
      />
      <NewProjectForm
        busy={creating}
        error={createError}
        onCreate={({ clientId, name }) => {
          setCreating(true);
          setCreateError(null);
          void client
            .createProjectWithZeropsCode({ clientId, name })
            .then(() => {
              setCreatingIn(clientId);
              provisioning.start({ zcpClaimed: true });
            })
            .catch((cause: unknown) => {
              setCreateError(zeropsErrorMessage(cause));
            })
            .finally(() => {
              setCreating(false);
            });
        }}
      />
    </div>
  );
}

export function ZeropsProjectsPage() {
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        <WorkspacePageHeader electron={isElectron}>
          <WorkspaceBreadcrumb ariaLabel="Zerops breadcrumb" className="min-w-0">
            <WorkspaceBreadcrumbItem current>Zerops</WorkspaceBreadcrumbItem>
          </WorkspaceBreadcrumb>
        </WorkspacePageHeader>

        <ScrollArea className="min-h-0 flex-1">
          <WorkspacePageContainer width="wide">
            <ZeropsProjectsContent />
          </WorkspacePageContainer>
        </ScrollArea>
      </div>
    </SidebarInset>
  );
}
