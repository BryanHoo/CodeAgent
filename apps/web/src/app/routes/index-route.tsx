import { createRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { useProjects } from "../../features/projects/project-context.js";
import { RuntimeUnavailable } from "../../shared/ui/runtime-unavailable.js";
import { ProjectSidebar } from "../../features/workbench/components/project-sidebar.js";
import { rootRoute } from "./root-route.js";

export const indexRoute = createRoute({
  component: IndexPage,
  getParentRoute: () => rootRoute,
  path: "/",
});

function IndexPage() {
  const { error, isPending, projects, retry } = useProjects();
  const navigate = useNavigate();
  const firstProjectId = projects[0]?.id;

  useEffect(() => {
    if (firstProjectId !== undefined) {
      void navigate({ params: { projectId: firstProjectId }, replace: true, to: "/p/$projectId" });
    }
  }, [firstProjectId, navigate]);

  if (error !== null) {
    return (
      <main className="flex h-full min-h-0">
        <RuntimeUnavailable onRetry={() => void retry()} />
      </main>
    );
  }
  if (isPending || firstProjectId !== undefined) {
    return (
      <main className="grid h-full place-items-center text-sm text-muted-foreground">
        正在加载项目
      </main>
    );
  }
  return (
    <div
      className="workbench-shell h-full min-h-0 overflow-hidden bg-window"
      data-inspector-open="false"
      data-sidebar-open="true"
    >
      <ProjectSidebar
        connectionState="connected"
        isTaskAwaitingApproval={false}
        isTaskRunning={false}
        onClose={() => undefined}
      />
      <main className="grid min-h-0 min-w-0 place-items-center bg-content text-sm text-muted-foreground">
        尚未添加项目
      </main>
    </div>
  );
}
