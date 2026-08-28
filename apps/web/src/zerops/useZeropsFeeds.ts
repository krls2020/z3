/**
 * Component-facing reads of the two Zerops feeds.
 *
 * Both return `undefined` until the first snapshot arrives, and stay
 * `undefined` forever in a non-Zerops environment. Callers render nothing in
 * that case — there is no loading or error state worth showing for a panel that
 * does not apply here, and a live snapshot says so for itself with
 * `available: false`.
 */
import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  ThreadId,
  ZeropsLifecycle,
  ZeropsTopologySnapshot,
} from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import { zeropsFeeds } from "../state/zerops";

/**
 * Selected when there is no environment or thread to read. Hooks cannot be
 * called conditionally, and pointing the real family at a placeholder id would
 * open a subscription against an environment that does not exist.
 */
const EMPTY_ATOM = Atom.make(undefined).pipe(Atom.withLabel("zerops:feed-empty"));

export function useZeropsTopology(
  environmentId: EnvironmentId | null,
): ZeropsTopologySnapshot | undefined {
  return useAtomValue(
    environmentId === null ? EMPTY_ATOM : zeropsFeeds.topologyValue({ environmentId, input: {} }),
  );
}

export function useZeropsLifecycle(
  environmentId: EnvironmentId | null,
  threadId: ThreadId | null,
): ZeropsLifecycle | undefined {
  return useAtomValue(
    environmentId === null || threadId === null
      ? EMPTY_ATOM
      : zeropsFeeds.lifecycleValue({ environmentId, input: { threadId } }),
  );
}
