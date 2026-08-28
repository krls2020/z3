/**
 * The signed-in Zerops account, available to every route.
 *
 * It sits outside the router because Zerops identity is independent of T3's
 * environment auth gate: `/zerops` and `/settings/zerops` are reachable
 * through more than one branch of that gate, and the session has to outlive
 * route transitions.
 *
 * The access token lives here and in `localStorage` — never on a z3 server.
 */

import {
  ZeropsApiClient,
  ZeropsApiError,
  clearZeropsSession,
  loadZeropsSession,
  requiresZeropsTwoFactor,
  saveZeropsSession,
  zeropsClientsFromUser,
  type ZeropsOrganization,
  type ZeropsSession,
  type ZeropsStorageAdapter,
  type ZeropsUser,
} from "@t3tools/client-runtime/zerops";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { browserZeropsStorage } from "./storage";

export type ZeropsSessionStatus = "loading" | "signed-out" | "totp-required" | "signed-in";

export interface ZeropsSessionValue {
  readonly client: ZeropsApiClient;
  readonly status: ZeropsSessionStatus;
  readonly user: ZeropsUser | null;
  readonly organizations: ReadonlyArray<ZeropsOrganization>;
  readonly signIn: (email: string, password: string) => Promise<void>;
  readonly verifyTotp: (code: string) => Promise<void>;
  readonly signOut: () => Promise<void>;
}

const ZeropsSessionContext = createContext<ZeropsSessionValue | null>(null);

export function zeropsErrorMessage(error: unknown): string {
  if (error instanceof ZeropsApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong talking to Zerops.";
}

export function ZeropsSessionProvider({
  children,
  storage = browserZeropsStorage,
}: {
  readonly children: ReactNode;
  readonly storage?: ZeropsStorageAdapter;
}) {
  const [status, setStatus] = useState<ZeropsSessionStatus>("loading");
  const [user, setUser] = useState<ZeropsUser | null>(null);

  const client = useMemo(
    () =>
      new ZeropsApiClient({
        onSessionChange: (session: ZeropsSession | null) => {
          if (session === null) {
            // The client clears itself when a refresh fails mid-flight, so a
            // session that dies between renders cannot leave an
            // authorized-looking UI behind.
            setStatus("signed-out");
            setUser(null);
            return clearZeropsSession(storage);
          }
          return saveZeropsSession(storage, session);
        },
      }),
    [storage],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const session = await loadZeropsSession(storage);
      if (cancelled) return;
      if (!session) {
        setStatus("signed-out");
        return;
      }
      client.restoreSession(session);
      try {
        const restored = await client.fetchUser();
        if (cancelled) return;
        setUser(restored);
        setStatus("signed-in");
      } catch {
        // A stored session that no longer works reads as signed out; the
        // client has already cleared it if the API said so.
        if (cancelled) return;
        setStatus("signed-out");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, storage]);

  const value = useMemo<ZeropsSessionValue>(
    () => ({
      client,
      status,
      user,
      organizations: user ? zeropsClientsFromUser(user) : [],
      signIn: async (email, password) => {
        const response = await client.login(email, password);
        if (requiresZeropsTwoFactor(response.auth)) {
          setStatus("totp-required");
          return;
        }
        setUser(response.user ?? (await client.fetchUser()));
        setStatus("signed-in");
      },
      verifyTotp: async (code) => {
        await client.verifyTotp(code);
        setUser(await client.fetchUser());
        setStatus("signed-in");
      },
      signOut: async () => {
        await client.logout();
      },
    }),
    [client, status, user],
  );

  return <ZeropsSessionContext value={value}>{children}</ZeropsSessionContext>;
}

export function useZeropsSession(): ZeropsSessionValue {
  const value = useContext(ZeropsSessionContext);
  if (!value) {
    throw new Error("useZeropsSession must be used inside a ZeropsSessionProvider.");
  }
  return value;
}
