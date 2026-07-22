import { createRoute } from "@tanstack/react-router";

import { WorkbenchShell } from "../../features/workbench/components/workbench-shell.js";
import { rootRoute } from "./root-route.js";

export const taskRoute = createRoute({
  component: TaskPage,
  getParentRoute: () => rootRoute,
  path: "/p/$projectId/t/$taskId",
});

function TaskPage() {
  const { projectId, taskId } = taskRoute.useParams();

  return <WorkbenchShell projectId={projectId} taskId={taskId} />;
}
