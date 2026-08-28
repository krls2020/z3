import { createRouter, RouterHistory } from "@tanstack/react-router";

import { appBasePathHref } from "./basePath.ts";
import { routeTree } from "./routeTree.gen";

export function getRouter(history: RouterHistory) {
  return createRouter({
    routeTree,
    history,
    // The bundle may be hosted under a path prefix; without it every route
    // under <prefix>/ misses and the app renders its not-found page.
    basepath: appBasePathHref(),
    context: {},
  });
}

export type AppRouter = ReturnType<typeof getRouter>;

declare module "@tanstack/react-router" {
  interface Register {
    router: AppRouter;
  }
}
