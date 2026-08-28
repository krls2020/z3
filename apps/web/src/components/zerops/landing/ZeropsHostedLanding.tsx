/**
 * What the hosted client shows when nothing is connected yet: sign in or sign
 * up with Zerops, then pick a project. Upstream's manual-connect empty state
 * stays reachable from here — a non-Zerops user is never locked out.
 */

import { useState, type ReactNode } from "react";

import { Spinner } from "../../ui/spinner";
import { useZeropsSession, zeropsErrorMessage } from "~/zerops/ZeropsSessionProvider";
import { useZeropsTurnstile } from "~/zerops/turnstile";

import { ZeropsProjectsPage } from "../ZeropsProjectsPage";
import {
  ZeropsLandingShell,
  ZeropsRegisterForm,
  ZeropsSignInForm,
  ZeropsTotpForm,
} from "./ZeropsLandingShell";

type LandingMode = "sign-in" | "register";

export function ZeropsHostedLanding({ manualFallback }: { readonly manualFallback: ReactNode }) {
  const { status, signIn, register, verifyTotp } = useZeropsSession();
  const [mode, setMode] = useState<LandingMode>("sign-in");
  const [showManual, setShowManual] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const turnstile = useZeropsTurnstile();

  if (showManual) {
    return <>{manualFallback}</>;
  }

  // Signed in: the picker is the landing. It brings its own full-width frame.
  if (status === "signed-in") {
    return <ZeropsProjectsPage />;
  }

  const run = (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    void action()
      .catch((cause: unknown) => {
        setError(zeropsErrorMessage(cause));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const openManual = () => {
    setShowManual(true);
  };

  if (status === "loading") {
    return (
      <ZeropsLandingShell
        title="Zerops Code"
        description="Checking your Zerops session…"
        onManualConnect={openManual}
      >
        <div className="flex justify-center py-4">
          <Spinner className="size-5" />
        </div>
      </ZeropsLandingShell>
    );
  }

  if (status === "totp-required") {
    return (
      <ZeropsLandingShell
        title="One more step"
        description="Enter the code from your authenticator app."
        onManualConnect={openManual}
      >
        <ZeropsTotpForm
          busy={busy}
          error={error}
          onSubmit={(code) => {
            run(() => verifyTotp(code));
          }}
        />
      </ZeropsLandingShell>
    );
  }

  if (mode === "register") {
    return (
      <ZeropsLandingShell
        title="Create a Zerops account"
        description="Your agent runs inside your own Zerops project."
        onManualConnect={openManual}
      >
        <ZeropsRegisterForm
          busy={busy}
          error={error}
          captcha={turnstile.widget}
          onSubmit={(input) => {
            run(() =>
              register({
                ...input,
                ...(turnstile.token ? { turnstileToken: turnstile.token } : {}),
              }),
            );
          }}
          onSwitchToSignIn={() => {
            setError(null);
            setMode("sign-in");
          }}
        />
      </ZeropsLandingShell>
    );
  }

  return (
    <ZeropsLandingShell
      title="Sign in to Zerops"
      description="Pick a project and start talking to the agent inside it."
      onManualConnect={openManual}
    >
      <ZeropsSignInForm
        busy={busy}
        error={error}
        onSubmit={({ email, password }) => {
          run(() => signIn(email, password));
        }}
        onSwitchToRegister={() => {
          setError(null);
          setMode("register");
        }}
      />
    </ZeropsLandingShell>
  );
}
