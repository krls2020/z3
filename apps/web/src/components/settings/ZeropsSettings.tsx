import { CloudIcon } from "lucide-react";

import { ZeropsProjectPicker } from "../zerops/ZeropsProjectPicker";
import { ZeropsSignIn } from "../zerops/ZeropsSignIn";
import { Alert, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";
import { useZeropsSession } from "~/zerops/session";

import { SettingsPageContainer, SettingsSection } from "./settingsLayout";

/**
 * Settings → Zerops. Signed out (or mid-2FA): `ZeropsSignIn` — real account
 * sign-in, with a pasted Integration Token as a collapsed alternative.
 * Signed in: the grouped project picker plus a sign-out control. There is
 * no separate token-gate or manual pairing-code form here anymore — both
 * lived in this file before the real session flow existed; see H-04 in
 * docs/internals/zerops/hacks.md.
 */
export function ZeropsSettings() {
  const { auth, signOut } = useZeropsSession();

  return (
    <SettingsPageContainer>
      <SettingsSection
        title="Zerops"
        icon={<CloudIcon className="size-4.5 text-muted-foreground" />}
        headerAction={
          auth.status === "signedIn" ? (
            <Button size="xs" variant="destructive-outline" onClick={() => void signOut()}>
              {auth.credentialKind === "token" ? "Forget token" : "Sign out"}
            </Button>
          ) : undefined
        }
      >
        <ZeropsSignIn />
        {auth.status === "signedIn" ? (
          <>
            {auth.newRecoveryToken ? (
              <Alert variant="warning" className="mx-1">
                <AlertDescription>
                  New recovery code: <code className="font-mono">{auth.newRecoveryToken}</code>.
                  Save it now — Zerops won't show it again.
                </AlertDescription>
              </Alert>
            ) : null}
            <ZeropsProjectPicker />
          </>
        ) : null}
      </SettingsSection>
    </SettingsPageContainer>
  );
}
