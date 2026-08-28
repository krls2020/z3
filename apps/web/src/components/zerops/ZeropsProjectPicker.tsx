/**
 * The Zerops project picker: every container the signed-in account can reach,
 * grouped into connected / ready / unavailable. The grouping decisions all
 * live in `deriveZeropsCandidates`; this file only renders them.
 */

import { RotateCcwIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { groupZeropsCandidates, type ZeropsCandidate } from "~/zerops/candidates";

function CandidateRow({
  candidate,
  action,
}: {
  readonly candidate: ZeropsCandidate;
  readonly action?: ReactNode | undefined;
}) {
  return (
    <li className="flex items-center justify-between gap-4 rounded-xl border border-border/55 bg-card/20 px-4 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">
            {candidate.project.name}
          </span>
          {candidate.service ? (
            <Badge size="sm" variant="outline">
              {candidate.service.name}
            </Badge>
          ) : null}
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {candidate.reason ?? candidate.containerOrigin ?? candidate.project.id}
        </p>
      </div>
      {action}
    </li>
  );
}

function CandidateGroup({
  title,
  description,
  candidates,
  renderAction,
}: {
  readonly title: string;
  readonly description: string;
  readonly candidates: ReadonlyArray<ZeropsCandidate>;
  readonly renderAction?: ((candidate: ZeropsCandidate) => ReactNode) | undefined;
}) {
  if (candidates.length === 0) return null;
  return (
    <section className="space-y-2">
      <div>
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <ul className="space-y-2">
        {candidates.map((candidate) => (
          <CandidateRow
            key={candidate.key}
            candidate={candidate}
            action={renderAction?.(candidate)}
          />
        ))}
      </ul>
    </section>
  );
}

/**
 * `onConnect` is supplied once identity bootstrap exists; without it the rows
 * are informational and no half-wired button is rendered.
 */
export function ZeropsProjectPicker({
  candidates,
  isLoading,
  error,
  onRefresh,
  onConnect,
  onOpen,
}: {
  readonly candidates: ReadonlyArray<ZeropsCandidate>;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly onRefresh: () => void;
  readonly onConnect?: ((candidate: ZeropsCandidate) => void) | undefined;
  readonly onOpen?: ((candidate: ZeropsCandidate) => void) | undefined;
}) {
  const grouped = groupZeropsCandidates(candidates);
  const empty = !isLoading && candidates.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {isLoading ? (
            <>
              <Spinner className="size-3.5" />
              <span>Reading your Zerops projects…</span>
            </>
          ) : (
            <span>
              {candidates.length} container{candidates.length === 1 ? "" : "s"} across your
              organizations
            </span>
          )}
        </div>
        <Button size="sm" variant="ghost" onClick={onRefresh} disabled={isLoading}>
          <RotateCcwIcon className="size-4" />
          Refresh
        </Button>
      </div>

      {error ? (
        <p className="rounded-xl border border-destructive/40 bg-destructive/8 px-4 py-3 text-sm text-destructive-foreground">
          {error}
        </p>
      ) : null}

      <CandidateGroup
        title="Connected"
        description="Already available in this app."
        candidates={grouped.connected}
        renderAction={
          onOpen
            ? (candidate) => (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    onOpen(candidate);
                  }}
                >
                  Open
                </Button>
              )
            : undefined
        }
      />
      <CandidateGroup
        title="Ready to connect"
        description="A Zerops Code container is running and reachable."
        candidates={grouped.ready}
        renderAction={
          onConnect
            ? (candidate) => (
                <Button
                  size="sm"
                  onClick={() => {
                    onConnect(candidate);
                  }}
                >
                  Connect
                </Button>
              )
            : undefined
        }
      />
      <CandidateGroup
        title="Not available"
        description="Each row says what is in the way."
        candidates={grouped.unavailable}
      />

      {empty ? (
        <p className="text-sm text-muted-foreground">No projects in this account yet.</p>
      ) : null}
    </div>
  );
}
