import { TEMPORARY_TASK_SCOPE_ID } from "@code-agent/protocol";
import { createLazyRoute } from "@tanstack/react-router";

import { WorkbenchShell } from "../../features/workbench/components/workbench-shell.js";

export const temporaryTaskLazyRoute = createLazyRoute("/temporary/t/$taskId")({
  component: TemporaryTaskPage,
});

function TemporaryTaskPage() {
  const { taskId } = temporaryTaskLazyRoute.useParams();
  return <WorkbenchShell projectId={TEMPORARY_TASK_SCOPE_ID} taskId={taskId} temporary />;
}
