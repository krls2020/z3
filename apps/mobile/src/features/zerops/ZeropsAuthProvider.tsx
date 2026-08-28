import {
  createContext,
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  requiresZeropsTwoFactor,
  ZeropsApiClient,
  ZEROPS_API_BASE,
  type ZeropsAuthSession,
  type ZeropsUser,
} from "./zerops-api";
import {
  clearZeropsCredentialOnDevice,
  clearZeropsSelectionOnDevice,
  loadZeropsCredentialFromDevice,
  loadZeropsSelectionFromDevice,
  saveZeropsCredentialOnDevice,
  saveZeropsSelectionOnDevice,
  type ZeropsSelection,
} from "./zerops-session-store";

export type ZeropsAuthState =
  | { readonly status: "loading" }
  | { readonly status: "signedOut" }
  | {
      readonly status: "restorationError";
      readonly message: string;
    }
  | {
      readonly status: "twoFactor";
      readonly user: ZeropsUser;
      readonly methods: ReadonlyArray<string>;
    }
  | {
      readonly status: "signedIn";
      readonly user: ZeropsUser;
      readonly newRecoveryToken?: string;
    };

interface ZeropsAuthContextValue {
  readonly api: ZeropsApiClient;
  readonly auth: ZeropsAuthState;
  readonly selection: ZeropsSelection | null;
  readonly signIn: (email: string, password: string) => Promise<void>;
  readonly verifyTwoFactor: (token: string) => Promise<void>;
  readonly cancelTwoFactor: () => Promise<void>;
  readonly signOut: () => Promise<void>;
  readonly retryRestore: () => Promise<void>;
  readonly selectClient: (clientId: string) => void;
  readonly selectProject: (projectId: string) => void;
}

const ZeropsAuthContext = createContext<ZeropsAuthContextValue | null>(null);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Could not restore your Zerops session.";
}

export function ZeropsAuthProvider(props: { readonly children: ReactNode }) {
  const [auth, setAuth] = useState<ZeropsAuthState>({ status: "loading" });
  const [selection, setSelection] = useState<ZeropsSelection | null>(null);
  const apiRef = useRef<ZeropsApiClient | null>(null);

  if (!apiRef.current) {
    apiRef.current = new ZeropsApiClient({
      baseUrl: ZEROPS_API_BASE,
      onCredentialChange: async (credential) => {
        if (credential) {
          // A mid-2FA partial session is deliberately memory-only — the
          // shared store skips persisting it and clears storage instead.
          await saveZeropsCredentialOnDevice(credential);
          return;
        }
        await clearZeropsCredentialOnDevice();
        setAuth({ status: "signedOut" });
      },
    });
  }
  const api = apiRef.current;

  const completeSignIn = useCallback(async (user: ZeropsUser, session: ZeropsAuthSession) => {
    const nextSelection = await loadZeropsSelectionFromDevice(user.id);
    setSelection(nextSelection);
    setAuth({
      status: "signedIn",
      user,
      ...(session.newRecoveryToken ? { newRecoveryToken: session.newRecoveryToken } : {}),
    });
  }, []);

  const restore = useCallback(async () => {
    setAuth({ status: "loading" });
    try {
      const credential = api.credential ?? (await loadZeropsCredentialFromDevice());
      const session = credential?.kind === "session" ? credential.session : null;
      if (!session) {
        setSelection(null);
        setAuth({ status: "signedOut" });
        return;
      }
      api.restoreSession(session);
      const user = await api.fetchUser();
      await completeSignIn(user, api.session ?? session);
    } catch (error) {
      if (!api.session) {
        setSelection(null);
        setAuth({ status: "signedOut" });
        return;
      }
      setAuth({ status: "restorationError", message: errorMessage(error) });
    }
  }, [api, completeSignIn]);

  useEffect(() => {
    void restore();
  }, [restore]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const response = await api.login(email, password);
      if (requiresZeropsTwoFactor(response.auth)) {
        setSelection(null);
        setAuth({
          status: "twoFactor",
          user: response.user,
          methods: response.auth.twoFAMethods ?? [],
        });
        return;
      }
      await completeSignIn(response.user, response.auth);
    },
    [api, completeSignIn],
  );

  const verifyTwoFactor = useCallback(
    async (token: string) => {
      if (auth.status !== "twoFactor") return;
      const session = await api.verifyTotp(token);
      await completeSignIn(auth.user, session);
    },
    [api, auth, completeSignIn],
  );

  const cancelTwoFactor = useCallback(async () => {
    setSelection(null);
    await api.discardCredential();
  }, [api]);

  const signOut = useCallback(async () => {
    setSelection(null);
    try {
      await api.logout();
    } catch (error) {
      // Local sign-out must remain available while offline or after expiry.
      // Zerops has already lost the usable client credentials at this point.
      console.warn("[zerops] remote logout failed; cleared local session", error);
    } finally {
      setAuth({ status: "signedOut" });
      await Promise.all([clearZeropsCredentialOnDevice(), clearZeropsSelectionOnDevice()]);
    }
  }, [api]);

  const updateSelection = useCallback(
    (update: Pick<ZeropsSelection, "clientId" | "projectId">) => {
      if (auth.status !== "signedIn") return;
      const next: ZeropsSelection = { userId: auth.user.id, ...update };
      setSelection(next);
      void saveZeropsSelectionOnDevice(next).catch((error) => {
        console.warn("[zerops] failed to persist project selection", error);
      });
    },
    [auth],
  );

  const selectClient = useCallback(
    (clientId: string) => {
      updateSelection({ clientId, projectId: null });
    },
    [updateSelection],
  );

  const selectProject = useCallback(
    (projectId: string) => {
      if (!selection?.clientId) return;
      updateSelection({ clientId: selection.clientId, projectId });
    },
    [selection?.clientId, updateSelection],
  );

  const contextValue = useMemo<ZeropsAuthContextValue>(
    () => ({
      api,
      auth,
      selection,
      signIn,
      verifyTwoFactor,
      cancelTwoFactor,
      signOut,
      retryRestore: restore,
      selectClient,
      selectProject,
    }),
    [
      api,
      auth,
      cancelTwoFactor,
      restore,
      selectClient,
      selection,
      selectProject,
      signIn,
      signOut,
      verifyTwoFactor,
    ],
  );

  return <ZeropsAuthContext value={contextValue}>{props.children}</ZeropsAuthContext>;
}

export function useZeropsAuth(): ZeropsAuthContextValue {
  const context = use(ZeropsAuthContext);
  if (!context) throw new Error("useZeropsAuth must be used inside ZeropsAuthProvider.");
  return context;
}
