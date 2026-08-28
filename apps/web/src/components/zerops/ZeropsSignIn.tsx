import { useCallback, useState } from "react";

import { useZeropsSession } from "~/zerops/session";

import { Alert, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";

function FieldLabel({ children }: { readonly children: string }) {
  return (
    <p className="text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
      {children}
    </p>
  );
}

/** Email + password, then TOTP or a recovery code — real Zerops account login, matching the mobile flow. */
function CredentialsStep() {
  const { signIn } = useZeropsSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(() => {
    if (busy || !email.trim() || !password) return;
    setBusy(true);
    setError(null);
    void signIn(email, password)
      .catch((cause) => {
        setError(cause instanceof Error ? cause.message : "Zerops sign-in failed.");
      })
      .finally(() => setBusy(false));
  }, [busy, email, password, signIn]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <FieldLabel>Email</FieldLabel>
        <Input
          type="email"
          value={email}
          autoComplete="username"
          autoCapitalize="off"
          autoCorrect="off"
          disabled={busy}
          onChange={(event) => setEmail(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit();
          }}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <FieldLabel>Password</FieldLabel>
        <Input
          type="password"
          value={password}
          autoComplete="current-password"
          disabled={busy}
          onChange={(event) => setPassword(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit();
          }}
        />
      </div>
      {error ? (
        <Alert variant="error">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <Button onClick={submit} disabled={busy || !email.trim() || !password}>
        {busy ? (
          <>
            <Spinner className="size-3.5" /> Signing in…
          </>
        ) : (
          "Sign in"
        )}
      </Button>
    </div>
  );
}

/** The 2FA step: an authenticator code, or a recovery code — both submit to the same endpoint. */
function TwoFactorStep({ methods }: { readonly methods: ReadonlyArray<string> }) {
  const { cancelTwoFactor, verifyTwoFactor } = useZeropsSession();
  const [token, setToken] = useState("");
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const expectedLength = recoveryMode ? 10 : 6;

  const submit = useCallback(() => {
    if (busy || token.trim().length !== expectedLength) return;
    setBusy(true);
    setError(null);
    void verifyTwoFactor(token)
      .catch((cause) => {
        setError(cause instanceof Error ? cause.message : "The code was not accepted.");
      })
      .finally(() => setBusy(false));
  }, [busy, expectedLength, token, verifyTwoFactor]);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        {recoveryMode
          ? "Enter one of your 10-character Zerops recovery codes."
          : "Enter the 6-digit code from your authenticator app."}
      </p>
      <div className="flex flex-col gap-1.5">
        <FieldLabel>{recoveryMode ? "Recovery code" : "Authentication code"}</FieldLabel>
        <Input
          value={token}
          autoComplete="one-time-code"
          maxLength={expectedLength}
          disabled={busy}
          onChange={(event) => setToken(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit();
          }}
        />
      </div>
      {methods.includes("U2F") && !methods.includes("TOTP") ? (
        <Alert variant="warning">
          <AlertDescription>
            This account requires a security key or passkey. Use a recovery code here — native
            passkey login isn't supported yet.
          </AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="error">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex items-center gap-2">
        <Button
          onClick={submit}
          disabled={busy || token.trim().length !== expectedLength}
          className="flex-1"
        >
          {busy ? "Verifying…" : recoveryMode ? "Use recovery code" : "Verify code"}
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => void cancelTwoFactor()}>
          Cancel
        </Button>
      </div>
      <button
        type="button"
        onClick={() => {
          setRecoveryMode((current) => !current);
          setToken("");
          setError(null);
        }}
        className="text-left text-xs font-medium text-primary hover:underline"
      >
        {recoveryMode ? "Use authenticator code instead" : "Use a recovery code instead"}
      </button>
    </div>
  );
}

function IntegrationTokenSection() {
  const { signInWithToken } = useZeropsSession();
  const [tokenInput, setTokenInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSave = useCallback(() => {
    const trimmed = tokenInput.trim();
    if (!trimmed) {
      setError("Enter an integration token.");
      return;
    }
    try {
      signInWithToken(trimmed);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to save token.");
      return;
    }
    setError(null);
    setTokenInput("");
  }, [signInWithToken, tokenInput]);

  return (
    <Collapsible className="border-t border-border/50 pt-3">
      <CollapsibleTrigger className="text-left text-xs font-medium text-muted-foreground hover:text-foreground">
        Use an integration token instead
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <div className="flex flex-col gap-2 pt-2.5">
          <p className="text-xs text-muted-foreground">
            A long-lived, org-scoped Integration Token — no 2FA, no expiry. Meant for CI-ish use;
            most people should sign in above instead.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              type="password"
              value={tokenInput}
              placeholder="Zerops integration token"
              autoComplete="off"
              onChange={(event) => setTokenInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") handleSave();
              }}
              className="sm:flex-1"
            />
            <Button size="xs" onClick={handleSave} disabled={tokenInput.trim().length === 0}>
              Save
            </Button>
          </div>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
}

/**
 * Real Zerops account sign-in (email/password, then TOTP or a recovery
 * code), matching `apps/mobile/src/features/zerops/SettingsZeropsAccountRouteScreen.tsx`.
 * An Integration Token stays available underneath as an explicit, collapsed
 * alternative for CI-ish use — never the default. Renders only the
 * signed-out / mid-2FA states; a signed-in view belongs to whatever page
 * mounts this (Settings → Zerops, or an onboarding flow).
 */
export function ZeropsSignIn() {
  const { auth, retryRestore } = useZeropsSession();

  if (auth.status === "loading") {
    return (
      <div className="flex items-center gap-1.5 py-6 text-sm text-muted-foreground">
        <Spinner className="size-3.5" />
        Restoring your Zerops session…
      </div>
    );
  }

  if (auth.status === "restorationError") {
    return (
      <div className="flex flex-col gap-3">
        <Alert variant="error">
          <AlertDescription>{auth.message}</AlertDescription>
        </Alert>
        <Button variant="outline" onClick={() => void retryRestore()}>
          Try again
        </Button>
      </div>
    );
  }

  if (auth.status === "twoFactor") {
    return <TwoFactorStep methods={auth.methods} />;
  }

  if (auth.status === "signedIn") return null;

  return (
    <div className="flex flex-col gap-4">
      <CredentialsStep />
      <IntegrationTokenSection />
    </div>
  );
}
