import {
  AgentCapabilitiesSchema,
  AgentGlobalSettingsResponseSchema,
  AgentGlobalSettingsSchema,
  AgentModelPageSchema,
  AgentMutationErrorSchema,
  AppInfoResponseSchema,
  EventStreamMetricsResponseSchema,
  HealthResponseSchema,
  InstallAppUpdateRequestSchema,
  InstallAppUpdateResponseSchema,
  type AgentGlobalSettings,
  type InstallAppUpdateRequest,
} from "@code-agent/protocol";
import type { NodeEventStreamMetricsPage } from "@code-agent/engine-node";
import type { FastifyPluginCallback } from "fastify";

import {
  MutationHttpError,
  callEngine,
  createReadRequestId,
  readRequestId,
  type ServerRouteContext,
} from "./context.js";
import { IdempotencyHeadersSchema } from "./schemas.js";

const APP_UPDATE_HANDLER_TIMEOUT_MS = 150_000;

export const registerRuntimeRoutes: FastifyPluginCallback<ServerRouteContext> = (
  app,
  { engine, eventMetrics, installAppUpdate, readAppInfo },
  done,
) => {
  app.get("/v1/health", { schema: { response: { 200: HealthResponseSchema } } }, () => ({
    runtime: { state: "ready" as const },
    status: "ok" as const,
    version: 1 as const,
  }));
  app.get("/v1/app-info", { schema: { response: { 200: AppInfoResponseSchema } } }, readAppInfo);
  app.post<{
    Body: InstallAppUpdateRequest;
    Headers: { "idempotency-key": string };
  }>(
    "/v1/app-update",
    {
      handlerTimeout: APP_UPDATE_HANDLER_TIMEOUT_MS,
      schema: {
        body: InstallAppUpdateRequestSchema,
        headers: IdempotencyHeadersSchema,
        response: {
          200: InstallAppUpdateResponseSchema,
          400: AgentMutationErrorSchema,
          409: AgentMutationErrorSchema,
          502: AgentMutationErrorSchema,
          503: AgentMutationErrorSchema,
        },
      },
    },
    async (request) => {
      try {
        return await installAppUpdate(request.body.version);
      } catch (error) {
        const code =
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          (error.code === "UPDATE_NOT_AVAILABLE" ||
            error.code === "UPDATE_CHECK_FAILED" ||
            error.code === "UPDATE_INSTALL_FAILED")
            ? error.code
            : "UPDATE_INSTALL_FAILED";
        throw new MutationHttpError(
          code,
          error instanceof Error ? error.message : String(error),
          code === "UPDATE_NOT_AVAILABLE" ? 409 : 502,
          code !== "UPDATE_NOT_AVAILABLE",
        );
      }
    },
  );
  app.get(
    "/v1/metrics/events",
    { schema: { response: { 200: EventStreamMetricsResponseSchema } } },
    async () => {
      const runtimeMetrics = await callEngine<NodeEventStreamMetricsPage>(() =>
        engine.eventMetricsGet(createReadRequestId()),
      );
      return {
        projects: runtimeMetrics.projects.map((metrics) => {
          const delivery = eventMetrics.projects.get(metrics.projectId);
          const { slowSubscribers, ...runtime } = metrics;
          return {
            activeClients: delivery?.activeClients ?? 0,
            backpressureSignals: delivery?.backpressureSignals ?? 0,
            ...runtime,
            slowClientDisconnects: slowSubscribers + (delivery?.slowClientDisconnects ?? 0),
          };
        }),
        version: 1 as const,
      };
    },
  );
  app.get("/v1/capabilities", { schema: { response: { 200: AgentCapabilitiesSchema } } }, () =>
    callEngine(() => engine.capabilitiesGet(createReadRequestId())),
  );
  app.get("/v1/models", { schema: { response: { 200: AgentModelPageSchema } } }, () =>
    callEngine(() => engine.modelsList(createReadRequestId())),
  );
  app.get(
    "/v1/settings",
    { schema: { response: { 200: AgentGlobalSettingsResponseSchema } } },
    () => callEngine(() => engine.globalSettingsGet(createReadRequestId())),
  );
  app.put<{ Body: AgentGlobalSettings; Headers: { "idempotency-key": string } }>(
    "/v1/settings",
    {
      schema: {
        body: AgentGlobalSettingsSchema,
        headers: IdempotencyHeadersSchema,
        response: {
          200: AgentGlobalSettingsResponseSchema,
          400: AgentMutationErrorSchema,
          409: AgentMutationErrorSchema,
          502: AgentMutationErrorSchema,
          503: AgentMutationErrorSchema,
        },
      },
    },
    (request) =>
      callEngine(() => engine.globalSettingsUpdate(readRequestId(request.headers), request.body)),
  );
  done();
};
