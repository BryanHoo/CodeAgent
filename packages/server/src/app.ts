import type { AgentProvider } from "@code-agent/core";
import {
  AgentCapabilitiesSchema,
  AgentTaskPageSchema,
  AgentTaskSnapshotSchema,
  HealthResponseSchema,
  ProjectPageSchema,
  type Project,
} from "@code-agent/protocol";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";

export interface CreateCodeAgentServerOptions {
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
    async () => options.provider.getCapabilities(),
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
        response: { 200: AgentTaskSnapshotSchema, 404: ErrorResponseSchema },
      },
    },
    async (request, reply) => {
      const task = await options.provider.readTask(request.params.taskId);
      if (task?.projectId !== options.project.id) {
        return reply.code(404).send({ code: "TASK_NOT_FOUND", message: "Task not found" });
      }
      return task;
    },
  );

  await app.ready();
  return app;
}
