/**
 * Fires the agent-login terminal move (S7 plan D4): open the login terminal,
 * then type the CLI's own login command into it.
 *
 * Deliberately thin — everything decidable without React or the RPC layer
 * (which terminal, which cwd, the exact payloads) lives in the pure
 * `buildAgentLoginTerminalPlan` (`agentLogin.ts`, tested directly); this hook
 * is just the wiring that fires it, mirroring the shape `runProjectScript`
 * uses in `ChatView.tsx` (`setTerminalOpen(true)` → `openTerminal` →
 * `writeTerminal`). Not extracted from `runProjectScript` itself: that
 * function is tightly coupled to ChatView-local state that has nothing to do
 * with signing in (busy-terminal detection, project cwd derivation, extra env
 * vars, focus-request bookkeeping, thread error toasts) — sharing it would
 * mean threading all of that through for a simple, deterministic, rarely
 * used action instead. See the S7-2 report for what this means for a future
 * unification pass.
 */
import type { ScopedThreadRef, ZeropsAgentId } from "@t3tools/contracts";
import { useCallback } from "react";

import { terminalEnvironment } from "../state/terminal";
import { useAtomCommand } from "../state/use-atom-command";
import { useTerminalUiStateStore } from "../terminalUiStateStore";
import { buildAgentLoginTerminalPlan } from "./agentLogin";

export function useAgentLogin(threadRef: ScopedThreadRef | null): (agentId: ZeropsAgentId) => void {
  const setTerminalOpen = useTerminalUiStateStore((state) => state.setTerminalOpen);
  const openTerminal = useAtomCommand(terminalEnvironment.open, "terminal open");
  const writeTerminal = useAtomCommand(terminalEnvironment.write, "terminal write");

  return useCallback(
    (agentId: ZeropsAgentId) => {
      if (threadRef === null) {
        return;
      }
      const { openInput, writeInput } = buildAgentLoginTerminalPlan(threadRef, agentId);

      setTerminalOpen(threadRef, true);
      void (async () => {
        const openResult = await openTerminal({
          environmentId: threadRef.environmentId,
          input: openInput,
        });
        if (openResult._tag === "Failure") {
          // openTerminal already reports its own failure (useAtomCommand's
          // default reportFailure); writing the login command into a
          // terminal that never opened would just land nowhere.
          return;
        }
        await writeTerminal({
          environmentId: threadRef.environmentId,
          input: writeInput,
        });
      })();
    },
    [threadRef, setTerminalOpen, openTerminal, writeTerminal],
  );
}
