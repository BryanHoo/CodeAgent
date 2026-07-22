import { createRouter } from "@tanstack/react-router";

import { indexRoute } from "./routes/index-route.js";
import { loginRoute } from "./routes/login-route.js";
import { rootRoute } from "./routes/root-route.js";
import { settingsRoute } from "./routes/settings-route.js";
import { threadRoute } from "./routes/thread-route.js";
import { workspaceRoute } from "./routes/workspace-route.js";
import { workspacesRoute } from "./routes/workspaces-route.js";

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  workspacesRoute,
  workspaceRoute,
  threadRoute,
  settingsRoute,
]);

export const router = createRouter({
  defaultPreload: "intent",
  routeTree,
  scrollRestoration: true,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
