import {
  AgentMutationErrorSchema,
  InterruptAgentTurnRequestSchema,
  InterruptAgentTurnResponseSchema,
  ResolvePendingRequestRequestSchema,
  ResolvePendingRequestResponseSchema,
  StartAgentTaskRequestSchema,
  StartAgentTaskResponseSchema,
  StartAgentTurnRequestSchema,
  StartAgentTurnResponseSchema,
  SteerAgentTurnRequestSchema,
  SteerAgentTurnResponseSchema,
  type ResolvePendingRequestRequest,
  type StartAgentTurnRequest,
  type SteerAgentTurnRequest,
} from "@code-agent/protocol";
import type { FastifyPluginCallback } from "fastify";

import {
  MutationHttpError,
  callEngine,
  readRequestId,
  type ServerRouteContext,
} from "./context.js";
import {
  IdempotencyHeadersSchema,
  ProjectParamsSchema,
  ProjectTaskParamsSchema,
  ProjectTaskPendingRequestParamsSchema,
  ProjectTaskTurnParamsSchema,
} from "./schemas.js";

const mutationErrors = {
  400: AgentMutationErrorSchema,
  404: AgentMutationErrorSchema,
  409: AgentMutationErrorSchema,
  502: AgentMutationErrorSchema,
  503: AgentMutationErrorSchema,
} as const;

export const registerTurnRoutes: FastifyPluginCallback<ServerRouteContext> = (
  app,
  { engine },
  done,
) => {
  app.post<{
    Body: Record<string, never>;
    Headers: { "idempotency-key": string };
    Params: { projectId: string };
  }>(
    "/v1/projects/:projectId/tasks",
    {
      schema: {
        body: StartAgentTaskRequestSchema,
        headers: IdempotencyHeadersSchema,
        params: ProjectParamsSchema,
        response: { 201: StartAgentTaskResponseSchema, ...mutationErrors },
      },
    },
    async (request, reply) => {
      const task = await callEngine(() =>
        engine.taskStart(readRequestId(request.headers), request.params.projectId, request.body),
      );
      return reply.code(201).send({ task });
    },
  );
  app.post<{
    Body: StartAgentTurnRequest;
    Headers: { "idempotency-key": string };
    Params: { projectId: string; taskId: string };
  }>(
    "/v1/projects/:projectId/tasks/:taskId/turns",
    {
      schema: {
        body: StartAgentTurnRequestSchema,
        headers: IdempotencyHeadersSchema,
        params: ProjectTaskParamsSchema,
        response: { 201: StartAgentTurnResponseSchema, ...mutationErrors },
      },
    },
    async (request, reply) => {
      const turn = await callEngine(() =>
        engine.turnStart(
          readRequestId(request.headers),
          request.params.projectId,
          request.params.taskId,
          request.body,
        ),
      );
      return reply.code(201).send({ taskId: request.params.taskId, turn });
    },
  );
  app.post<{
    Body: SteerAgentTurnRequest;
    Headers: { "idempotency-key": string };
    Params: { projectId: string; taskId: string; turnId: string };
  }>(
    "/v1/projects/:projectId/tasks/:taskId/turns/:turnId/steer",
    {
      schema: {
        body: SteerAgentTurnRequestSchema,
        headers: IdempotencyHeadersSchema,
        params: ProjectTaskTurnParamsSchema,
        response: { 202: SteerAgentTurnResponseSchema, ...mutationErrors },
      },
    },
    async (request, reply) => {
      if (request.body.taskId !== request.params.taskId) {
        throw new MutationHttpError("TASK_NOT_FOUND", "Task not found", 404);
      }
      await callEngine(() =>
        engine.turnSteer(
          readRequestId(request.headers),
          request.params.projectId,
          request.params.taskId,
          request.params.turnId,
          request.body,
        ),
      );
      return reply.code(202).send({
        status: "accepted",
        taskId: request.params.taskId,
        turnId: request.params.turnId,
      });
    },
  );
  app.post<{
    Body: { taskId: string };
    Headers: { "idempotency-key": string };
    Params: { projectId: string; taskId: string; turnId: string };
  }>(
    "/v1/projects/:projectId/tasks/:taskId/turns/:turnId/interrupt",
    {
      schema: {
        body: InterruptAgentTurnRequestSchema,
        headers: IdempotencyHeadersSchema,
        params: ProjectTaskTurnParamsSchema,
        response: { 202: InterruptAgentTurnResponseSchema, ...mutationErrors },
      },
    },
    async (request, reply) => {
      if (request.body.taskId !== request.params.taskId) {
        throw new MutationHttpError("TASK_NOT_FOUND", "Task not found", 404);
      }
      await callEngine(() =>
        engine.turnInterrupt(
          readRequestId(request.headers),
          request.params.projectId,
          request.params.taskId,
          request.params.turnId,
        ),
      );
      return reply.code(202).send({
        status: "interrupting",
        taskId: request.params.taskId,
        turnId: request.params.turnId,
      });
    },
  );
  app.post<{
    Body: ResolvePendingRequestRequest;
    Headers: { "idempotency-key": string };
    Params: { projectId: string; requestId: string; taskId: string };
  }>(
    "/v1/projects/:projectId/tasks/:taskId/pending-requests/:requestId/resolve",
    {
      schema: {
        body: ResolvePendingRequestRequestSchema,
        headers: IdempotencyHeadersSchema,
        params: ProjectTaskPendingRequestParamsSchema,
        response: { 200: ResolvePendingRequestResponseSchema, ...mutationErrors },
      },
    },
    (request) => {
      if (
        request.body.projectId !== request.params.projectId ||
        request.body.taskId !== request.params.taskId
      ) {
        throw new MutationHttpError(
          "PENDING_REQUEST_MISMATCH",
          "Pending request identity does not match",
          409,
        );
      }
      return callEngine(() =>
        engine.pendingRequestResolve(readRequestId(request.headers), request.params.projectId, {
          ...request.body,
          requestId: request.params.requestId,
        }),
      );
    },
  );
  done();
};
