import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId } from "@t3tools/contracts";
import { CloudIcon, RotateCcwIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ZeropsProjectPicker } from "~/components/zerops/ZeropsProjectPicker";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { sortScopedProjectsForSidebar } from "~/components/Sidebar.logic";
import {
  useAllEnvironmentShellsBootstrapped,
  useProjects,
  useThreadShells,
} from "~/state/entities";
import { useZeropsCandidates } from "~/zerops/candidates";

import { selectSoleConnectedEnvironmentId } from "./candidateSelection";
import { ZeropsLandingShell } from "./ZeropsLandingShell";

const PICKER_CARD_CLASS_NAME =
  "w-full max-w-3xl rounded-3xl border border-border/55 bg-card/20 px-8 py-10 shadow-sm/5";

/**
 * Renders once `useZeropsSession()` reports `signedIn`. Jumps straight into
 * the connected project when there is exactly one, otherwise shows the
 * picker. The navigate effect below mirrors `IndexDraftLanding`'s own
 * "resolve a target, then navigate into it" shape in `_chat.index.tsx` —
 * same double-navigation guard, same not-yet-bootstrapped handling — just
 * scoped to one known environment instead of a cross-environment search for
 * the most recently active project.
 *
 * `useZeropsCandidates` only ever marks a candidate `"connected"` by
 * matching its derived z3 origin against an environment `useEnvironments()`
 * already knows (`zerops/candidates.ts`) — so in the one place this
 * component is mounted (`HostedStaticOnboardingState`, gated on zero known
 * environments), that branch can't fire from pre-existing state. It stays
 * live for a return visit where environments and candidates are both
 * already populated, and it's exercised for real by `handleConnected`
 * below, which drives the exact same "exactly one, go straight in" path the
 * instant this session's own connect action resolves.
 */
export function ZeropsSignedInLanding() {
  // `ZeropsProjectPicker` below fetches candidates itself for its own list,
  // loading state, and error UI — this call exists only to decide, before
  // ever rendering the picker, whether there is exactly one connected
  // project to jump straight into instead.
  const { candidates, isLoading } = useZeropsCandidates();
  // Only trust the derived "exactly one connected" answer once every
  // candidate has finished resolving — `candidates` grows as overviews
  // stream in, so reading it mid-load risks landing on a project that a
  // moment later turns out not to be the sole connected one.
  const derivedTargetEnvironmentId = useMemo(
    () => (isLoading ? null : selectSoleConnectedEnvironmentId(candidates)),
    [candidates, isLoading],
  );
  // The picker's `onConnected` fires the instant a project is connected,
  // ahead of whatever round-trip `useZeropsCandidates` needs before it
  // reports that same environment as "connected" on its own — without this,
  // there is a visible flash back to the picker right after connecting.
  // Unlike the derived answer, this one is exempt from the loading guard
  // above: it names a specific environment this session just connected,
  // not a possibly-still-growing list.
  const [justConnectedEnvironmentId, setJustConnectedEnvironmentId] =
    useState<EnvironmentId | null>(null);
  const targetEnvironmentId = justConnectedEnvironmentId ?? derivedTargetEnvironmentId;

  const projects = useProjects();
  const threads = useThreadShells();
  const bootstrapped = useAllEnvironmentShellsBootstrapped();
  const handleNewThread = useNewThreadHandler();
  const startingRef = useRef(false);
  const [startState, setStartState] = useState({ failed: false, retryRequest: 0 });

  const targetProject = useMemo(() => {
    if (targetEnvironmentId === null || !bootstrapped) return null;
    return (
      sortScopedProjectsForSidebar(
        projects.filter((project) => project.environmentId === targetEnvironmentId),
        threads,
        "updated_at",
      )[0] ?? null
    );
  }, [bootstrapped, projects, targetEnvironmentId, threads]);

  useEffect(() => {
    if (targetProject === null || startingRef.current) {
      return;
    }
    startingRef.current = true;
    void handleNewThread(scopeProjectRef(targetProject.environmentId, targetProject.id), {
      replace: true,
    }).catch(() => {
      startingRef.current = false;
      setStartState((state) => ({ ...state, failed: true }));
    });
  }, [handleNewThread, targetProject, startState.retryRequest]);

  const handleConnected = useCallback((environmentId: EnvironmentId) => {
    setJustConnectedEnvironmentId(environmentId);
  }, []);

  if (targetEnvironmentId !== null) {
    if (startState.failed) {
      return (
        <ZeropsLandingShell
          icon={<CloudIcon className="size-5" />}
          title="Couldn’t open this project"
          description="The project is still connected. Try opening it again."
        >
          <Button
            size="sm"
            onClick={() =>
              setStartState((state) => ({ failed: false, retryRequest: state.retryRequest + 1 }))
            }
          >
            <RotateCcwIcon className="size-4" />
            Try again
          </Button>
        </ZeropsLandingShell>
      );
    }
    if (bootstrapped && targetProject === null) {
      // The environment is connected but its initial project hasn't shown
      // up in the shell snapshot yet — a moment, not a dead end.
      return (
        <ZeropsLandingShell
          icon={<Spinner className="size-5" />}
          title="Setting up your project…"
          description="This only takes a moment the first time a project connects."
        />
      );
    }
    return null;
  }

  if (isLoading) {
    return null;
  }

  return (
    <ZeropsLandingShell
      icon={<CloudIcon className="size-5" />}
      title="Connect a project"
      description="Pick a Zerops project to start working in."
      cardClassName={PICKER_CARD_CLASS_NAME}
    >
      <ZeropsProjectPicker onConnected={handleConnected} />
    </ZeropsLandingShell>
  );
}
