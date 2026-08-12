import Fastify, { type FastifyInstance } from "fastify";

import { registerAccessRoutes } from "./routes/access-routes.js";
import { registerEventRoutes } from "./routes/event-routes.js";
import { registerProjectRoutes } from "./routes/project-routes.js";
import { registerProviderConnectionRoutes } from "./routes/provider-connection-routes.js";
import { registerRuntimeRoutes } from "./routes/runtime-routes.js";
import { registerTaskRoutes } from "./routes/task-routes.js";
import { registerTurnRoutes } from "./routes/turn-routes.js";
import { CodeAgentLogController } from "./log-controller.js";
import { configureServerDelivery } from "./server-delivery.js";
import type { CreateCodeAgentServerOptions } from "./server-options.js";
import { rewriteTemporaryTaskUrl } from "./temporary-task-routing.js";

export type { CreateCodeAgentServerOptions } from "./server-options.js";

const DEFAULT_HANDLER_TIMEOUT_MS = 60_000;

export async function createCodeAgentServer(
  options: CreateCodeAgentServerOptions,
): Promise<FastifyInstance> {
  const handlerTimeoutMs = options.handlerTimeoutMs ?? DEFAULT_HANDLER_TIMEOUT_MS;
  const logger =
    options.loggerEnabled === false
      ? false
      : {
          level: "warn",
          redact: {
            censor: "[Redacted]",
            paths: [
              "req.headers.authorization",
              "req.headers.cookie",
              'req.headers["x-api-key"]',
              'res.headers["set-cookie"]',
            ],
          },
          ...(options.logDestination === undefined ? {} : { stream: options.logDestination }),
        };
  const app = Fastify({
    handlerTimeout: 0,
    logController: new CodeAgentLogController(),
    logger,
    rewriteUrl: (request) => rewriteTemporaryTaskUrl(request.url ?? "/"),
  });
  app.addHook("onRoute", (routeOptions) => {
    if (handlerTimeoutMs > 0 && routeOptions.websocket !== true) {
      routeOptions.handlerTimeout ??= handlerTimeoutMs;
    }
  });

  const accessService = await configureServerDelivery(app, {
    ...(options.access === undefined ? {} : { access: options.access }),
    ...(options.allowedHosts === undefined ? {} : { allowedHosts: options.allowedHosts }),
    // Fastify 已经停止接收请求并关闭 WebSocket 后，最后关闭共享 Engine。
    releaseResources: () => options.engine.close(),
    ...(options.staticRoot === undefined ? {} : { staticRoot: options.staticRoot }),
  });
  const routeContext = {
    ...(accessService === undefined ? {} : { accessService }),
    engine: options.engine,
    eventMetrics: { projects: new Map() },
    installAppUpdate: options.installAppUpdate,
    readAppInfo: options.readAppInfo,
  };

  await app.register(registerAccessRoutes, {
    ...(options.access === undefined ? {} : { access: options.access }),
    ...(accessService === undefined ? {} : { service: accessService }),
  });
  await app.register(registerRuntimeRoutes, routeContext);
  await app.register(registerProviderConnectionRoutes, routeContext);
  await app.register(registerProjectRoutes, routeContext);
  await app.register(registerTaskRoutes, routeContext);
  await app.register(registerTurnRoutes, routeContext);
  await app.register(registerEventRoutes, routeContext);
  await app.ready();
  return app;
}
