import { createRoute } from "@tanstack/react-router";

import { WorkbenchShell } from "../../features/workbench/components/workbench-shell.js";
import { rootRoute } from "./root-route.js";

export const threadRoute = createRoute({
  component: ThreadPage,
  getParentRoute: () => rootRoute,
  path: "/w/$workspaceId/t/$threadId",
});

function ThreadPage() {
  const { threadId, workspaceId } = threadRoute.useParams();

  return <WorkbenchShell threadId={threadId} workspaceId={workspaceId} />;
}
