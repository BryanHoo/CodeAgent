import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route.js";

export const taskRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/p/$projectId/t/$taskId",
}).lazy(() => import("./task-route.lazy.js").then((module) => module.taskLazyRoute));
