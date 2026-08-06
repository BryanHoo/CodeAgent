import { Buffer } from "node:buffer";
import {
  AgentBackgroundTerminalPageSchema,
  AgentMcpServerPageSchema,
  ArchiveAgentTaskRequestSchema,
  ArchiveAgentTaskResponseSchema,
  AgentMutationErrorSchema,
  AgentTaskPageSchema,
  AgentTaskSnapshotResponseSchema,
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
import { AttachmentNotFoundError } from "../attachment-store.js";
import { MutationHttpError, toMcpProviderHttpError, type ServerRouteContext } from "./context.js";
import {
  ErrorResponseSchema,
  IdempotencyHeadersSchema,
  ProjectParamsSchema,
  ProjectTaskAttachmentParamsSchema,
  ProjectTaskParamsSchema,
  ProjectTaskTerminalParamsSchema,
  TaskPageQuerySchema,
} from "./schemas.js";

import { registerTaskActionRoutes } from "./task-action-routes.js";

export const registerTaskRoutes: FastifyPluginCallback<ServerRouteContext> = (
  app,
  context,
  done,
) => {
  const {
    attachmentStore,
    getProjectContext,
    readEffectiveTaskSettings,
    runIdempotent,
    taskFromSnapshot,
  } = context;

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
      const context = await getProjectContext(request.params.projectId);
      if (context === undefined) {
        return reply.code(404).send({ code: "PROJECT_NOT_FOUND", message: "Project not found" });
      }
      const input = {
        ...(request.query.cursor === undefined ? {} : { cursor: request.query.cursor }),
        ...(request.query.limit === undefined ? {} : { limit: request.query.limit }),
      };
      return context.provider.listTasks(input);
    },
  );

  app.post<{ Params: { projectId: string; taskId: string } }>(
    "/v1/projects/:projectId/tasks/:taskId/unsubscribe",
    {
      schema: {
        params: ProjectTaskParamsSchema,
        response: { 200: UnsubscribeAgentTaskResponseSchema, 404: ErrorResponseSchema },
      },
    },
    async (request, reply) => {
      const context = await getProjectContext(request.params.projectId);
      if (context === undefined) {
        return reply.code(404).send({ code: "PROJECT_NOT_FOUND", message: "Project not found" });
      }
      // Provider 内部再次确认运行 Turn、Pending Request、后台终端和恢复 Promise。
      const status = await context.provider.unsubscribeTask(request.params.taskId);
      return { status, taskId: request.params.taskId };
    },
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
      const context = await getProjectContext(request.params.projectId);
      if (context === undefined) {
        return reply.code(404).send({ code: "PROJECT_NOT_FOUND", message: "Project not found" });
      }
      const task = await context.provider.readTask(request.params.taskId);
      if (task?.projectId !== context.project.id) {
        return reply.code(404).send({ code: "TASK_NOT_FOUND", message: "Task not found" });
      }
      // Provider Promise 完成时已交付此前通知，此处 checkpoint 与返回 Snapshot 对齐。
      const checkpoint = context.eventStream.checkpoint;
      const settings = await readEffectiveTaskSettings(
        request.params.projectId,
        request.params.taskId,
      );
      return { checkpoint, snapshot: { ...task, settings } };
    },
  );

  app.get<{ Params: { projectId: string; taskId: string } }>(
    "/v1/projects/:projectId/tasks/:taskId/mcp-servers",
    {
      schema: {
        params: ProjectTaskParamsSchema,
        response: {
          200: AgentMcpServerPageSchema,
          404: ErrorResponseSchema,
          502: AgentMutationErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const projectContext = await getProjectContext(request.params.projectId);
      if (projectContext === undefined) {
        return reply.code(404).send({ code: "PROJECT_NOT_FOUND", message: "Project not found" });
      }
      try {
        return await projectContext.provider.listMcpServers(request.params.taskId);
      } catch (error) {
        throw toMcpProviderHttpError(error);
      }
    },
  );

  app.get<{ Params: { attachmentId: string; projectId: string; taskId: string } }>(
    "/v1/projects/:projectId/tasks/:taskId/attachments/:attachmentId",
    {
      schema: {
        params: ProjectTaskAttachmentParamsSchema,
        response: { 404: ErrorResponseSchema },
      },
    },
    async (request, reply) => {
      const context = await getProjectContext(request.params.projectId);
      if (context === undefined) {
        return reply.code(404).send({ code: "PROJECT_NOT_FOUND", message: "Project not found" });
      }
      let attachment = await context.provider.readTaskAttachment(
        request.params.taskId,
        request.params.attachmentId,
      );
      if (attachment === undefined) {
        const task = await context.provider.readTask(request.params.taskId);
        if (task?.projectId !== context.project.id) {
          return reply.code(404).send({ code: "TASK_NOT_FOUND", message: "Task not found" });
        }
        try {
          // Provider 历史尚未同步时，继续交付本次 Turn 保留的上传内容。
          const stored = await attachmentStore.readSubmitted(
            request.params.projectId,
            request.params.attachmentId,
          );
          attachment = { ...stored.attachment, content: stored.content };
        } catch (error) {
          if (error instanceof AttachmentNotFoundError) {
            return reply
              .code(404)
              .send({ code: "ATTACHMENT_NOT_FOUND", message: "Attachment not found" });
          }
          throw error;
        }
      }
      // 随机 ID 已绑定 Project/Task；响应只交付已复验的附件正文，不暴露本地路径。
      return reply
        .header("cache-control", "private, max-age=300")
        .header("x-content-type-options", "nosniff")
        .type(attachment.mediaType)
        .send(Buffer.from(attachment.content));
    },
  );

  app.get<{ Params: { projectId: string; taskId: string } }>(
    "/v1/projects/:projectId/tasks/:taskId/background-terminals",
    {
      schema: {
        params: ProjectTaskParamsSchema,
        response: { 200: AgentBackgroundTerminalPageSchema, 404: ErrorResponseSchema },
      },
    },
    async (request, reply) => {
      const context = await getProjectContext(request.params.projectId);
      if (context === undefined) {
        return reply.code(404).send({ code: "PROJECT_NOT_FOUND", message: "Project not found" });
      }
      const task = await context.provider.readTask(request.params.taskId);
      if (task?.projectId !== context.project.id) {
        return reply.code(404).send({ code: "TASK_NOT_FOUND", message: "Task not found" });
      }
      return context.provider.listBackgroundTerminals(request.params.taskId);
    },
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
        response: {
          200: TerminateAgentBackgroundTerminalResponseSchema,
          400: AgentMutationErrorSchema,
          404: AgentMutationErrorSchema,
          409: AgentMutationErrorSchema,
          502: AgentMutationErrorSchema,
        },
      },
    },
    async (request) =>
      runIdempotent(
        [
          "terminate-background-terminal",
          request.params.projectId,
          request.params.taskId,
          request.params.terminalId,
        ],
        request.headers["idempotency-key"],
        request.body,
        async () => {
          const context = await getProjectContext(request.params.projectId);
          if (context === undefined) {
            throw new MutationHttpError("PROJECT_NOT_FOUND", "Project not found", 404);
          }
          const task = await context.provider.readTask(request.params.taskId);
          if (task?.projectId !== context.project.id) {
            throw new MutationHttpError("TASK_NOT_FOUND", "Task not found", 404);
          }
          // 终端可能在请求到达前自然退出；终止操作保持幂等成功语义。
          await context.provider.terminateBackgroundTerminal(
            request.params.taskId,
            request.params.terminalId,
          );
          return { status: "terminated" as const, terminalId: request.params.terminalId };
        },
      ),
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
        response: {
          200: PinAgentTaskResponseSchema,
          400: AgentMutationErrorSchema,
          404: AgentMutationErrorSchema,
          409: AgentMutationErrorSchema,
          502: AgentMutationErrorSchema,
        },
      },
    },
    async (request) =>
      runIdempotent(
        ["pin-task", request.params.projectId, request.params.taskId],
        request.headers["idempotency-key"],
        request.body,
        async () => {
          const context = await getProjectContext(request.params.projectId);
          if (context === undefined) {
            throw new MutationHttpError("PROJECT_NOT_FOUND", "Project not found", 404);
          }
          const task = await context.provider.readTask(request.params.taskId);
          if (task?.projectId !== context.project.id) {
            throw new MutationHttpError("TASK_NOT_FOUND", "Task not found", 404);
          }
          return {
            task: await context.provider.pinTask(request.params.taskId, request.body.pinned),
          };
        },
      ),
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
        response: {
          200: RenameAgentTaskResponseSchema,
          400: AgentMutationErrorSchema,
          404: AgentMutationErrorSchema,
          409: AgentMutationErrorSchema,
          502: AgentMutationErrorSchema,
        },
      },
    },
    async (request) =>
      runIdempotent(
        ["rename-task", request.params.projectId, request.params.taskId],
        request.headers["idempotency-key"],
        request.body,
        async () => {
          const context = await getProjectContext(request.params.projectId);
          if (context === undefined) {
            throw new MutationHttpError("PROJECT_NOT_FOUND", "Project not found", 404);
          }
          const task = await context.provider.readTask(request.params.taskId);
          if (task?.projectId !== context.project.id) {
            throw new MutationHttpError("TASK_NOT_FOUND", "Task not found", 404);
          }
          const title = request.body.title.trim();
          // Web 只提交统一标题，Codex 原生命名字段由 Provider 边界负责映射。
          await context.provider.renameTask(request.params.taskId, title);
          return { task: taskFromSnapshot(task, { title }) };
        },
      ),
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
        response: {
          200: ArchiveAgentTaskResponseSchema,
          400: AgentMutationErrorSchema,
          404: AgentMutationErrorSchema,
          409: AgentMutationErrorSchema,
          502: AgentMutationErrorSchema,
        },
      },
    },
    async (request) =>
      runIdempotent(
        ["archive-task", request.params.projectId, request.params.taskId],
        request.headers["idempotency-key"],
        request.body,
        async () => {
          const context = await getProjectContext(request.params.projectId);
          if (context === undefined) {
            throw new MutationHttpError("PROJECT_NOT_FOUND", "Project not found", 404);
          }
          const task = await context.provider.readTask(request.params.taskId);
          if (task?.projectId !== context.project.id) {
            throw new MutationHttpError("TASK_NOT_FOUND", "Task not found", 404);
          }
          await context.provider.archiveTask(request.params.taskId);
          return { status: "archived" as const, taskId: request.params.taskId };
        },
      ),
  );

  registerTaskActionRoutes(app, context);
  done();
};
