import { Link } from "@tanstack/react-router";
import { PlusIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { hasCloudPublicConfig } from "~/cloud/publicConfig";

/**
 * The pre-Zerops "connect a backend manually" path that used to be the only
 * option in `HostedStaticOnboardingState`. Demoted to a secondary link under
 * Zerops sign-in, never removed — someone with no Zerops account still needs
 * a way to reach it. Copy matches what `routes/_chat.index.tsx` showed
 * before this component existed.
 */
export function ManualConnectFallback() {
  const cloudEnabled = hasCloudPublicConfig();

  return (
    <div className="border-t border-border/50 pt-4 text-center">
      <p className="text-xs text-muted-foreground">
        {cloudEnabled
          ? "Or sign in to T3 Connect to connect a linked environment through its managed tunnel, or add a reachable backend manually."
          : "Or add a reachable backend manually to start working from this browser."}
      </p>
      <Button
        render={<Link to="/settings/connections" />}
        size="xs"
        variant="outline"
        className="mt-3"
      >
        <PlusIcon className="size-3.5" />
        {cloudEnabled ? "Open Connections" : "Add environment"}
      </Button>
    </div>
  );
}
