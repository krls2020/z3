/**
 * Settings → Zerops: which Zerops account this browser holds, the orgs it can
 * see, and the way out. Signing in happens on the Zerops landing, not here.
 */

import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { useZeropsSession, zeropsErrorMessage } from "~/zerops/ZeropsSessionProvider";

import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

export function ZeropsSettings() {
  const { status, user, organizations, signOut } = useZeropsSession();
  const [error, setError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  return (
    <SettingsPageContainer>
      <SettingsSection title="Zerops" id="zerops">
        <SettingsRow
          {...searchableSetting("zerops-account")}
          description={
            status === "signed-in"
              ? "The Zerops account this browser is signed in with."
              : "No Zerops account is signed in on this browser."
          }
          status={user?.email ?? null}
          control={
            status === "signed-in" ? (
              <Button
                size="sm"
                variant="outline"
                disabled={signingOut}
                onClick={() => {
                  setSigningOut(true);
                  setError(null);
                  void signOut()
                    .catch((cause: unknown) => {
                      setError(zeropsErrorMessage(cause));
                    })
                    .finally(() => {
                      setSigningOut(false);
                    });
                }}
              >
                Sign out
              </Button>
            ) : (
              <Button size="sm" variant="outline" render={<Link to="/zerops" />}>
                Open Zerops
              </Button>
            )
          }
        />
        {error ? <p className="px-3 text-sm text-destructive-foreground sm:px-4">{error}</p> : null}
        {organizations.length > 0 ? (
          <SettingsRow
            {...searchableSetting("zerops-organizations")}
            description="Projects from every one of these are offered in the picker."
            control={
              <div className="flex flex-wrap justify-end gap-1">
                {organizations.map((organization) => (
                  <Badge key={organization.id} size="sm" variant="outline">
                    {organization.name}
                  </Badge>
                ))}
              </div>
            }
          />
        ) : null}
      </SettingsSection>
    </SettingsPageContainer>
  );
}
