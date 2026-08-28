/**
 * The Zerops entry surface, presentational only: a frame plus the three forms
 * it can hold (sign in, sign up, two-factor). Every decision arrives as a
 * prop, so this file renders without a session, a router or a network.
 *
 * The frame always keeps a way out to upstream's manual connect flow — a
 * non-Zerops user must never be locked out of their own client.
 */

import { ExternalLinkIcon } from "lucide-react";
import type { FormEvent, ReactNode } from "react";

import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Label } from "../../ui/label";
import { SidebarInset } from "../../ui/sidebar";
import { Spinner } from "../../ui/spinner";
import { WorkspacePageHeader } from "../../WorkspacePageHeader";

export function ZeropsLandingShell({
  title,
  description,
  children,
  onManualConnect,
}: {
  readonly title: string;
  readonly description: string;
  readonly children: ReactNode;
  readonly onManualConnect: () => void;
}) {
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <WorkspacePageHeader className="border-b border-border">
          <span className="text-sm font-medium text-foreground">Zerops Code</span>
        </WorkspacePageHeader>

        <div className="flex flex-1 items-center justify-center overflow-y-auto p-6">
          <div className="w-full max-w-md space-y-6">
            <div className="space-y-1 text-center">
              <h1 className="text-xl font-semibold text-foreground">{title}</h1>
              <p className="text-sm text-muted-foreground">{description}</p>
            </div>

            <div className="rounded-3xl border border-border/55 bg-card/20 px-6 py-6 shadow-sm/5">
              {children}
            </div>

            <p className="text-center text-xs text-muted-foreground">
              Not using Zerops?{" "}
              <button
                type="button"
                className="underline underline-offset-2 hover:text-foreground"
                onClick={onManualConnect}
              >
                Connect a backend manually
              </button>
            </p>
          </div>
        </div>
      </div>
    </SidebarInset>
  );
}

function FormError({ message }: { readonly message: string | null }) {
  if (!message) return null;
  return (
    <p className="rounded-lg border border-destructive/40 bg-destructive/8 px-3 py-2 text-sm text-destructive-foreground">
      {message}
    </p>
  );
}

function SubmitButton({
  busy,
  label,
  blocked = false,
}: {
  readonly busy: boolean;
  readonly label: string;
  readonly blocked?: boolean;
}) {
  return (
    <Button type="submit" className="w-full" disabled={busy || blocked}>
      {busy ? <Spinner className="size-4" /> : null}
      {label}
    </Button>
  );
}

/**
 * Where a user can sign up when this origin cannot: the platform's own form,
 * carrying the pool claim the same way our request does.
 */
export const ZEROPS_GUI_REGISTRATION_URL = "https://app.zerops.io/registration?zcp=true";

/**
 * Cloudflare Turnstile only renders on hostnames its site key allows, and the
 * platform refuses a registration without a token — so on any other origin
 * signing up here is impossible until Zerops allows the hostname. Rather than
 * a dead form, the user gets the sign-up that does work and a way back.
 */
export function ZeropsRegistrationUnavailable({
  reason,
  onSignIn,
}: {
  readonly reason: string;
  readonly onSignIn: () => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-foreground">
        Creating an account is not available from this address yet.
      </p>
      <p className="text-xs text-muted-foreground">
        The Zerops sign-up form protects itself with a captcha that only runs on Zerops&apos; own
        pages. Reported reason: {reason}
      </p>
      <Button
        className="w-full"
        render={
          <a href={ZEROPS_GUI_REGISTRATION_URL} target="_blank" rel="noreferrer">
            <ExternalLinkIcon className="size-4" />
            Sign up at app.zerops.io
          </a>
        }
      />
      <p className="text-center text-xs text-muted-foreground">
        Done, or already have an account?{" "}
        <button
          type="button"
          className="underline underline-offset-2 hover:text-foreground"
          onClick={onSignIn}
        >
          Sign in here
        </button>
      </p>
    </div>
  );
}

function readField(form: HTMLFormElement, name: string): string {
  const value = new FormData(form).get(name);
  return typeof value === "string" ? value : "";
}

export function ZeropsSignInForm({
  busy,
  error,
  onSubmit,
  onSwitchToRegister,
}: {
  readonly busy: boolean;
  readonly error: string | null;
  readonly onSubmit: (input: { readonly email: string; readonly password: string }) => void;
  readonly onSwitchToRegister: () => void;
}) {
  return (
    <form
      className="space-y-4"
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        onSubmit({
          email: readField(event.currentTarget, "email"),
          password: readField(event.currentTarget, "password"),
        });
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="zerops-email">Email</Label>
        <Input id="zerops-email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="zerops-password">Password</Label>
        <Input
          id="zerops-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      <FormError message={error} />
      <SubmitButton busy={busy} label="Sign in" />
      <p className="text-center text-xs text-muted-foreground">
        No Zerops account?{" "}
        <button
          type="button"
          className="underline underline-offset-2 hover:text-foreground"
          onClick={onSwitchToRegister}
        >
          Create one
        </button>
      </p>
    </form>
  );
}

export function ZeropsRegisterForm({
  busy,
  error,
  captcha,
  captchaPending,
  onSubmit,
  onSwitchToSignIn,
}: {
  readonly busy: boolean;
  readonly error: string | null;
  /** The Turnstile widget. The platform enforces it, so it is always rendered. */
  readonly captcha: ReactNode | null;
  /** True until the captcha hands over a token; submitting before then is refused. */
  readonly captchaPending: boolean;
  readonly onSubmit: (input: {
    readonly email: string;
    readonly password: string;
    readonly fullName: string;
    readonly organizationName: string;
  }) => void;
  readonly onSwitchToSignIn: () => void;
}) {
  return (
    <form
      className="space-y-4"
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        onSubmit({
          email: readField(event.currentTarget, "email"),
          password: readField(event.currentTarget, "password"),
          fullName: readField(event.currentTarget, "fullName"),
          organizationName: readField(event.currentTarget, "organizationName"),
        });
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="zerops-signup-name">Your name</Label>
        <Input id="zerops-signup-name" name="fullName" autoComplete="name" required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="zerops-signup-org">Organization</Label>
        <Input
          id="zerops-signup-org"
          name="organizationName"
          autoComplete="organization"
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="zerops-signup-email">Email</Label>
        <Input id="zerops-signup-email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="zerops-signup-password">Password</Label>
        <Input
          id="zerops-signup-password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
      </div>
      {captcha}
      <FormError message={error} />
      <SubmitButton busy={busy} blocked={captchaPending} label="Create account" />
      <p className="text-center text-xs text-muted-foreground">
        Already have one?{" "}
        <button
          type="button"
          className="underline underline-offset-2 hover:text-foreground"
          onClick={onSwitchToSignIn}
        >
          Sign in
        </button>
      </p>
    </form>
  );
}

export function ZeropsTotpForm({
  busy,
  error,
  onSubmit,
}: {
  readonly busy: boolean;
  readonly error: string | null;
  readonly onSubmit: (code: string) => void;
}) {
  return (
    <form
      className="space-y-4"
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        onSubmit(readField(event.currentTarget, "code"));
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="zerops-totp">Two-factor code</Label>
        <Input
          id="zerops-totp"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          required
        />
      </div>
      <FormError message={error} />
      <SubmitButton busy={busy} label="Verify" />
    </form>
  );
}
