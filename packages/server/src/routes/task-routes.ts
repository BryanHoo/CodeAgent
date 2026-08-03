import { Buffer } from "node:buffer";
import {
  AgentBackgroundTerminalPageSchema,
  ArchiveAgentTaskRequestSchema,
  ArchiveAgentTaskResponseSchema,
  CompactAgentTaskRequestSchema,
  CompactAgentTaskResponseSchema,
  ForkAgentTaskRequestSchema,
  ForkAgentTaskResponseSchema,
  AgentMutationErrorSchema,
  AgentTaskPageSchema,
  AgentTaskSettingsResponseSchema,
  AgentTaskSettingsSchema,
  AgentTaskSnapshotResponseSchema,
  PinAgentTaskRequestSchema,
  PinAgentTaskResponseSchema,
  ReviewAgentTaskRequestSchema,
  ReviewAgentTaskResponseSchema,
  RenameAgentTaskRequestSchema,
  RenameAgentTaskResponseSchema,
  TerminateAgentBackgroundTerminalResponseSchema,
  UploadAgentFeedbackRequestSchema,
  UploadAgentFeedbackResponseSchema,
  UnsubscribeAgentTaskResponseSchema,
  type ArchiveAgentTaskRequest,
  type AgentTaskSettings,
  type CompactAgentTaskRequest,
  type ForkAgentTaskRequest,
  type PinAgentTaskRequest,
  type ReviewAgentTaskRequest,
  type RenameAgentTaskRequest,
  type UploadAgentFeedbackRequest,
} from "@code-agent/protocol";
import type { FastifyPluginCallback } from "fastify";

import { MutationHttpError, type ServerRouteContext } from "./context.js";
import {
  ErrorResponseSchema,
  IdempotencyHeadersSchema,
  ProjectParamsSchema,
  ProjectTaskAttachmentParamsSchema,
  ProjectTaskParamsSchema,
  ProjectTaskTerminalParamsSchema,
  TaskPageQuerySchema,
} from "./schemas.js";

export const registerTaskRoutes: FastifyPluginCallback<ServerRouteContext> = (
  app,
  context,
  done,
) => {
  const {
    assertValidProjectDefaults,
    getProjectContext,
    listModels,
    readEffectiveTaskSettings,
    runIdempotent,
    settingsRepository,
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
      const attachment = await context.provider.readTaskAttachment(
        request.params.taskId,
        request.params.attachmentId,
      );
      if (attachment === undefined) {
        return reply
          .code(404)
          .send({ code: "ATTACHMENT_NOT_FOUND", message: "Attachment not found" });
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

  app.get<{ Params: { projectId: string; taskId: string } }>(
    "/v1/projects/:projectId/tasks/:taskId/settings",
    {
      schema: {
        params: ProjectTaskParamsSchema,
        response: { 200: AgentTaskSettingsResponseSchema, 404: ErrorResponseSchema },
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
      return {
        settings: await readEffectiveTaskSettings(request.params.projectId, request.params.taskId),
      };
    },
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
        response: {
          200: AgentTaskSettingsResponseSchema,
          400: AgentMutationErrorSchema,
          404: AgentMutationErrorSchema,
          409: AgentMutationErrorSchema,
          502: AgentMutationErrorSchema,
        },
      },
    },
    async (request) =>
      runIdempotent(
        ["update-task-settings", request.params.projectId, request.params.taskId],
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
          assertValidProjectDefaults(await listModels(), request.body);
          return {
            settings: await settingsRepository.writeTaskSettings(
              request.params.projectId,
              request.params.taskId,
              request.body,
            ),
          };
        },
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
        response: {
          201: ReviewAgentTaskResponseSchema,
          400: AgentMutationErrorSchema,
          404: AgentMutationErrorSchema,
          409: AgentMutationErrorSchema,
          502: AgentMutationErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const turn = await runIdempotent(
        ["review-task", request.params.projectId, request.params.taskId],
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
          return context.provider.startReview(request.params.taskId, request.body.target);
        },
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
        response: {
          202: CompactAgentTaskResponseSchema,
          400: AgentMutationErrorSchema,
          404: AgentMutationErrorSchema,
          409: AgentMutationErrorSchema,
          502: AgentMutationErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const response = await runIdempotent(
        ["compact-task", request.params.projectId, request.params.taskId],
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
          await context.provider.compactTask(request.params.taskId);
          return { status: "compacting" as const, taskId: request.params.taskId };
        },
      );
      return reply.code(202).send(response);
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
        response: {
          201: ForkAgentTaskResponseSchema,
          400: AgentMutationErrorSchema,
          404: AgentMutationErrorSchema,
          409: AgentMutationErrorSchema,
          502: AgentMutationErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const forkedTask = await runIdempotent(
        ["fork-task", request.params.projectId, request.params.taskId],
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
          return context.provider.forkTask(request.params.taskId);
        },
      );
      return reply.code(201).send({ task: forkedTask });
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
        response: {
          200: UploadAgentFeedbackResponseSchema,
          400: AgentMutationErrorSchema,
          404: AgentMutationErrorSchema,
          409: AgentMutationErrorSchema,
          502: AgentMutationErrorSchema,
        },
      },
    },
    async (request) =>
      runIdempotent(
        ["feedback-task", request.params.projectId, request.params.taskId],
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
          await context.provider.uploadFeedback(request.params.taskId, request.body);
          return { status: "sent" as const, taskId: request.params.taskId };
        },
      ),
  );
  done();
};
