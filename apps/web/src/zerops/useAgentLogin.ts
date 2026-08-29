/**
 * Fires the agent-login RPC (S7 follow-up F8): open the login terminal
 * panel, then ask the server to run the CLI's own login command and walk
 * its output. What the user needs to act on comes back on the
 * `ZeropsAgentAuth` row's `login` field (`useZeropsAgentAuth`), not from
 * this call directly.
 *
 * Deliberately thin — the RPC does all the deciding now; this hook is just
 * the wiring that fires it and makes the terminal panel visible so the user
 * can watch (and, once the CLI asks for it, paste a code into) the session
 * the server just started.
 */
import type { ScopedThreadRef, ZeropsAgentId } from "@t3tools/contracts";
import { useCallback } from "react";

import { zeropsFeeds } from "../state/zerops";
import { useAtomCommand } from "../state/use-atom-command";
import { useTerminalUiStateStore } from "../terminalUiStateStore";

export function useAgentLogin(threadRef: ScopedThreadRef | null): (agentId: ZeropsAgentId) => void {
  const setTerminalOpen = useTerminalUiStateStore((state) => state.setTerminalOpen);
  const startLogin = useAtomCommand(zeropsFeeds.agentLoginStart, "zerops agent login start");

  return useCallback(
    (agentId: ZeropsAgentId) => {
      if (threadRef === null) {
        return;
      }
      // Open the panel first — the CLI's own output starts arriving the
      // moment the server writes the login command, and the user needs the
      // pane visible from the start (not just once a paste prompt appears).
      setTerminalOpen(threadRef, true);
      // `startLogin` already reports its own failure (useAtomCommand's
      // default reportFailure); there is nothing further to await here.
      void startLogin({
        environmentId: threadRef.environmentId,
        input: { agentId, threadId: threadRef.threadId },
      });
    },
    [threadRef, setTerminalOpen, startLogin],
  );
}
