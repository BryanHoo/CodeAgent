import {
  AgentMutationErrorSchema,
  AgentTaskSettingsResponseSchema,
  AgentTaskSettingsSchema,
  CompactAgentTaskRequestSchema,
  CompactAgentTaskResponseSchema,
  ForkAgentTaskRequestSchema,
  ForkAgentTaskResponseSchema,
  ReloadAgentMcpServersRequestSchema,
  ReloadAgentMcpServersResponseSchema,
  ReviewAgentTaskRequestSchema,
  ReviewAgentTaskResponseSchema,
  UploadAgentFeedbackRequestSchema,
  UploadAgentFeedbackResponseSchema,
  type AgentTaskSettings,
  type CompactAgentTaskRequest,
  type ForkAgentTaskRequest,
  type ReloadAgentMcpServersRequest,
  type ReviewAgentTaskRequest,
  type UploadAgentFeedbackRequest,
} from "@code-agent/protocol";
import type { FastifyInstance } from "fastify";

import {
  callEngine,
  createReadRequestId,
  readRequestId,
  type ServerRouteContext,
} from "./context.js";
import {
  ErrorResponseSchema,
  IdempotencyHeadersSchema,
  ProjectTaskParamsSchema,
} from "./schemas.js";

const mutationErrors = {
  400: AgentMutationErrorSchema,
  404: AgentMutationErrorSchema,
  409: AgentMutationErrorSchema,
  502: AgentMutationErrorSchema,
  503: AgentMutationErrorSchema,
} as const;

export function registerTaskActionRoutes(
  app: FastifyInstance,
  { engine }: ServerRouteContext,
): void {
  app.get<{ Params: { projectId: string; taskId: string } }>(
    "/v1/projects/:projectId/tasks/:taskId/settings",
    {
      schema: {
        params: ProjectTaskParamsSchema,
        response: { 200: AgentTaskSettingsResponseSchema, 404: ErrorResponseSchema },
      },
    },
    (request) =>
      callEngine(() =>
        engine.taskSettingsGet(
          createReadRequestId(),
          request.params.projectId,
          request.params.taskId,
        ),
      ),
  );
  app.put<{
    Body: AgentTaskSettings;
    Headers: { "idempotency-key": string };
    Params: { projectId: string; taskId: string };
  }>(
    "/v1/projects/:projectId/tasks/:taskId/settings",
    {
      schema: {
        body: AgentTaskSettingsSchema,
        headers: IdempotencyHeadersSchema,
        params: ProjectTaskParamsSchema,
        response: { 200: AgentTaskSettingsResponseSchema, ...mutationErrors },
      },
    },
    (request) =>
      callEngine(() =>
        engine.taskSettingsUpdate(
          readRequestId(request.headers),
          request.params.projectId,
          request.params.taskId,
          request.body,
        ),
      ),
  );
  app.post<{
    Body: ReloadAgentMcpServersRequest;
    Headers: { "idempotency-key": string };
    Params: { projectId: string; taskId: string };
  }>(
    "/v1/projects/:projectId/tasks/:taskId/mcp-servers/retry",
    {
      schema: {
        body: ReloadAgentMcpServersRequestSchema,
        headers: IdempotencyHeadersSchema,
        params: ProjectTaskParamsSchema,
        response: { 200: ReloadAgentMcpServersResponseSchema, ...mutationErrors },
      },
    },
    (request) =>
      callEngine(() =>
        engine.taskMcpReload(
          readRequestId(request.headers),
          request.params.projectId,
          request.params.taskId,
        ),
      ),
  );
  app.post<{
    Body: ReviewAgentTaskRequest;
    Headers: { "idempotency-key": string };
    Params: { projectId: string; taskId: string };
  }>(
    "/v1/projects/:projectId/tasks/:taskId/review",
    {
      schema: {
        body: ReviewAgentTaskRequestSchema,
        headers: IdempotencyHeadersSchema,
        params: ProjectTaskParamsSchema,
        response: { 201: ReviewAgentTaskResponseSchema, ...mutationErrors },
      },
    },
    async (request, reply) => {
      const turn = await callEngine(() =>
        engine.turnReviewStart(
          readRequestId(request.headers),
          request.params.projectId,
          request.params.taskId,
          request.body.target,
        ),
      );
      return reply.code(201).send({ taskId: request.params.taskId, turn });
    },
  );
  app.post<{
    Body: CompactAgentTaskRequest;
    Headers: { "idempotency-key": string };
    Params: { projectId: string; taskId: string };
  }>(
    "/v1/projects/:projectId/tasks/:taskId/compact",
    {
      schema: {
        body: CompactAgentTaskRequestSchema,
        headers: IdempotencyHeadersSchema,
        params: ProjectTaskParamsSchema,
        response: { 202: CompactAgentTaskResponseSchema, ...mutationErrors },
      },
    },
    async (request, reply) => {
      await callEngine(() =>
        engine.taskCompact(
          readRequestId(request.headers),
          request.params.projectId,
          request.params.taskId,
        ),
      );
      return reply.code(202).send({ status: "compacting", taskId: request.params.taskId });
    },
  );
  app.post<{
    Body: ForkAgentTaskRequest;
    Headers: { "idempotency-key": string };
    Params: { projectId: string; taskId: string };
  }>(
    "/v1/projects/:projectId/tasks/:taskId/fork",
    {
      schema: {
        body: ForkAgentTaskRequestSchema,
        headers: IdempotencyHeadersSchema,
        params: ProjectTaskParamsSchema,
        response: { 201: ForkAgentTaskResponseSchema, ...mutationErrors },
      },
    },
    async (request, reply) => {
      const task = await callEngine(() =>
        engine.taskFork(
          readRequestId(request.headers),
          request.params.projectId,
          request.params.taskId,
        ),
      );
      return reply.code(201).send({ task });
    },
  );
  app.post<{
    Body: UploadAgentFeedbackRequest;
    Headers: { "idempotency-key": string };
    Params: { projectId: string; taskId: string };
  }>(
    "/v1/projects/:projectId/tasks/:taskId/feedback",
    {
      schema: {
        body: UploadAgentFeedbackRequestSchema,
        headers: IdempotencyHeadersSchema,
        params: ProjectTaskParamsSchema,
        response: { 200: UploadAgentFeedbackResponseSchema, ...mutationErrors },
      },
    },
    async (request) => {
      await callEngine(() =>
        engine.taskFeedbackUpload(
          readRequestId(request.headers),
          request.params.projectId,
          request.params.taskId,
          request.body,
        ),
      );
      return { status: "sent" as const, taskId: request.params.taskId };
    },
  );
}
