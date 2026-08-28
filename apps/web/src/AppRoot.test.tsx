import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { RouterProvider } from "@tanstack/react-router";
import { describe, expect, it } from "vite-plus/test";

import { ElectronBrowserHost } from "./browser/ElectronBrowserHost";
import { PreviewAutomationHosts } from "./components/preview/PreviewAutomationHosts";
import { QuitHoldOverlay } from "./components/QuitHoldOverlay";
import { AppAtomRegistryProvider } from "./rpc/atomRegistry";
import type { AppRouter } from "./router";
import { ZeropsSessionProvider } from "./zerops/ZeropsSessionProvider";
import { AppRoot } from "./AppRoot";

function childrenOf(node: unknown): ReadonlyArray<ReactNode> {
  return isValidElement(node)
    ? Children.toArray((node as ReactElement<{ readonly children: ReactNode }>).props.children)
    : [];
}

describe("AppRoot", () => {
  it("shares the application atom registry with routed UI and renderer-wide desktop hosts", () => {
    const root = AppRoot({ router: {} as AppRouter });

    expect(root.type).toBe(AppAtomRegistryProvider);
    const children = childrenOf(root);
    expect(children).toHaveLength(4);
    expect(isValidElement(children[0]) && children[0].type).toBe(ZeropsSessionProvider);
    expect(isValidElement(children[1]) && children[1].type).toBe(PreviewAutomationHosts);
    expect(isValidElement(children[2]) && children[2].type).toBe(ElectronBrowserHost);
    expect(isValidElement(children[3]) && children[3].type).toBe(QuitHoldOverlay);
  });

  it("keeps the Zerops session around the router and out of the desktop hosts", () => {
    // Zerops identity is independent of the environment auth gate, so it must
    // outlive route transitions — but the preview and Electron hosts have no
    // use for it and must not end up inside it.
    const routed = childrenOf(childrenOf(AppRoot({ router: {} as AppRouter }))[0]);

    expect(routed).toHaveLength(1);
    expect(isValidElement(routed[0]) && routed[0].type).toBe(RouterProvider);
  });
});
