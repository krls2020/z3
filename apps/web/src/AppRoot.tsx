import { RouterProvider } from "@tanstack/react-router";

import { ElectronBrowserHost } from "./browser/ElectronBrowserHost";
import { PreviewAutomationHosts } from "./components/preview/PreviewAutomationHosts";
import { QuitHoldOverlay } from "./components/QuitHoldOverlay";
import { AppAtomRegistryProvider } from "./rpc/atomRegistry";
import type { AppRouter } from "./router";
import { ZeropsSessionProvider } from "./zerops/session";

/**
 * Owns renderer-wide providers. The Electron browser host intentionally sits
 * outside the router so its webviews survive route transitions, but it must
 * share the same atom registry as routed UI. The Zerops session provider
 * lives here too, rather than in the router's root route: it's independent
 * of the primary T3 environment's auth gate, and `/zerops`/`/settings/zerops`
 * are reachable through more than one of that gate's branches.
 */
export function AppRoot({ router }: { readonly router: AppRouter }) {
  return (
    <AppAtomRegistryProvider>
      <ZeropsSessionProvider>
        <RouterProvider router={router} />
        <PreviewAutomationHosts />
        <ElectronBrowserHost />
        <QuitHoldOverlay />
      </ZeropsSessionProvider>
    </AppAtomRegistryProvider>
  );
}
