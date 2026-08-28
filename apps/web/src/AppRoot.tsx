import { RouterProvider } from "@tanstack/react-router";

import { ElectronBrowserHost } from "./browser/ElectronBrowserHost";
import { PreviewAutomationHosts } from "./components/preview/PreviewAutomationHosts";
import { QuitHoldOverlay } from "./components/QuitHoldOverlay";
import { AppAtomRegistryProvider } from "./rpc/atomRegistry";
import type { AppRouter } from "./router";
import { ZeropsSessionProvider } from "./zerops/ZeropsSessionProvider";

/**
 * Owns renderer-wide providers. The Electron browser host intentionally sits
 * outside the router so its webviews survive route transitions, but it must
 * share the same atom registry as routed UI.
 *
 * The Zerops session wraps the router only: it is independent of T3's
 * environment auth gate and must outlive route transitions, but the preview
 * and Electron hosts have no use for it.
 */
export function AppRoot({ router }: { readonly router: AppRouter }) {
  return (
    <AppAtomRegistryProvider>
      <ZeropsSessionProvider>
        <RouterProvider router={router} />
      </ZeropsSessionProvider>
      <PreviewAutomationHosts />
      <ElectronBrowserHost />
      <QuitHoldOverlay />
    </AppAtomRegistryProvider>
  );
}
