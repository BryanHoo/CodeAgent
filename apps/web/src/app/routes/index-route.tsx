import { createRoute, redirect } from "@tanstack/react-router";

import { rootRoute } from "./root-route.js";

export const indexRoute = createRoute({
  beforeLoad: () => {
    // Runtime 接入前直接进入默认项目，应用不再经过独立项目索引页。
    redirect({ params: { projectId: "code-agent-window" }, throw: true, to: "/p/$projectId" });
  },
  getParentRoute: () => rootRoute,
  path: "/",
});
