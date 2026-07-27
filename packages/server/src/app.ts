import { randomUUID } from "node:crypto";
import { basename } from "node:path";

import {
  PendingRequestResolutionError,
  type AgentProvider,
  type AgentRuntimeProvider,
  type AgentSettingsRepository,
  type ProjectRepository,
} from "@code-agent/core";
import {
  AddProjectResponseSchema,
  AgentCapabilitiesSchema,
  CompactAgentTaskRequestSchema,
  CompactAgentTaskResponseSchema,
  ForkAgentTaskRequestSchema,
  ForkAgentTaskResponseSchema,
  AgentAttachmentUploadRequestSchema,
  AgentAttachmentUploadResponseSchema,
  AgentModelPageSchema,
  AgentProjectDefaultsResponseSchema,
  AgentProjectDefaultsSchema,
  AgentMutationErrorSchema,
  AgentTaskPageSchema,
  AgentTaskSettingsResponseSchema,
  AgentTaskSettingsSchema,
  AgentTaskSnapshotResponseSchema,
  HealthResponseSchema,
  InterruptAgentTurnRequestSchema,
  InterruptAgentTurnResponseSchema,
  ProjectPageSchema,
  ProjectGitStatusSchema,
  ProjectSourceFileSchema,
  ReviewAgentTaskRequestSchema,
  ReviewAgentTaskResponseSchema,
  RollbackAgentTurnRequestSchema,
  RollbackAgentTurnResponseSchema,
  ResolvePendingRequestRequestSchema,
  ResolvePendingRequestResponseSchema,
  StartAgentTaskRequestSchema,
  StartAgentTaskResponseSchema,
  StartAgentTurnRequestSchema,
  StartAgentTurnResponseSchema,
  UploadAgentFeedbackRequestSchema,
  UploadAgentFeedbackResponseSchema,
  MAX_AGENT_ATTACHMENT_DATA_URL_LENGTH,
  type AgentAttachmentUploadRequest,
  type AgentMutationError,
  type AgentModel,
  type AgentProjectDefaults,
  type AgentTask,
  type AgentTaskSettings,
  type EventStreamMessage,
  type CompactAgentTaskRequest,
  type ForkAgentTaskRequest,
  type Project,
  type ProjectGitStatus,
  type ProjectSourceFile,
  type RollbackAgentTurnRequest,
  type ReviewAgentTaskRequest,
  type ResolvePendingRequestRequest,
  type StartAgentTurnRequest,
  type UploadAgentFeedbackRequest,
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
  projectRepository: ProjectRepository;
  provider: AgentRuntimeProvider;
  settingsRepository: AgentSettingsRepository;
  readProjectGitStatus?: (projectRoot: string) => Promise<ProjectGitStatus>;
  readProjectSourceFile?: (projectRoot: string, path: string) => Promise<ProjectSourceFile>;
  prepareTurnFileRollback?: (
    projectRoot: string,
    changes: Parameters<typeof prepareTurnFileRollback>[1],
  ) => Promise<PreparedTurnFileRollback>;
  selectProjectDirectory: () => Promise<string | undefined>;
  staticRoot?: string;
}

const ProjectParamsSchema = {
  additionalProperties: false,
  properties: { projectId: { minLength: 1, type: "string" } },
  required: ["projectId"],
  type: "object",
} as const;

const ProjectTaskParamsSchema = {
  additionalProperties: false,
  properties: {
    projectId: { minLength: 1, type: "string" },
    taskId: { minLength: 1, type: "string" },
  },
  required: ["projectId", "taskId"],
  type: "object",
} as const;

const ProjectTaskTurnParamsSchema = {
  additionalProperties: false,
  properties: {
    projectId: { minLength: 1, type: "string" },
    taskId: { minLength: 1, type: "string" },
    turnId: { minLength: 1, type: "string" },
  },
  required: ["projectId", "taskId", "turnId"],
  type: "object",
} as const;

const ProjectTaskPendingRequestParamsSchema = {
  additionalProperties: false,
  properties: {
    projectId: { minLength: 1, type: "string" },
    requestId: { minLength: 1, type: "string" },
    taskId: { minLength: 1, type: "string" },
  },
  required: ["projectId", "taskId", "requestId"],
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

function orderById<T extends Readonly<{ id: string }>>(values: readonly T[]): readonly T[] {
  return [...values].sort((left, right) => left.id.localeCompare(right.id, "en"));
}

function resolveProjectDefaults(
  models: readonly AgentModel[],
  requested?: AgentProjectDefaults,
): AgentProjectDefaults {
  const orderedModels = orderById(models);
  const model =
    orderedModels.find((item) => item.id === requested?.model) ??
    orderedModels.find((item) => item.isDefault) ??
    orderedModels[0];
  if (model === undefined) {
    throw new MutationHttpError("PROVIDER_ERROR", "No Agent models are available", 502, true);
  }
  const orderedEfforts = orderById(model.supportedReasoningEfforts);
  const reasoningEffort =
    orderedEfforts.find((item) => item.id === requested?.reasoningEffort)?.id ??
    orderedEfforts.find((item) => item.id === model.defaultReasoningEffort)?.id ??
    orderedEfforts[0]?.id;
  if (reasoningEffort === undefined) {
    throw new MutationHttpError(
      "PROVIDER_ERROR",
      "The selected Agent model has no reasoning effort",
      502,
      true,
    );
  }
  return { model: model.id, reasoningEffort };
}

function assertValidProjectDefaults(
  models: readonly AgentModel[],
  settings: AgentProjectDefaults,
): void {
  const effective = resolveProjectDefaults(models, settings);
  if (
    effective.model !== settings.model ||
    effective.reasoningEffort !== settings.reasoningEffort
  ) {
    throw new MutationHttpError(
      "INVALID_REQUEST",
      "Model and reasoning effort combination is invalid",
      400,
    );
  }
}

function projectDefaultsEqual(
  left: AgentProjectDefaults | undefined,
  right: AgentProjectDefaults,
): boolean {
  return left?.model === right.model && left.reasoningEffort === right.reasoningEffort;
}

function taskSettingsEqual(left: AgentTaskSettings | undefined, right: AgentTaskSettings): boolean {
  return (
    left?.approvalPolicy === right.approvalPolicy &&
    left.model === right.model &&
    left.reasoningEffort === right.reasoningEffort
  );
}

interface IdempotencyEntry {
  expiresAt?: number;
  fingerprint: string;
  promise: Promise<unknown>;
}

type TaskStartRecovery = Readonly<{
  fingerprint: string;
  settings: AgentTaskSettings;
  task: AgentTask;
}>;

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
  const projectContexts = new Map<
    string,
    Readonly<{
      eventStream: AgentEventStream;
      project: Project;
      provider: AgentProvider;
      unsubscribe: () => void;
    }>
  >();
  const getProjectContext = async (projectId: string) => {
    const project = await options.projectRepository.read(projectId);
    if (project === undefined) {
      return undefined;
    }
    const existing = projectContexts.get(projectId);
    if (existing !== undefined) {
      if (existing.project.rootPath !== project.rootPath) {
        throw new Error("Project identity changed while the runtime was active");
      }
      return existing;
    }
    const provider = options.provider.forProject(project);
    const eventStream = new AgentEventStream({
      ...(options.eventBufferSize === undefined ? {} : { capacity: options.eventBufferSize }),
      provider: capabilities.provider,
      sessionId: options.eventSessionId ?? randomUUID(),
    });
    const context = {
      eventStream,
      project,
      provider,
      unsubscribe: provider.subscribeEvents((event) => {
        eventStream.publish(event);
      }),
    };
    projectContexts.set(projectId, context);
    return context;
  };
  const listModels = async (): Promise<readonly AgentModel[]> =>
    (await options.provider.listModels()).data;
  const readEffectiveProjectDefaults = async (
    projectId: string,
    models?: readonly AgentModel[],
  ): Promise<AgentProjectDefaults> => {
    const catalog = models ?? (await listModels());
    const stored = await options.settingsRepository.readProjectDefaults(projectId);
    const effective = resolveProjectDefaults(catalog, stored);
    if (!projectDefaultsEqual(stored, effective)) {
      await options.settingsRepository.writeProjectDefaults(projectId, effective);
    }
    return effective;
  };
  const readEffectiveTaskSettings = async (
    projectId: string,
    taskId: string,
    models?: readonly AgentModel[],
  ): Promise<AgentTaskSettings> => {
    const catalog = models ?? (await listModels());
    const stored = await options.settingsRepository.readTaskSettings(projectId, taskId);
    const defaults = await readEffectiveProjectDefaults(projectId, catalog);
    const effectiveModel = resolveProjectDefaults(catalog, stored ?? defaults);
    const effective = {
      approvalPolicy: stored?.approvalPolicy ?? "on-request",
      ...effectiveModel,
    } satisfies AgentTaskSettings;
    if (!taskSettingsEqual(stored, effective)) {
      await options.settingsRepository.writeTaskSettings(projectId, taskId, effective);
    }
    return effective;
  };
  // 启动时只为已持久化 Project 建立事件流；后续新增项目在首次注册时懒创建。
  for (const project of await options.projectRepository.list()) {
    await getProjectContext(project.id);
  }
  const idempotencyEntries = new Map<string, IdempotencyEntry>();
  const taskStartRecoveries = new Map<string, TaskStartRecovery>();
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
    scope: readonly string[],
    key: string,
    payload: unknown,
    action: () => Promise<T> | T,
  ): Promise<T> => {
    pruneIdempotencyEntries();
    // 结构化编码完整资源作用域，避免跨 Project 命中或分隔符碰撞。
    const entryKey = JSON.stringify([...scope, key]);
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
      const missingKey =
        (request.method === "POST" || request.method === "PUT") &&
        (key === undefined || key === "");
      return reply.code(400).send({
        code: missingKey ? "IDEMPOTENCY_KEY_REQUIRED" : "INVALID_REQUEST",
        message: missingKey ? "Idempotency-Key header is required" : "Request is invalid",
        retryable: false,
      });
    }
    return reply.send(error);
  });
  app.addHook("onClose", () => {
    for (const context of projectContexts.values()) {
      context.unsubscribe();
    }
    projectContexts.clear();
    attachmentStore.clear();
    idempotencyEntries.clear();
    taskStartRecoveries.clear();
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

  app.get("/v1/projects", { schema: { response: { 200: ProjectPageSchema } } }, async () => ({
    data: await options.projectRepository.list(),
    nextCursor: null,
  }));

  app.get<{ Params: { projectId: string } }>(
    "/v1/projects/:projectId/defaults",
    {
      schema: {
        params: ProjectParamsSchema,
        response: { 200: AgentProjectDefaultsResponseSchema, 404: ErrorResponseSchema },
      },
    },
    async (request, reply) => {
      if ((await getProjectContext(request.params.projectId)) === undefined) {
        return reply.code(404).send({ code: "PROJECT_NOT_FOUND", message: "Project not found" });
      }
      return { settings: await readEffectiveProjectDefaults(request.params.projectId) };
    },
  );

  app.put<{
    Body: AgentProjectDefaults;
    Headers: { "idempotency-key": string };
    Params: { projectId: string };
  }>(
    "/v1/projects/:projectId/defaults",
    {
      schema: {
        body: AgentProjectDefaultsSchema,
        headers: IdempotencyHeadersSchema,
        params: ProjectParamsSchema,
        response: {
          200: AgentProjectDefaultsResponseSchema,
          400: AgentMutationErrorSchema,
          404: AgentMutationErrorSchema,
          409: AgentMutationErrorSchema,
          502: AgentMutationErrorSchema,
        },
      },
    },
    async (request) =>
      runIdempotent(
        ["update-project-defaults", request.params.projectId],
        request.headers["idempotency-key"],
        request.body,
        async () => {
          if ((await getProjectContext(request.params.projectId)) === undefined) {
            throw new MutationHttpError("PROJECT_NOT_FOUND", "Project not found", 404);
          }
          assertValidProjectDefaults(await listModels(), request.body);
          return {
            settings: await options.settingsRepository.writeProjectDefaults(
              request.params.projectId,
              request.body,
            ),
          };
        },
      ),
  );

  app.post<{
    Body: Record<string, never>;
    Headers: { "idempotency-key": string };
  }>(
    "/v1/projects",
    {
      schema: {
        body: StartAgentTaskRequestSchema,
        headers: IdempotencyHeadersSchema,
        response: {
          200: AddProjectResponseSchema,
          400: AgentMutationErrorSchema,
          409: AgentMutationErrorSchema,
          502: AgentMutationErrorSchema,
        },
      },
    },
    async (request) =>
      runIdempotent(["add-project"], request.headers["idempotency-key"], request.body, async () => {
        const selectedPath = await options.selectProjectDirectory();
        if (selectedPath === undefined) {
          return { project: null };
        }
        const project = await options.projectRepository.register({
          name: basename(selectedPath),
          rootPath: selectedPath,
        });
        return { project };
      }),
  );

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
      const context = await getProjectContext(request.params.projectId);
      if (context === undefined) {
        return reply.code(404).send({ code: "PROJECT_NOT_FOUND", message: "Project not found" });
      }
      try {
        return await readProjectGitStatus(context.project.rootPath);
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
      const context = await getProjectContext(request.params.projectId);
      if (context === undefined) {
        return reply.code(404).send({ code: "PROJECT_NOT_FOUND", message: "Project not found" });
      }
      try {
        return await readSourceFile(context.project.rootPath, request.query.path);
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
    Params: { projectId: string };
  }>(
    "/v1/projects/:projectId/attachments",
    {
      bodyLimit: MAX_AGENT_ATTACHMENT_DATA_URL_LENGTH + 1_024,
      schema: {
        body: AgentAttachmentUploadRequestSchema,
        headers: IdempotencyHeadersSchema,
        params: ProjectParamsSchema,
        response: {
          201: AgentAttachmentUploadResponseSchema,
          400: AgentMutationErrorSchema,
          409: AgentMutationErrorSchema,
          502: AgentMutationErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if ((await getProjectContext(request.params.projectId)) === undefined) {
        throw new MutationHttpError("PROJECT_NOT_FOUND", "Project not found", 404);
      }
      const attachment = await runIdempotent(
        ["upload-attachment", request.params.projectId],
        request.headers["idempotency-key"],
        request.body,
        () => {
          try {
            return attachmentStore.add(request.params.projectId, request.body);
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
            settings: await options.settingsRepository.writeTaskSettings(
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

  app.post<{
    Body: RollbackAgentTurnRequest;
    Headers: { "idempotency-key": string };
    Params: { projectId: string; taskId: string; turnId: string };
  }>(
    "/v1/projects/:projectId/tasks/:taskId/turns/:turnId/rollback",
    {
      schema: {
        body: RollbackAgentTurnRequestSchema,
        headers: IdempotencyHeadersSchema,
        params: ProjectTaskTurnParamsSchema,
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
        ["rollback-turn", request.params.projectId, request.params.taskId, request.params.turnId],
        request.headers["idempotency-key"],
        request.body,
        async () => {
          if (request.body.taskId !== request.params.taskId) {
            throw new MutationHttpError("TASK_NOT_FOUND", "Task not found", 404);
          }
          const context = await getProjectContext(request.params.projectId);
          if (context === undefined) {
            throw new MutationHttpError("PROJECT_NOT_FOUND", "Project not found", 404);
          }
          const task = await context.provider.readTask(request.params.taskId);
          if (task?.projectId !== context.project.id) {
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
            preparedRollback = await prepareFileRollback(context.project.rootPath, changes);
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
            await context.provider.rollbackLatestTurn(request.params.taskId);
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
      const context = await getProjectContext(request.params.projectId);
      if (context === undefined) {
        throw new MutationHttpError("PROJECT_NOT_FOUND", "Project not found", 404);
      }
      const task = await runIdempotent(
        ["start-task", request.params.projectId],
        request.headers["idempotency-key"],
        request.body,
        async () => {
          const recoveryKey = JSON.stringify([
            "start-task",
            request.params.projectId,
            request.headers["idempotency-key"],
          ]);
          const fingerprint = fingerprintPayload(request.body);
          let recovery = taskStartRecoveries.get(recoveryKey);
          if (recovery !== undefined && recovery.fingerprint !== fingerprint) {
            throw new MutationHttpError(
              "IDEMPOTENCY_CONFLICT",
              "Idempotency key was already used with another request",
              409,
            );
          }
          if (recovery === undefined) {
            if (taskStartRecoveries.size >= idempotencyCacheSize) {
              throw new Error("Task creation recovery capacity is exhausted");
            }
            const defaults = await readEffectiveProjectDefaults(request.params.projectId);
            const task = await context.provider.startTask();
            // Provider 已创建 Task 后立即保留恢复状态，后续落库重试不能再次创建 Task。
            recovery = {
              fingerprint,
              settings: { approvalPolicy: "on-request", ...defaults },
              task,
            };
            taskStartRecoveries.set(recoveryKey, recovery);
          }
          await options.settingsRepository.writeTaskSettings(
            request.params.projectId,
            recovery.task.id,
            recovery.settings,
          );
          taskStartRecoveries.delete(recoveryKey);
          return recovery.task;
        },
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
        ["start-turn", request.params.projectId, request.params.taskId],
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
            images = attachmentStore.resolve(request.params.projectId, attachmentIds);
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
          assertValidProjectDefaults(await listModels(), request.body.options);
          // Turn 设置先落库，Provider 成功或进程退出后都能恢复用户最后一次完整选择。
          await options.settingsRepository.writeTaskSettings(
            request.params.projectId,
            request.params.taskId,
            request.body.options,
          );
          const turn = await context.provider.startTurn(
            request.params.taskId,
            { images, text: request.body.input.text },
            request.body.options,
          );
          // 只有 Provider 确认启动成功后才消费附件，网络失败仍允许原请求重试。
          attachmentStore.consume(request.params.projectId, attachmentIds);
          return turn;
        },
      );
      return reply.code(201).send({ taskId: request.params.taskId, turn });
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
        ["interrupt-turn", request.params.projectId, request.params.taskId, request.params.turnId],
        request.headers["idempotency-key"],
        request.body,
        async () => {
          if (request.body.taskId !== request.params.taskId) {
            throw new MutationHttpError("TASK_NOT_FOUND", "Task not found", 404);
          }
          const context = await getProjectContext(request.params.projectId);
          if (context === undefined) {
            throw new MutationHttpError("PROJECT_NOT_FOUND", "Project not found", 404);
          }
          const task = await context.provider.readTask(request.params.taskId);
          if (task?.projectId !== context.project.id) {
            throw new MutationHttpError("TASK_NOT_FOUND", "Task not found", 404);
          }
          const turn = task.turns.find((item) => item.id === request.params.turnId);
          if (turn === undefined) {
            throw new MutationHttpError("TURN_NOT_FOUND", "Turn not found", 404);
          }
          if (turn.status !== "running") {
            throw new MutationHttpError("TURN_NOT_RUNNING", "Turn is not running", 409);
          }
          await context.provider.interruptTurn(request.params.taskId, request.params.turnId);
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
    Params: { projectId: string; requestId: string; taskId: string };
  }>(
    "/v1/projects/:projectId/tasks/:taskId/pending-requests/:requestId/resolve",
    {
      schema: {
        body: ResolvePendingRequestRequestSchema,
        headers: IdempotencyHeadersSchema,
        params: ProjectTaskPendingRequestParamsSchema,
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
      const context = await getProjectContext(request.params.projectId);
      if (context === undefined) {
        throw new MutationHttpError("PROJECT_NOT_FOUND", "Project not found", 404);
      }
      const task = await context.provider.readTask(request.params.taskId);
      if (task?.projectId !== context.project.id) {
        throw new MutationHttpError("TASK_NOT_FOUND", "Task not found", 404);
      }
      const resolvedRequest = await runIdempotent(
        [
          "resolve-pending-request",
          request.params.projectId,
          request.params.taskId,
          request.params.requestId,
        ],
        request.headers["idempotency-key"],
        request.body,
        async () => {
          try {
            return await context.provider.resolvePendingRequest({
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

  app.get<{ Params: { projectId: string }; Querystring: { afterSequence: number } }>(
    "/v1/projects/:projectId/events",
    {
      async preValidation(request, reply) {
        if ((await getProjectContext(request.params.projectId)) === undefined) {
          return await reply
            .code(404)
            .send({ code: "PROJECT_NOT_FOUND", message: "Project not found" });
        }
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
      schema: { params: ProjectParamsSchema, querystring: EventQuerySchema },
      websocket: true,
    },
    (socket, request) => {
      const context = projectContexts.get(request.params.projectId);
      if (context === undefined) {
        socket.close(1008, "Project not found");
        return;
      }
      const eventStream = context.eventStream;
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
