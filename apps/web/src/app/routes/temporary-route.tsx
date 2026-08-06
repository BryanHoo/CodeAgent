import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route.js";

export const temporaryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/temporary",
}).lazy(() => import("./temporary-route.lazy.js").then((module) => module.temporaryLazyRoute));
