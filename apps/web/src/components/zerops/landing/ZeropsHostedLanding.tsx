import { CloudIcon } from "lucide-react";

import { ZeropsSignIn } from "~/components/zerops/ZeropsSignIn";
import { useZeropsSession } from "~/zerops/session";

import { ManualConnectFallback } from "./ManualConnectFallback";
import { ZeropsLandingShell } from "./ZeropsLandingShell";
import { ZeropsSignedInLanding } from "./ZeropsSignedInLanding";

/**
 * The Zerops-aware first screen for the hosted static web app
 * (`authGateState.status === "hosted-static"` with zero known environments —
 * see `ChatIndexRouteView` in `routes/_chat.index.tsx`). Additive alongside
 * the plain "connect a backend manually" flow: `ManualConnectFallback`
 * keeps that reachable for anyone without a Zerops account.
 */
export function ZeropsHostedLanding() {
  const { auth } = useZeropsSession();

  // Avoid a flash of the sign-in form while the session is still restoring
  // from storage — same reasoning as `IndexDraftLanding`'s `!bootstrapped`.
  if (auth.status === "loading") {
    return null;
  }

  if (auth.status === "signedIn") {
    return <ZeropsSignedInLanding />;
  }

  // `signedOut`, `twoFactor`, and `restorationError` all render through the
  // same card — `ZeropsSignIn` already renders the right sub-view for each.
  return (
    <ZeropsLandingShell
      icon={<CloudIcon className="size-5" />}
      title="Sign in to Zerops"
      description="Connect a Zerops project to start working from this browser."
    >
      <ZeropsSignIn />
      <ManualConnectFallback />
    </ZeropsLandingShell>
  );
}
