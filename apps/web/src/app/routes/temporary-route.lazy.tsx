import { TEMPORARY_TASK_SCOPE_ID } from "@code-agent/protocol";
import { createLazyRoute } from "@tanstack/react-router";

import { WorkbenchShell } from "../../features/workbench/components/workbench-shell.js";

export const temporaryLazyRoute = createLazyRoute("/temporary")({
  component: TemporaryPage,
});

function TemporaryPage() {
  return <WorkbenchShell projectId={TEMPORARY_TASK_SCOPE_ID} temporary />;
}
