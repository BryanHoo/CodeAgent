import { createLazyRoute } from "@tanstack/react-router";

import { WorkbenchShell } from "../../features/workbench/components/workbench-shell.js";

export const projectLazyRoute = createLazyRoute("/p/$projectId")({
  component: ProjectPage,
});

function ProjectPage() {
  const { projectId } = projectLazyRoute.useParams();

  return <WorkbenchShell projectId={projectId} />;
}
