import { createFileRoute } from "@tanstack/react-router";

import { ZeropsProjectsPage } from "../components/zerops/ZeropsProjectsPage";

export const Route = createFileRoute("/zerops")({
  component: ZeropsProjectsPage,
});
