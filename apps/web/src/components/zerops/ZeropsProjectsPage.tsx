/**
 * `/zerops` — the project picker for a signed-in Zerops account, and the
 * "New project" path beside it (which is also what an exhausted pool falls
 * back to: create a project, import the container recipe, wait for it).
 */

import { useState } from "react";

import { isElectron } from "../../env";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { ScrollArea } from "../ui/scroll-area";
import { SidebarInset } from "../ui/sidebar";
import { Spinner } from "../ui/spinner";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "../WorkspaceBreadcrumb";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
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
        error={error}
        onRefresh={refresh}
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
