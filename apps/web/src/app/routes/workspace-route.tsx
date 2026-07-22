import { createRoute } from "@tanstack/react-router";

import { WorkbenchShell } from "../../features/workbench/components/workbench-shell.js";
import { rootRoute } from "./root-route.js";

export const workspaceRoute = createRoute({
  component: WorkspacePage,
  getParentRoute: () => rootRoute,
  path: "/w/$workspaceId",
});

function WorkspacePage() {
  const { workspaceId } = workspaceRoute.useParams();

  return <WorkbenchShell workspaceId={workspaceId} />;
}
