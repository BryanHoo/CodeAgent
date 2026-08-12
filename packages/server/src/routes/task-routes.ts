import {
  AgentBackgroundTerminalPageSchema,
  AgentMcpServerPageSchema,
  AgentMutationErrorSchema,
  AgentTaskPageSchema,
  AgentTaskSnapshotResponseSchema,
  ArchiveAgentTaskRequestSchema,
  ArchiveAgentTaskResponseSchema,
  PinAgentTaskRequestSchema,
  PinAgentTaskResponseSchema,
  RenameAgentTaskRequestSchema,
  RenameAgentTaskResponseSchema,
  TerminateAgentBackgroundTerminalResponseSchema,
  UnsubscribeAgentTaskResponseSchema,
  type ArchiveAgentTaskRequest,
  type PinAgentTaskRequest,
  type RenameAgentTaskRequest,
} from "@code-agent/protocol";
import type { FastifyPluginCallback } from "fastify";

import { registerTaskActionRoutes } from "./task-action-routes.js";
import { registerTaskAttachmentRoutes } from "./task-attachment-routes.js";
import {
  callEngine,
  createReadRequestId,
  readRequestId,
  type ServerRouteContext,
} from "./context.js";
import {
  ErrorResponseSchema,
  IdempotencyHeadersSchema,
  ProjectParamsSchema,
  ProjectTaskParamsSchema,
  ProjectTaskTerminalParamsSchema,
  TaskPageQuerySchema,
} from "./schemas.js";

const mutationErrors = {
  400: AgentMutationErrorSchema,
  404: AgentMutationErrorSchema,
  409: AgentMutationErrorSchema,
  502: AgentMutationErrorSchema,
  503: AgentMutationErrorSchema,
} as const;

export const registerTaskRoutes: FastifyPluginCallback<ServerRouteContext> = (
  app,
  context,
  done,
) => {
  const { engine } = context;
  app.get<{
    Params: { projectId: string };
    Querystring: { cursor?: string; limit?: number };
  }>(
    "/v1/projects/:projectId/tasks",
    {
      schema: {
        params: ProjectParamsSchema,
        querystring: TaskPageQuerySchema,
        response: { 200: AgentTaskPageSchema, 404: ErrorResponseSchema },
      },
    },
    (request) =>
      callEngine(() =>
        engine.taskList(createReadRequestId(), request.params.projectId, request.query),
      ),
  );
  app.post<{ Params: { projectId: string; taskId: string } }>(
    "/v1/projects/:projectId/tasks/:taskId/unsubscribe",
    {
      schema: {
        params: ProjectTaskParamsSchema,
        response: { 200: UnsubscribeAgentTaskResponseSchema, 404: ErrorResponseSchema },
      },
    },
    async (request) => ({
      status: await callEngine(() =>
        engine.taskUnsubscribe(
          createReadRequestId(),
          request.params.projectId,
          request.params.taskId,
        ),
      ),
      taskId: request.params.taskId,
    }),
  );
  app.get<{ Params: { projectId: string; taskId: string } }>(
    "/v1/projects/:projectId/tasks/:taskId",
    {
      schema: {
        params: ProjectTaskParamsSchema,
        response: { 200: AgentTaskSnapshotResponseSchema, 404: ErrorResponseSchema },
      },
    },
    async (request, reply) => {
      const result = await callEngine<unknown>(() =>
        engine.taskRead(createReadRequestId(), request.params.projectId, request.params.taskId),
      );
      return result === null
        ? reply.code(404).send({ code: "TASK_NOT_FOUND", message: "Task not found" })
        : result;
    },
  );
  app.get<{ Params: { projectId: string; taskId: string } }>(
    "/v1/projects/:projectId/tasks/:taskId/mcp-servers",
    {
      schema: {
        params: ProjectTaskParamsSchema,
        response: { 200: AgentMcpServerPageSchema, 404: ErrorResponseSchema },
      },
    },
    (request) =>
      callEngine(() =>
        engine.taskMcpServers(
          createReadRequestId(),
          request.params.projectId,
          request.params.taskId,
        ),
      ),
  );
  app.get<{ Params: { projectId: string; taskId: string } }>(
    "/v1/projects/:projectId/tasks/:taskId/background-terminals",
    {
      schema: {
        params: ProjectTaskParamsSchema,
        response: { 200: AgentBackgroundTerminalPageSchema, 404: ErrorResponseSchema },
      },
    },
    (request) =>
      callEngine(() =>
        engine.taskTerminals(
          createReadRequestId(),
          request.params.projectId,
          request.params.taskId,
        ),
      ),
  );
  app.post<{
    Body: Record<string, never>;
    Headers: { "idempotency-key": string };
    Params: { projectId: string; taskId: string; terminalId: string };
  }>(
    "/v1/projects/:projectId/tasks/:taskId/background-terminals/:terminalId/terminate",
    {
      schema: {
        body: { additionalProperties: false, properties: {}, type: "object" },
        headers: IdempotencyHeadersSchema,
        params: ProjectTaskTerminalParamsSchema,
        response: { 200: TerminateAgentBackgroundTerminalResponseSchema, ...mutationErrors },
      },
    },
    async (request) => {
      await callEngine(() =>
        engine.taskTerminalTerminate(
          readRequestId(request.headers),
          request.params.projectId,
          request.params.taskId,
          request.params.terminalId,
        ),
      );
      return { status: "terminated" as const, terminalId: request.params.terminalId };
    },
  );
  app.put<{
    Body: PinAgentTaskRequest;
    Headers: { "idempotency-key": string };
    Params: { projectId: string; taskId: string };
  }>(
    "/v1/projects/:projectId/tasks/:taskId/pin",
    {
      schema: {
        body: PinAgentTaskRequestSchema,
        headers: IdempotencyHeadersSchema,
        params: ProjectTaskParamsSchema,
        response: { 200: PinAgentTaskResponseSchema, ...mutationErrors },
      },
    },
    async (request) => ({
      task: await callEngine(() =>
        engine.taskPin(
          readRequestId(request.headers),
          request.params.projectId,
          request.params.taskId,
          request.body.pinned,
        ),
      ),
    }),
  );
  app.post<{
    Body: RenameAgentTaskRequest;
    Headers: { "idempotency-key": string };
    Params: { projectId: string; taskId: string };
  }>(
    "/v1/projects/:projectId/tasks/:taskId/rename",
    {
      schema: {
        body: RenameAgentTaskRequestSchema,
        headers: IdempotencyHeadersSchema,
        params: ProjectTaskParamsSchema,
        response: { 200: RenameAgentTaskResponseSchema, ...mutationErrors },
      },
    },
    async (request) => ({
      task: await callEngine(() =>
        engine.taskRename(
          readRequestId(request.headers),
          request.params.projectId,
          request.params.taskId,
          request.body.title.trim(),
        ),
      ),
    }),
  );
  app.post<{
    Body: ArchiveAgentTaskRequest;
    Headers: { "idempotency-key": string };
    Params: { projectId: string; taskId: string };
  }>(
    "/v1/projects/:projectId/tasks/:taskId/archive",
    {
      schema: {
        body: ArchiveAgentTaskRequestSchema,
        headers: IdempotencyHeadersSchema,
        params: ProjectTaskParamsSchema,
        response: { 200: ArchiveAgentTaskResponseSchema, ...mutationErrors },
      },
    },
    async (request) => {
      await callEngine(() =>
        engine.taskArchive(
          readRequestId(request.headers),
          request.params.projectId,
          request.params.taskId,
        ),
      );
      return { status: "archived" as const, taskId: request.params.taskId };
    },
  );
  registerTaskActionRoutes(app, context);
  registerTaskAttachmentRoutes(app, context);
  done();
};
