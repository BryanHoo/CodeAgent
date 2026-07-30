import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route.js";

export const projectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/p/$projectId",
}).lazy(() => import("./project-route.lazy.js").then((module) => module.projectLazyRoute));
