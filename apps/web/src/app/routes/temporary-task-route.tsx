import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route.js";

export const temporaryTaskRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/temporary/t/$taskId",
}).lazy(() =>
  import("./temporary-task-route.lazy.js").then((module) => module.temporaryTaskLazyRoute),
);
