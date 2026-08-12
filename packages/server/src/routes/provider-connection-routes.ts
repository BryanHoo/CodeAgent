import {
  AgentMutationErrorSchema,
  AgentProviderConnectionMutationResponseSchema,
  AgentProviderConnectionStatusSchema,
  CancelProviderLoginRequestSchema,
  ConfigureCustomProviderRequestSchema,
  ConfigureCustomProviderResponseSchema,
  StartOfficialProviderLoginRequestSchema,
  StartOfficialProviderLoginResponseSchema,
  type CancelProviderLoginRequest,
  type ConfigureCustomProviderRequest,
  type StartOfficialProviderLoginRequest,
} from "@code-agent/protocol";
import type { FastifyPluginCallback } from "fastify";

import {
  callEngine,
  createReadRequestId,
  readRequestId,
  type ServerRouteContext,
} from "./context.js";
import { IdempotencyHeadersSchema } from "./schemas.js";

const mutationResponses = {
  400: AgentMutationErrorSchema,
  409: AgentMutationErrorSchema,
  502: AgentMutationErrorSchema,
  503: AgentMutationErrorSchema,
} as const;

export const registerProviderConnectionRoutes: FastifyPluginCallback<ServerRouteContext> = (
  app,
  { engine },
  done,
) => {
  app.get(
    "/v1/provider-connection",
    { schema: { response: { 200: AgentProviderConnectionStatusSchema } } },
    () => callEngine(() => engine.providerConnectionGet(createReadRequestId())),
  );
  app.post<{
    Body: StartOfficialProviderLoginRequest;
    Headers: { "idempotency-key": string };
  }>(
    "/v1/provider-connection/official-login",
    {
      schema: {
        body: StartOfficialProviderLoginRequestSchema,
        headers: IdempotencyHeadersSchema,
        response: { 200: StartOfficialProviderLoginResponseSchema, ...mutationResponses },
      },
    },
    (request) => callEngine(() => engine.providerLoginStart(readRequestId(request.headers))),
  );
  app.post<{ Body: CancelProviderLoginRequest; Headers: { "idempotency-key": string } }>(
    "/v1/provider-connection/official-login/cancel",
    {
      schema: {
        body: CancelProviderLoginRequestSchema,
        headers: IdempotencyHeadersSchema,
        response: { 200: AgentProviderConnectionMutationResponseSchema, ...mutationResponses },
      },
    },
    (request) =>
      callEngine(() =>
        engine.providerLoginCancel(readRequestId(request.headers), request.body.loginId),
      ),
  );
  app.put<{ Body: ConfigureCustomProviderRequest; Headers: { "idempotency-key": string } }>(
    "/v1/provider-connection/custom",
    {
      schema: {
        body: ConfigureCustomProviderRequestSchema,
        headers: IdempotencyHeadersSchema,
        response: { 200: ConfigureCustomProviderResponseSchema, ...mutationResponses },
      },
    },
    (request) =>
      callEngine(() =>
        engine.providerCustomConfigure(readRequestId(request.headers), request.body),
      ),
  );
  app.post<{ Body: Record<string, never>; Headers: { "idempotency-key": string } }>(
    "/v1/provider-connection/logout",
    {
      schema: {
        body: StartOfficialProviderLoginRequestSchema,
        headers: IdempotencyHeadersSchema,
        response: { 200: AgentProviderConnectionMutationResponseSchema, ...mutationResponses },
      },
    },
    (request) => callEngine(() => engine.providerLogout(readRequestId(request.headers))),
  );
  done();
};
