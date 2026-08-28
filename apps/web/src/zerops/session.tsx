import {
  createContext,
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { requiresZeropsTwoFactor, type ZeropsUser } from "@t3tools/client-runtime/zerops";

import { setToken, subscribeToken, zeropsClient } from "./api";

export type ZeropsAuthState =
  | { readonly status: "loading" }
  | { readonly status: "signedOut" }
  | { readonly status: "restorationError"; readonly message: string }
  | {
      readonly status: "twoFactor";
      readonly user: ZeropsUser;
      readonly methods: ReadonlyArray<string>;
    }
  | {
      readonly status: "signedIn";
      readonly user: ZeropsUser;
      /** Which credential is behind this session — drives "Sign out" vs "Forget token" UI. */
      readonly credentialKind: "session" | "token";
      readonly newRecoveryToken?: string;
    };

interface ZeropsSessionContextValue {
  readonly auth: ZeropsAuthState;
  readonly signIn: (email: string, password: string) => Promise<void>;
  readonly verifyTwoFactor: (token: string) => Promise<void>;
  readonly cancelTwoFactor: () => Promise<void>;
  readonly signOut: () => Promise<void>;
  readonly retryRestore: () => Promise<void>;
  readonly signInWithToken: (token: string) => void;
}

const ZeropsSessionContext = createContext<ZeropsSessionContextValue | null>(null);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Could not restore your Zerops session.";
}

/**
 * Mirrors `apps/mobile/src/features/zerops/ZeropsAuthProvider.tsx`'s state
 * machine, backed by the same shared `ZeropsApiClient` — but web's singleton
 * lives in `./api.ts` (see its doc-comment for why), not in this provider,
 * since the frozen Settings/projects surfaces call plain functions from
 * `./api.ts` without going through React context at all.
 */
export function ZeropsSessionProvider({ children }: { readonly children: ReactNode }) {
  const [auth, setAuth] = useState<ZeropsAuthState>({ status: "loading" });

  const restore = useCallback(async (options?: { readonly silent?: boolean }) => {
    const credential = zeropsClient.credential;
    if (credential?.kind === "session" && requiresZeropsTwoFactor(credential.session)) {
      // A mid-2FA credential is only ever set by `signIn`, which already
      // manages this transition itself — it has the login response's `user`
      // object, which a bare restored credential doesn't carry. Leave it.
      return;
    }
    if (!options?.silent) setAuth({ status: "loading" });
    if (!credential) {
      setAuth({ status: "signedOut" });
      return;
    }
    try {
      const user = await zeropsClient.fetchUser();
      setAuth({
        status: "signedIn",
        user,
        credentialKind: credential.kind,
        ...(credential.kind === "session" && credential.session.newRecoveryToken
          ? { newRecoveryToken: credential.session.newRecoveryToken }
          : {}),
      });
    } catch (error) {
      if (!zeropsClient.credential) {
        setAuth({ status: "signedOut" });
        return;
      }
      setAuth({ status: "restorationError", message: errorMessage(error) });
    }
  }, []);

  useEffect(() => {
    void restore();
  }, [restore]);

  // Any credential change from outside this hook's own actions below — the
  // legacy `setToken`/`clearToken` path, or another tab — lands here too.
  useEffect(() => subscribeToken(() => void restore({ silent: true })), [restore]);

  const signIn = useCallback(async (email: string, password: string) => {
    const response = await zeropsClient.login(email, password);
    if (requiresZeropsTwoFactor(response.auth)) {
      setAuth({
        status: "twoFactor",
        user: response.user,
        methods: response.auth.twoFAMethods ?? [],
      });
      return;
    }
    setAuth({
      status: "signedIn",
      user: response.user,
      credentialKind: "session",
      ...(response.auth.newRecoveryToken
        ? { newRecoveryToken: response.auth.newRecoveryToken }
        : {}),
    });
  }, []);

  const verifyTwoFactor = useCallback(
    async (token: string) => {
      if (auth.status !== "twoFactor") return;
      const session = await zeropsClient.verifyTotp(token);
      setAuth({
        status: "signedIn",
        user: auth.user,
        credentialKind: "session",
        ...(session.newRecoveryToken ? { newRecoveryToken: session.newRecoveryToken } : {}),
      });
    },
    [auth],
  );

  const cancelTwoFactor = useCallback(async () => {
    await zeropsClient.discardCredential();
  }, []);

  const signOut = useCallback(async () => {
    try {
      await zeropsClient.logout();
    } catch (error) {
      // Local sign-out must remain available while offline or after expiry.
      // Zerops has already lost the usable client credentials at this point.
      console.warn("[zerops] remote logout failed; cleared local session", error);
      await zeropsClient.discardCredential();
    }
  }, []);

  const signInWithToken = useCallback((token: string) => {
    // Goes through the same `setToken` the legacy Settings token gate uses,
    // so both entry points write through one credential store.
    setToken(token.trim());
  }, []);

  const contextValue = useMemo<ZeropsSessionContextValue>(
    () => ({
      auth,
      signIn,
      verifyTwoFactor,
      cancelTwoFactor,
      signOut,
      retryRestore: () => restore(),
      signInWithToken,
    }),
    [auth, cancelTwoFactor, restore, signIn, signInWithToken, signOut, verifyTwoFactor],
  );

  return <ZeropsSessionContext value={contextValue}>{children}</ZeropsSessionContext>;
}

export function useZeropsSession(): ZeropsSessionContextValue {
  const context = use(ZeropsSessionContext);
  if (!context) throw new Error("useZeropsSession must be used inside ZeropsSessionProvider.");
  return context;
}
