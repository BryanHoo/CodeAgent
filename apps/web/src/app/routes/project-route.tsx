import { createRoute } from "@tanstack/react-router";

import { WorkbenchShell } from "../../features/workbench/components/workbench-shell.js";
import { rootRoute } from "./root-route.js";

export const projectRoute = createRoute({
  component: ProjectPage,
  getParentRoute: () => rootRoute,
  path: "/p/$projectId",
});

function ProjectPage() {
  const { projectId } = projectRoute.useParams();

  return <WorkbenchShell projectId={projectId} />;
}
