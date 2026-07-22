import { createRouter } from "@tanstack/react-router";

import { indexRoute } from "./routes/index-route.js";
import { loginRoute } from "./routes/login-route.js";
import { projectRoute } from "./routes/project-route.js";
import { rootRoute } from "./routes/root-route.js";
import { settingsRoute } from "./routes/settings-route.js";
import { taskRoute } from "./routes/task-route.js";

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  projectRoute,
  taskRoute,
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
