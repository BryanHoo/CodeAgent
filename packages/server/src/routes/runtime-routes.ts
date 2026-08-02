import {
  AgentCapabilitiesSchema,
  AgentGlobalSettingsResponseSchema,
  AgentGlobalSettingsSchema,
  AgentModelPageSchema,
  AgentMutationErrorSchema,
  EventStreamMetricsResponseSchema,
  HealthResponseSchema,
  type AgentGlobalSettings,
} from "@code-agent/protocol";
import type { FastifyPluginCallback } from "fastify";

import type { ServerRouteContext } from "./context.js";
import { IdempotencyHeadersSchema } from "./schemas.js";

export const registerRuntimeRoutes: FastifyPluginCallback<ServerRouteContext> = (
  app,
  context,
  done,
) => {
  const {
    assertValidProjectDefaults,
    capabilities,
    listModels,
    modelCatalogCache,
    projectContexts,
    readEffectiveGlobalSettings,
    runIdempotent,
    settingsRepository,
  } = context;

  app.get("/v1/health", { schema: { response: { 200: HealthResponseSchema } } }, () => ({
    status: "ok" as const,
    version: 1 as const,
  }));

  app.get(
    "/v1/metrics/events",
    { schema: { response: { 200: EventStreamMetricsResponseSchema } } },
    () => ({
      projects: [...projectContexts.values()].map((context) => ({
        ...context.eventStream.metrics,
        activeClients: context.transportMetrics.activeClients,
        projectId: context.project.id,
        slowClientDisconnects: context.transportMetrics.slowClientDisconnects,
      })),
      version: 1 as const,
    }),
  );

  app.get(
    "/v1/capabilities",
    { schema: { response: { 200: AgentCapabilitiesSchema } } },
    () => capabilities,
  );

  app.get("/v1/models", { schema: { response: { 200: AgentModelPageSchema } } }, () =>
    modelCatalogCache.read(),
  );

  app.get(
    "/v1/settings",
    { schema: { response: { 200: AgentGlobalSettingsResponseSchema } } },
    async () => ({ settings: await readEffectiveGlobalSettings() }),
  );

  app.put<{
    Body: AgentGlobalSettings;
    Headers: { "idempotency-key": string };
  }>(
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
        },
      },
    },
    async (request) =>
      runIdempotent(
        ["update-global-settings"],
        request.headers["idempotency-key"],
        request.body,
        async () => {
          assertValidProjectDefaults(await listModels(), request.body);
          return {
            settings: await settingsRepository.writeGlobalSettings(request.body),
          };
        },
      ),
  );
  done();
};
