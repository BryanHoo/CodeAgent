import { randomUUID } from "node:crypto";

import { PendingRequestResolutionError, type AgentProvider } from "@code-agent/core";
import {
  AgentCapabilitiesSchema,
  AgentAttachmentUploadRequestSchema,
  AgentAttachmentUploadResponseSchema,
  AgentModelPageSchema,
  AgentMutationErrorSchema,
  AgentTaskPageSchema,
  AgentTaskSnapshotResponseSchema,
  HealthResponseSchema,
  InterruptAgentTurnRequestSchema,
  InterruptAgentTurnResponseSchema,
  ProjectPageSchema,
  ProjectGitStatusSchema,
  ProjectSourceFileSchema,
  RollbackAgentTurnRequestSchema,
  RollbackAgentTurnResponseSchema,
  ResolvePendingRequestRequestSchema,
  ResolvePendingRequestResponseSchema,
  StartAgentTaskRequestSchema,
  StartAgentTaskResponseSchema,
  StartAgentTurnRequestSchema,
  StartAgentTurnResponseSchema,
  MAX_AGENT_ATTACHMENT_DATA_URL_LENGTH,
  type AgentAttachmentUploadRequest,
  type AgentMutationError,
  type EventStreamMessage,
  type Project,
  type ProjectGitStatus,
  type ProjectSourceFile,
  type RollbackAgentTurnRequest,
  type ResolvePendingRequestRequest,
  type StartAgentTurnRequest,
} from "@code-agent/protocol";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";

import { AgentEventStream } from "./agent-event-stream.js";
import { AttachmentNotFoundError, AttachmentStore } from "./attachment-store.js";
import { readGitWorkingTreeStatus } from "./git-working-tree.js";
import { readProjectSourceFile } from "./project-source-file.js";
import {
  prepareTurnFileRollback,
  TurnFileRollbackError,
  type PreparedTurnFileRollback,
} from "./turn-file-rollback.js";

export interface CreateCodeAgentServerOptions {
  eventBufferSize?: number;
  eventSessionId?: string;
  idempotencyCacheSize?: number;
  idempotencyTtlMs?: number;
  project: Project;
  provider: AgentProvider;
  readProjectGitStatus?: (projectRoot: string) => Promise<ProjectGitStatus>;
  readProjectSourceFile?: (projectRoot: string, path: string) => Promise<ProjectSourceFile>;
  prepareTurnFileRollback?: (
    projectRoot: string,
    changes: Parameters<typeof prepareTurnFileRollback>[1],
  ) => Promise<PreparedTurnFileRollback>;
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

const TurnParamsSchema = {
  additionalProperties: false,
  properties: { turnId: { minLength: 1, type: "string" } },
  required: ["turnId"],
  type: "object",
} as const;

const PendingRequestParamsSchema = {
  additionalProperties: false,
  properties: { requestId: { minLength: 1, type: "string" } },
  required: ["requestId"],
  type: "object",
} as const;

const IdempotencyHeadersSchema = {
  properties: { "idempotency-key": { minLength: 1, type: "string" } },
  required: ["idempotency-key"],
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

const SourceFileQuerySchema = {
  additionalProperties: false,
  properties: { path: { minLength: 1, type: "string" } },
  required: ["path"],
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

class MutationHttpError extends Error {
  public constructor(
    public readonly code: AgentMutationError["code"],
    message: string,
    public readonly statusCode: number,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "MutationHttpError";
  }
}

interface IdempotencyEntry {
  expiresAt?: number;
  fingerprint: string;
  promise: Promise<unknown>;
}

const DEFAULT_IDEMPOTENCY_CACHE_SIZE = 1_000;
const DEFAULT_IDEMPOTENCY_TTL_MS = 10 * 60 * 1_000;

function normalizeJsonForFingerprint(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeJsonForFingerprint);
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  // Mutation Body 已通过 JSON Schema；递归排序对象键以消除字段顺序差异。
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => [key, normalizeJsonForFingerprint(item)]),
  );
}

function fingerprintPayload(payload: unknown): string {
  return JSON.stringify(normalizeJsonForFingerprint(payload));
}

function toPendingRequestHttpError(error: PendingRequestResolutionError): MutationHttpError {
  switch (error.code) {
    case "not_found":
      return new MutationHttpError("PENDING_REQUEST_NOT_FOUND", "Pending request not found", 404);
    case "expired":
      return new MutationHttpError("PENDING_REQUEST_EXPIRED", "Pending request expired", 409);
    case "resolved":
      return new MutationHttpError(
        "PENDING_REQUEST_ALREADY_RESOLVED",
        "Pending request already resolved",
        409,
      );
    case "mismatch":
      return new MutationHttpError(
        "PENDING_REQUEST_MISMATCH",
        "Pending request identity does not match",
        409,
      );
  }
}

export async function createCodeAgentServer(
  options: CreateCodeAgentServerOptions,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const readProjectGitStatus = options.readProjectGitStatus ?? readGitWorkingTreeStatus;
  const readSourceFile = options.readProjectSourceFile ?? readProjectSourceFile;
  const prepareFileRollback = options.prepareTurnFileRollback ?? prepareTurnFileRollback;
  const attachmentStore = new AttachmentStore();
  const capabilities = await options.provider.getCapabilities();
  const eventStream = new AgentEventStream({
    ...(options.eventBufferSize === undefined ? {} : { capacity: options.eventBufferSize }),
    provider: capabilities.provider,
    sessionId: options.eventSessionId ?? randomUUID(),
  });
  const unsubscribeProvider = options.provider.subscribeEvents((event) => {
    eventStream.publish(event);
  });
  const idempotencyEntries = new Map<string, IdempotencyEntry>();
  const idempotencyCacheSize = options.idempotencyCacheSize ?? DEFAULT_IDEMPOTENCY_CACHE_SIZE;
  const idempotencyTtlMs = options.idempotencyTtlMs ?? DEFAULT_IDEMPOTENCY_TTL_MS;
  if (!Number.isInteger(idempotencyCacheSize) || idempotencyCacheSize <= 0) {
    throw new RangeError("Idempotency cache size must be a positive integer");
  }
  if (!Number.isFinite(idempotencyTtlMs) || idempotencyTtlMs <= 0) {
    throw new RangeError("Idempotency TTL must be a positive number");
  }

  const pruneIdempotencyEntries = () => {
    const now = Date.now();
    for (const [entryKey, entry] of idempotencyEntries) {
      if (entry.expiresAt !== undefined && entry.expiresAt <= now) {
        idempotencyEntries.delete(entryKey);
      }
    }
    // 进行中的请求不能淘汰；成功条目按插入顺序移除最旧记录。
    for (const [entryKey, entry] of idempotencyEntries) {
      if (idempotencyEntries.size <= idempotencyCacheSize) {
        break;
      }
      if (entry.expiresAt !== undefined) {
        idempotencyEntries.delete(entryKey);
      }
    }
  };

  const runIdempotent = async <T>(
    operation: string,
    key: string,
    payload: unknown,
    action: () => Promise<T> | T,
  ): Promise<T> => {
    pruneIdempotencyEntries();
    // 结构化编码作用域，避免资源 ID 或 Key 中的分隔符产生碰撞。
    const entryKey = JSON.stringify([operation, key]);
    const fingerprint = fingerprintPayload(payload);
    const existing = idempotencyEntries.get(entryKey);
    if (existing !== undefined) {
      if (existing.fingerprint !== fingerprint) {
        throw new MutationHttpError(
          "IDEMPOTENCY_CONFLICT",
          "Idempotency key was already used with another request",
          409,
        );
      }
      return existing.promise as Promise<T>;
    }

    const promise = Promise.resolve()
      .then(action)
      .catch((error: unknown) => {
        if (error instanceof MutationHttpError) {
          throw error;
        }
        throw new MutationHttpError("PROVIDER_ERROR", "Agent provider request failed", 502, true);
      });
    const entry: IdempotencyEntry = { fingerprint, promise };
    idempotencyEntries.set(entryKey, entry);
    try {
      const result = await promise;
      entry.expiresAt = Date.now() + idempotencyTtlMs;
      pruneIdempotencyEntries();
      return result;
    } catch (error) {
      // 失败结果不进入幂等缓存，允许调用方使用同一 Key 安全重试。
      if (idempotencyEntries.get(entryKey) === entry) {
        idempotencyEntries.delete(entryKey);
      }
      throw error;
    }
  };

  await app.register(fastifyWebsocket, { options: { maxPayload: 64 * 1024 } });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof MutationHttpError) {
      return reply.code(error.statusCode).send({
        code: error.code,
        message: error.message,
        retryable: error.retryable,
      });
    }
    if (typeof error === "object" && error !== null && "validation" in error) {
      const key = request.headers["idempotency-key"];
      const missingKey = request.method === "POST" && (key === undefined || key === "");
      return reply.code(400).send({
        code: missingKey ? "IDEMPOTENCY_KEY_REQUIRED" : "INVALID_REQUEST",
        message: missingKey ? "Idempotency-Key header is required" : "Request is invalid",
        retryable: false,
      });
    }
    return reply.send(error);
  });
  app.addHook("onClose", () => {
    unsubscribeProvider();
    attachmentStore.clear();
    idempotencyEntries.clear();
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

  app.get("/v1/models", { schema: { response: { 200: AgentModelPageSchema } } }, () =>
    options.provider.listModels(),
  );

  app.get("/v1/projects", { schema: { response: { 200: ProjectPageSchema } } }, () => ({
    data: [options.project],
    nextCursor: null,
  }));

  app.get<{ Params: { projectId: string } }>(
    "/v1/projects/:projectId/git/status",
    {
      schema: {
        params: ProjectParamsSchema,
        response: {
          200: ProjectGitStatusSchema,
          404: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (request.params.projectId !== options.project.id) {
        return reply.code(404).send({ code: "PROJECT_NOT_FOUND", message: "Project not found" });
      }
      try {
        return await readProjectGitStatus(options.project.rootPath);
      } catch {
        // Git 和文件系统错误在 HTTP 边界统一收敛，避免向页面泄露本机路径细节。
        return reply.code(500).send({
          code: "GIT_STATUS_UNAVAILABLE",
          message: "Git working tree status is unavailable",
        });
      }
    },
  );

  app.get<{ Params: { projectId: string }; Querystring: { path: string } }>(
    "/v1/projects/:projectId/files/source",
    {
      schema: {
        params: ProjectParamsSchema,
        querystring: SourceFileQuerySchema,
        response: {
          200: ProjectSourceFileSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (request.params.projectId !== options.project.id) {
        return reply.code(404).send({ code: "PROJECT_NOT_FOUND", message: "Project not found" });
      }
      try {
        return await readSourceFile(options.project.rootPath, request.query.path);
      } catch {
        // 路径越界、文件不存在和二进制文件统一隐藏为不可预览，避免泄露本机文件信息。
        return reply.code(404).send({
          code: "SOURCE_FILE_NOT_FOUND",
          message: "Source file is unavailable",
        });
      }
    },
  );

  app.post<{
    Body: AgentAttachmentUploadRequest;
    Headers: { "idempotency-key": string };
  }>(
    "/v1/attachments",
    {
      bodyLimit: MAX_AGENT_ATTACHMENT_DATA_URL_LENGTH + 1_024,
      schema: {
        body: AgentAttachmentUploadRequestSchema,
        headers: IdempotencyHeadersSchema,
        response: {
          201: AgentAttachmentUploadResponseSchema,
          400: AgentMutationErrorSchema,
          409: AgentMutationErrorSchema,
          502: AgentMutationErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const attachment = await runIdempotent(
        "upload-attachment",
        request.headers["idempotency-key"],
        request.body,
        () => {
          try {
            return attachmentStore.add(request.body);
          } catch (error) {
            if (error instanceof TypeError || error instanceof RangeError) {
              throw new MutationHttpError("INVALID_REQUEST", "Attachment is invalid", 400);
            }
            throw error;
          }
        },
      );
      return reply.code(201).send({ attachment });
    },
  );

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

  app.post<{
    Body: RollbackAgentTurnRequest;
    Headers: { "idempotency-key": string };
    Params: { turnId: string };
  }>(
    "/v1/turns/:turnId/rollback",
    {
      schema: {
        body: RollbackAgentTurnRequestSchema,
        headers: IdempotencyHeadersSchema,
        params: TurnParamsSchema,
        response: {
          200: RollbackAgentTurnResponseSchema,
          400: AgentMutationErrorSchema,
          404: AgentMutationErrorSchema,
          409: AgentMutationErrorSchema,
          502: AgentMutationErrorSchema,
        },
      },
    },
    async (request) =>
      runIdempotent(
        `rollback-turn:${request.params.turnId}`,
        request.headers["idempotency-key"],
        request.body,
        async () => {
          const task = await options.provider.readTask(request.body.taskId);
          if (task?.projectId !== options.project.id) {
            throw new MutationHttpError("TASK_NOT_FOUND", "Task not found", 404);
          }
          const latestTurn = task.turns.at(-1);
          const requestedTurn = task.turns.find((turn) => turn.id === request.params.turnId);
          if (requestedTurn === undefined) {
            throw new MutationHttpError("TURN_NOT_FOUND", "Turn not found", 404);
          }
          if (latestTurn?.id !== requestedTurn.id || requestedTurn.status !== "completed") {
            throw new MutationHttpError(
              "TURN_NOT_ROLLBACKABLE",
              "Only the latest completed turn can be rolled back",
              409,
            );
          }
          const changes = requestedTurn.items.flatMap((item) =>
            item.type === "file_change" && item.status === "completed" ? item.changes : [],
          );
          let preparedRollback: PreparedTurnFileRollback;
          try {
            preparedRollback = await prepareFileRollback(options.project.rootPath, changes);
            await preparedRollback.applyReverse();
          } catch (error) {
            if (error instanceof TurnFileRollbackError) {
              throw new MutationHttpError(
                "FILE_ROLLBACK_CONFLICT",
                "Files changed after this turn and cannot be safely restored",
                409,
              );
            }
            throw error;
          }

          try {
            // Codex 只撤销会话历史；文件已通过预检并在此前恢复。
            await options.provider.rollbackLatestTurn(request.body.taskId);
          } catch (providerError) {
            try {
              // Provider 失败时恢复正向补丁，避免会话与工作区状态分裂。
              await preparedRollback.applyForward();
            } catch {
              throw new MutationHttpError(
                "FILE_ROLLBACK_CONFLICT",
                "Codex rollback failed and file changes could not be restored",
                409,
              );
            }
            throw providerError;
          }

          return {
            restoredFiles: preparedRollback.restoredFiles,
            status: "rolled_back" as const,
            taskId: request.body.taskId,
            turnId: request.params.turnId,
          };
        },
      ),
  );

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
        response: {
          201: StartAgentTaskResponseSchema,
          400: AgentMutationErrorSchema,
          404: AgentMutationErrorSchema,
          409: AgentMutationErrorSchema,
          502: AgentMutationErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (request.params.projectId !== options.project.id) {
        throw new MutationHttpError("PROJECT_NOT_FOUND", "Project not found", 404);
      }
      const task = await runIdempotent(
        `start-task:${request.params.projectId}`,
        request.headers["idempotency-key"],
        request.body,
        () => options.provider.startTask(),
      );
      return reply.code(201).send({ task });
    },
  );

  app.post<{
    Body: StartAgentTurnRequest;
    Headers: { "idempotency-key": string };
    Params: { taskId: string };
  }>(
    "/v1/tasks/:taskId/turns",
    {
      schema: {
        body: StartAgentTurnRequestSchema,
        headers: IdempotencyHeadersSchema,
        params: TaskParamsSchema,
        response: {
          201: StartAgentTurnResponseSchema,
          400: AgentMutationErrorSchema,
          404: AgentMutationErrorSchema,
          409: AgentMutationErrorSchema,
          502: AgentMutationErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const turn = await runIdempotent(
        `start-turn:${request.params.taskId}`,
        request.headers["idempotency-key"],
        request.body,
        async () => {
          const task = await options.provider.readTask(request.params.taskId);
          if (task?.projectId !== options.project.id) {
            throw new MutationHttpError("TASK_NOT_FOUND", "Task not found", 404);
          }
          const attachmentIds = request.body.input.attachments.map((attachment) => attachment.id);
          if (new Set(attachmentIds).size !== attachmentIds.length) {
            throw new MutationHttpError(
              "INVALID_REQUEST",
              "Duplicate attachments are not allowed",
              400,
            );
          }
          let images;
          try {
            images = attachmentStore.resolve(attachmentIds);
          } catch (error) {
            if (error instanceof AttachmentNotFoundError) {
              throw new MutationHttpError(
                "ATTACHMENT_NOT_FOUND",
                "Attachment was not found or has expired",
                404,
              );
            }
            throw error;
          }
          const turn = await options.provider.startTurn(
            request.params.taskId,
            { images, text: request.body.input.text },
            request.body.options,
          );
          // 只有 Provider 确认启动成功后才消费附件，网络失败仍允许原请求重试。
          attachmentStore.consume(attachmentIds);
          return turn;
        },
      );
      return reply.code(201).send({ taskId: request.params.taskId, turn });
    },
  );

  app.post<{
    Body: { taskId: string };
    Headers: { "idempotency-key": string };
    Params: { turnId: string };
  }>(
    "/v1/turns/:turnId/interrupt",
    {
      schema: {
        body: InterruptAgentTurnRequestSchema,
        headers: IdempotencyHeadersSchema,
        params: TurnParamsSchema,
        response: {
          202: InterruptAgentTurnResponseSchema,
          400: AgentMutationErrorSchema,
          404: AgentMutationErrorSchema,
          409: AgentMutationErrorSchema,
          502: AgentMutationErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const response = await runIdempotent(
        `interrupt-turn:${request.params.turnId}`,
        request.headers["idempotency-key"],
        request.body,
        async () => {
          const task = await options.provider.readTask(request.body.taskId);
          if (task?.projectId !== options.project.id) {
            throw new MutationHttpError("TASK_NOT_FOUND", "Task not found", 404);
          }
          const turn = task.turns.find((item) => item.id === request.params.turnId);
          if (turn === undefined) {
            throw new MutationHttpError("TURN_NOT_FOUND", "Turn not found", 404);
          }
          if (turn.status !== "running") {
            throw new MutationHttpError("TURN_NOT_RUNNING", "Turn is not running", 409);
          }
          await options.provider.interruptTurn(request.body.taskId, request.params.turnId);
          return {
            status: "interrupting" as const,
            taskId: request.body.taskId,
            turnId: request.params.turnId,
          };
        },
      );
      return reply.code(202).send(response);
    },
  );

  app.post<{
    Body: ResolvePendingRequestRequest;
    Headers: { "idempotency-key": string };
    Params: { requestId: string };
  }>(
    "/v1/pending-requests/:requestId/resolve",
    {
      schema: {
        body: ResolvePendingRequestRequestSchema,
        headers: IdempotencyHeadersSchema,
        params: PendingRequestParamsSchema,
        response: {
          200: ResolvePendingRequestResponseSchema,
          400: AgentMutationErrorSchema,
          404: AgentMutationErrorSchema,
          409: AgentMutationErrorSchema,
          502: AgentMutationErrorSchema,
        },
      },
    },
    async (request) => {
      if (request.body.projectId !== options.project.id) {
        throw new MutationHttpError("PROJECT_NOT_FOUND", "Project not found", 404);
      }
      const resolvedRequest = await runIdempotent(
        `resolve-pending-request:${request.params.requestId}`,
        request.headers["idempotency-key"],
        request.body,
        async () => {
          try {
            return await options.provider.resolvePendingRequest({
              ...request.body,
              requestId: request.params.requestId,
            });
          } catch (error) {
            if (error instanceof PendingRequestResolutionError) {
              throw toPendingRequestHttpError(error);
            }
            throw error;
          }
        },
      );
      return { request: resolvedRequest };
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
