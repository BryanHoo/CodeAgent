import { createLazyRoute } from "@tanstack/react-router";

import { WorkbenchShell } from "../../features/workbench/components/workbench-shell.js";

export const taskLazyRoute = createLazyRoute("/p/$projectId/t/$taskId")({
  component: TaskPage,
});

function TaskPage() {
  const { projectId, taskId } = taskLazyRoute.useParams();

  return <WorkbenchShell projectId={projectId} taskId={taskId} />;
}
