import { randomUUID } from "node:crypto";

import type { AgentProvider } from "@code-agent/core";
import {
  AgentCapabilitiesSchema,
  AgentTaskPageSchema,
  AgentTaskSnapshotResponseSchema,
  HealthResponseSchema,
  ProjectPageSchema,
  type EventStreamMessage,
  type Project,
} from "@code-agent/protocol";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";

import { AgentEventStream } from "./agent-event-stream.js";

export interface CreateCodeAgentServerOptions {
  eventBufferSize?: number;
  eventSessionId?: string;
  project: Project;
  provider: AgentProvider;
  staticRoot?: string;
}

const ProjectParamsSchema = {
  additionalProperties: false,
  properties: { projectId: { minLength: 1, type: "string" } },
  required: ["projectId"],
  type: "object",
} as const;

const TaskParamsSchema = {
  additionalProperties: false,
  properties: { taskId: { minLength: 1, type: "string" } },
  required: ["taskId"],
  type: "object",
} as const;

const TaskPageQuerySchema = {
  additionalProperties: false,
  properties: {
    cursor: { minLength: 1, type: "string" },
    limit: { maximum: 100, minimum: 1, type: "integer" },
  },
  type: "object",
} as const;

const EventQuerySchema = {
  additionalProperties: false,
  properties: { afterSequence: { minimum: 0, type: "integer" } },
  required: ["afterSequence"],
  type: "object",
} as const;

const ErrorResponseSchema = {
  additionalProperties: false,
  properties: {
    code: { minLength: 1, type: "string" },
    message: { minLength: 1, type: "string" },
  },
  required: ["code", "message"],
  type: "object",
} as const;

export async function createCodeAgentServer(
  options: CreateCodeAgentServerOptions,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const capabilities = await options.provider.getCapabilities();
  const eventStream = new AgentEventStream({
    ...(options.eventBufferSize === undefined ? {} : { capacity: options.eventBufferSize }),
    provider: capabilities.provider,
    sessionId: options.eventSessionId ?? randomUUID(),
  });
  const unsubscribeProvider = options.provider.subscribeEvents((event) => {
    eventStream.publish(event);
  });

  await app.register(fastifyWebsocket, { options: { maxPayload: 64 * 1024 } });
  app.addHook("onClose", () => {
    unsubscribeProvider();
  });

  if (options.staticRoot !== undefined) {
    await app.register(fastifyStatic, {
      root: options.staticRoot,
      wildcard: false,
    });
    app.setNotFoundHandler((request, reply) => {
      if (request.method === "GET" && !request.url.startsWith("/v1/")) {
        // Browser 深链统一回到 SPA 入口，API 未命中仍保持 JSON 404。
        return reply.type("text/html; charset=utf-8").sendFile("index.html");
      }
      return reply.code(404).send({ code: "NOT_FOUND", message: "Route not found" });
    });
  }

  app.get("/v1/health", { schema: { response: { 200: HealthResponseSchema } } }, () => ({
    status: "ok" as const,
    version: 1 as const,
  }));

  app.get(
    "/v1/capabilities",
    { schema: { response: { 200: AgentCapabilitiesSchema } } },
    () => capabilities,
  );

  app.get("/v1/projects", { schema: { response: { 200: ProjectPageSchema } } }, () => ({
    data: [options.project],
    nextCursor: null,
  }));

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
    async (request, reply) => {
      if (request.params.projectId !== options.project.id) {
        return reply.code(404).send({ code: "PROJECT_NOT_FOUND", message: "Project not found" });
      }
      const input = {
        ...(request.query.cursor === undefined ? {} : { cursor: request.query.cursor }),
        ...(request.query.limit === undefined ? {} : { limit: request.query.limit }),
      };
      return options.provider.listTasks(input);
    },
  );

  app.get<{ Params: { taskId: string } }>(
    "/v1/tasks/:taskId",
    {
      schema: {
        params: TaskParamsSchema,
        response: { 200: AgentTaskSnapshotResponseSchema, 404: ErrorResponseSchema },
      },
    },
    async (request, reply) => {
      const task = await options.provider.readTask(request.params.taskId);
      if (task?.projectId !== options.project.id) {
        return reply.code(404).send({ code: "TASK_NOT_FOUND", message: "Task not found" });
      }
      // Provider Promise 完成时已交付此前通知，此处 checkpoint 与返回 Snapshot 对齐。
      const checkpoint = eventStream.checkpoint;
      return { checkpoint, snapshot: task };
    },
  );

  app.get<{ Querystring: { afterSequence: number } }>(
    "/v1/events",
    {
      async preValidation(request, reply) {
        const origin = request.headers.origin;
        const host = request.headers.host;
        if (origin === undefined) {
          return;
        }
        try {
          const parsedOrigin = new URL(origin);
          if (
            host === undefined ||
            (parsedOrigin.protocol !== "http:" && parsedOrigin.protocol !== "https:") ||
            parsedOrigin.host !== host
          ) {
            return await reply
              .code(403)
              .send({ code: "ORIGIN_REJECTED", message: "Origin rejected" });
          }
        } catch {
          return await reply
            .code(403)
            .send({ code: "ORIGIN_REJECTED", message: "Origin rejected" });
        }
      },
      schema: { querystring: EventQuerySchema },
      websocket: true,
    },
    (socket, request) => {
      const send = (message: EventStreamMessage): boolean => {
        if (socket.readyState !== 1) {
          return false;
        }
        if (socket.bufferedAmount > 1_048_576) {
          socket.close(1013, "Client is too slow; refresh the snapshot");
          return false;
        }
        socket.send(JSON.stringify(message));
        return true;
      };
      const replay = eventStream.replayAfter(request.query.afterSequence);
      if (replay.type === "resync") {
        const sent = send({
          latestSequence: replay.latestSequence,
          reason: replay.reason,
          sessionId: eventStream.checkpoint.sessionId,
          type: "resync.required",
          version: 1,
        });
        if (sent) {
          socket.close(1000, "Snapshot resync required");
        }
        return;
      }

      // 同步建立实时订阅并挂载清理回调，避免补发与实时事件之间出现空窗。
      const unsubscribe = eventStream.subscribe((event) => {
        send(event);
      });
      const cleanup = () => {
        unsubscribe();
      };
      socket.once("close", cleanup);
      socket.once("error", cleanup);
      send({
        latestSequence: eventStream.checkpoint.sequence,
        sessionId: eventStream.checkpoint.sessionId,
        type: "connection.ready",
        version: 1,
      });
      for (const event of replay.events) {
        if (!send(event)) {
          return;
        }
      }
    },
  );

  await app.ready();
  return app;
}
