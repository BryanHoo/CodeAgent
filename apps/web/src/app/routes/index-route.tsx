import { createRoute, redirect } from "@tanstack/react-router";

import { rootRoute } from "./root-route.js";

export const indexRoute = createRoute({
  beforeLoad: () => {
    // Runtime 和认证接入前，根路径稳定落到无副作用的 Workspace 索引。
    redirect({ throw: true, to: "/workspaces" });
  },
  getParentRoute: () => rootRoute,
  path: "/",
});
