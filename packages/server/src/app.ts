import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { relative, sep } from "node:path";

import type {
  PendingRequestResolutionError,
  AgentProvider,
  AgentProviderEvent,
  AgentProviderTurnInput,
  AgentRuntimeProvider,
  AgentSettingsRepository,
  ProjectRepository,
} from "@code-agent/core";
import {
  MAX_AGENT_FILE_BYTES,
  MAX_AGENT_FILE_TOTAL_BYTES,
  MAX_AGENT_IMAGE_BYTES,
  MAX_AGENT_IMAGES,
  MAX_AGENT_IMAGE_TOTAL_BYTES,
  MAX_AGENT_TEXT_BYTES,
  type AgentAttachmentKind,
  type AgentGlobalSettings,
  type AgentModel,
  type AgentModelPage,
  type AgentPromptInput,
  type AgentProjectDefaults,
  type AgentSandboxMode,
  type AgentTask,
  type AgentTaskSettings,
  type AgentTurn,
  type CommitProjectChangesRequest,
  type CommitProjectChangesResponse,
  type GenerateCommitMessageRequest,
  type ProjectFileTree,
  type ProjectGitStatus,
  type ProjectSourceFile,
} from "@code-agent/protocol";
import fastifyCompress from "@fastify/compress";
import fastifyCookie from "@fastify/cookie";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import Fastify, {
  LogController,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";

import { AgentEventStream } from "./agent-event-stream.js";
import { AccessSessionService, type CodeAgentAccessOptions } from "./access-control.js";
import { AttachmentNotFoundError, AttachmentStore } from "./attachment-store.js";
import { commitSelectedProjectChanges, type GitCommitError } from "./git-commit.js";
import { buildCommitMessagePrompt } from "./git-commit-message.js";
import { readGitWorkingTreeStatus } from "./git-working-tree.js";
import { readProjectFileTree } from "./project-file-tree.js";
import { readProjectImageFile, type ProjectImageFile } from "./project-image-file.js";
import { readProjectSourceFile } from "./project-source-file.js";
import { createProjectOpenService, type ProjectOpenService } from "./project-open.js";
import { prepareTurnFileRollback, type PreparedTurnFileRollback } from "./turn-file-rollback.js";
import {
  MutationHttpError,
  type ProjectContextResolver,
  type ProjectRuntimeContext,
  type RunIdempotent,
  type ServerRouteContext,
  type TaskStartRecovery,
} from "./routes/context.js";
import { registerEventRoutes } from "./routes/event-routes.js";
import { ACCESS_SESSION_COOKIE, registerAccessRoutes } from "./routes/access-routes.js";
import { registerProjectRoutes } from "./routes/project-routes.js";
import { registerRuntimeRoutes } from "./routes/runtime-routes.js";
import { registerTaskRoutes } from "./routes/task-routes.js";
import { registerTurnRoutes } from "./routes/turn-routes.js";

export interface CreateCodeAgentServerOptions {
  access?: CodeAgentAccessOptions;
  eventBufferSize?: number;
  eventSessionId?: string;
  handlerTimeoutMs?: number;
  idempotencyCacheSize?: number;
  idempotencyTtlMs?: number;
  loggerEnabled?: boolean;
  logDestination?: Readonly<{ write: (message: string) => void }>;
  modelCatalogCacheMaxBytes?: number;
  modelCatalogCacheTtlMs?: number;
  projectRepository: ProjectRepository;
  projectOpenService?: ProjectOpenService;
  provider: AgentRuntimeProvider;
  settingsRepository: AgentSettingsRepository;
  commitProjectChanges?: (
    projectRoot: string,
    request: CommitProjectChangesRequest,
  ) => Promise<CommitProjectChangesResponse>;
  readProjectGitStatus?: (projectRoot: string) => Promise<ProjectGitStatus>;
  readProjectFileTree?: (projectRoot: string, directoryPath?: string) => Promise<ProjectFileTree>;
  readProjectImageFile?: (projectRoot: string, path: string) => Promise<ProjectImageFile>;
  readProjectSourceFile?: (projectRoot: string, path: string) => Promise<ProjectSourceFile>;
  prepareTurnFileRollback?: (
    projectRoot: string,
    changes: Parameters<typeof prepareTurnFileRollback>[1],
  ) => Promise<PreparedTurnFileRollback>;
  selectProjectDirectory: () => Promise<string | undefined>;
  staticRoot?: string;
}

const MULTIPART_ENVELOPE_BYTES = 64 * 1024;

function maximumAttachmentBytes(kind: AgentAttachmentKind): number {
  if (kind === "image") {
    return MAX_AGENT_IMAGE_BYTES;
  }
  return kind === "text" ? MAX_AGENT_TEXT_BYTES : MAX_AGENT_FILE_BYTES;
}

function orderById<T extends Readonly<{ id: string }>>(values: readonly T[]): readonly T[] {
  return [...values].sort((left, right) => left.id.localeCompare(right.id, "en"));
}

function resolveProjectDefaults(
  models: readonly AgentModel[],
  requested?: AgentProjectDefaults,
  fallbackSandboxMode: AgentSandboxMode = "workspace-write",
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
  return {
    model: model.id,
    reasoningEffort,
    sandboxMode: requested?.sandboxMode ?? fallbackSandboxMode,
  };
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

function taskFromSnapshot(
  snapshot: Awaited<ReturnType<AgentProvider["readTask"]>> & object,
  overrides: Partial<Pick<AgentTask, "title">> = {},
): AgentTask {
  return {
    id: snapshot.id,
    pinned: snapshot.pinned,
    projectId: snapshot.projectId,
    title: overrides.title ?? snapshot.title,
    updatedAt: snapshot.updatedAt,
  };
}

interface IdempotencyEntry {
  expiresAt?: number;
  fingerprint: string;
  promise: Promise<unknown>;
}

type ModelCatalogCacheEntry = Readonly<{
  expiresAt: number;
  page: AgentModelPage;
}>;

class ModelCatalogCache {
  readonly #load: () => Promise<AgentModelPage>;
  readonly #maxBytes: number;
  readonly #ttlMs: number;
  #entry: ModelCatalogCacheEntry | undefined;
  #generation = 0;
  #inFlight: Promise<AgentModelPage> | undefined;

  public constructor(
    load: () => Promise<AgentModelPage>,
    options: Readonly<{ maxBytes: number; ttlMs: number }>,
  ) {
    this.#load = load;
    this.#maxBytes = options.maxBytes;
    this.#ttlMs = options.ttlMs;
  }

  public read(): Promise<AgentModelPage> {
    const entry = this.#entry;
    if (entry !== undefined && entry.expiresAt > Date.now()) {
      return Promise.resolve(entry.page);
    }
    this.#entry = undefined;
    if (this.#inFlight !== undefined) {
      return this.#inFlight;
    }

    const generation = this.#generation;
    const inFlight = this.#load()
      .then((page) => {
        // 仅驻留有界目录；超限响应仍正常返回，并继续共享本次 in-flight 请求。
        const size = Buffer.byteLength(JSON.stringify(page), "utf8");
        if (generation === this.#generation && size <= this.#maxBytes) {
          this.#entry = { expiresAt: Date.now() + this.#ttlMs, page };
        }
        return page;
      })
      .finally(() => {
        if (this.#inFlight === inFlight) {
          this.#inFlight = undefined;
        }
      });
    this.#inFlight = inFlight;
    return inFlight;
  }

  public clear(): void {
    // Runtime 关闭或 Provider 重建时提升代次，阻止旧请求回填缓存。
    this.#generation += 1;
    this.#entry = undefined;
    this.#inFlight = undefined;
  }
}

const DEFAULT_IDEMPOTENCY_CACHE_SIZE = 1_000;
const DEFAULT_IDEMPOTENCY_TTL_MS = 10 * 60 * 1_000;
const DEFAULT_HANDLER_TIMEOUT_MS = 60_000;
const DEFAULT_MODEL_CATALOG_CACHE_MAX_BYTES = 1 * 1_024 * 1_024;
const DEFAULT_MODEL_CATALOG_CACHE_TTL_MS = 30_000;
const COMMIT_MESSAGE_TIMEOUT_MS = 55_000;
const COMMIT_MESSAGE_OUTPUT_SCHEMA = {
  additionalProperties: false,
  properties: {
    message: { maxLength: 10_000, minLength: 1, type: "string" },
  },
  required: ["message"],
  type: "object",
} as const;

class CodeAgentLogController extends LogController {
  public override incomingRequest(): void {
    // 正常请求不写终端日志，只保留服务端错误的完成上下文。
  }

  public override requestCompleted(
    error: Error | null,
    request: FastifyRequest,
    reply: FastifyReply,
  ): void {
    const fields = {
      durationMs: reply.elapsedTime,
      ...(error ? { errorCode: error.name } : {}),
      method: request.method,
      requestId: request.id,
      route: request.routeOptions.url,
      statusCode: reply.statusCode,
    };
    if (reply.statusCode >= 500) {
      request.log.error(fields, "request completed");
    }
  }
}

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

function assertCommitSelection(
  status: ProjectGitStatus,
  request: GenerateCommitMessageRequest,
): void {
  if (status.repositoryMode !== "root") {
    throw new MutationHttpError(
      "GIT_REPOSITORY_UNAVAILABLE",
      "Git commits require the project root to be a repository",
      409,
    );
  }
  if (status.snapshot !== request.expectedSnapshot) {
    throw new MutationHttpError(
      "GIT_STATUS_CHANGED",
      "Git changes changed before the request completed",
      409,
    );
  }
  const changedPaths = new Set([...status.staged, ...status.unstaged].map((change) => change.path));
  if (request.paths.some((path) => !changedPaths.has(path))) {
    throw new MutationHttpError(
      "GIT_PATH_UNAVAILABLE",
      "A selected file is no longer available",
      409,
    );
  }
}

function readGeneratedCommitMessage(turn: AgentTurn, completedAssistantText?: string): string {
  if (turn.status !== "completed") {
    throw new MutationHttpError(
      "COMMIT_MESSAGE_GENERATION_FAILED",
      turn.error ?? "Commit message generation did not complete",
      502,
      true,
    );
  }
  let assistantText = completedAssistantText;
  for (const item of [...turn.items].reverse()) {
    if (item.type === "message" && item.role === "assistant") {
      assistantText = item.text;
      break;
    }
  }
  if (assistantText === undefined) {
    throw new MutationHttpError(
      "COMMIT_MESSAGE_GENERATION_FAILED",
      "Codex returned no commit message",
      502,
      true,
    );
  }
  try {
    const parsed: unknown = JSON.parse(assistantText);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Object.keys(parsed).length !== 1 ||
      !("message" in parsed) ||
      typeof parsed.message !== "string" ||
      parsed.message.trim().length === 0 ||
      parsed.message.length > 10_000
    ) {
      throw new Error("Invalid structured output");
    }
    return parsed.message.trim();
  } catch {
    throw new MutationHttpError(
      "COMMIT_MESSAGE_GENERATION_FAILED",
      "Codex returned an invalid commit message",
      502,
      true,
    );
  }
}

async function generateCommitMessageWithCodex(
  provider: AgentProvider,
  prompt: string,
  settings: AgentTaskSettings,
): Promise<string> {
  const task = await provider.startTask({ ephemeral: true });
  const completedAssistantMessages = new Map<string, string>();
  let turnId: string | undefined;
  let turnFinished = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let unsubscribeEvents: (() => void) | undefined;
  try {
    const completedTurn = new Promise<AgentTurn>((resolve, reject) => {
      unsubscribeEvents = provider.subscribeEvents((event: AgentProviderEvent) => {
        if (event.taskId !== task.id) {
          return;
        }
        if (
          event.type === "item.completed" &&
          event.payload.item.type === "message" &&
          event.payload.item.role === "assistant"
        ) {
          // App Server 先交付最终 Message Item，终态 Turn 不保证重复携带完整 items。
          completedAssistantMessages.set(event.turnId, event.payload.item.text);
        } else if (event.type === "turn.completed") {
          turnFinished = true;
          resolve(event.payload.turn);
        } else if (event.type === "provider.error" && !event.payload.willRetry) {
          reject(new Error(event.payload.message));
        }
      });
      timeout = setTimeout(() => {
        reject(new Error("Commit message generation timed out"));
      }, COMMIT_MESSAGE_TIMEOUT_MS);
    });
    const startedTurn = await provider.startTurn(
      task.id,
      {
        files: [],
        images: [],
        outputSchema: COMMIT_MESSAGE_OUTPUT_SCHEMA,
        skills: [],
        text: prompt,
        textAttachments: [],
      },
      {
        ...settings,
        approvalPolicy: "never",
        approvalsReviewer: "user",
        sandboxMode: "read-only",
      },
    );
    turnId = startedTurn.id;
    if (startedTurn.status !== "running") {
      turnFinished = true;
      return readGeneratedCommitMessage(startedTurn);
    }
    const turn = await completedTurn;
    return readGeneratedCommitMessage(turn, completedAssistantMessages.get(turn.id));
  } catch (error) {
    if (error instanceof MutationHttpError) {
      throw error;
    }
    throw new MutationHttpError(
      "COMMIT_MESSAGE_GENERATION_FAILED",
      "Codex could not generate a commit message",
      502,
      true,
    );
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
    unsubscribeEvents?.();
    if (!turnFinished && turnId !== undefined) {
      await provider.interruptTurn(task.id, turnId).catch(() => undefined);
    }
    // 临时 Task 不落盘，只需释放事件订阅和运行时所有权。
    await provider.unsubscribeTask(task.id).catch(() => undefined);
  }
}

function toGitCommitHttpError(error: GitCommitError): MutationHttpError {
  const statusCode = error.code === "GIT_COMMIT_FAILED" ? 502 : 409;
  return new MutationHttpError(error.code, error.message, statusCode);
}

export async function createCodeAgentServer(
  options: CreateCodeAgentServerOptions,
): Promise<FastifyInstance> {
  const handlerTimeoutMs = options.handlerTimeoutMs ?? DEFAULT_HANDLER_TIMEOUT_MS;
  const logger =
    options.loggerEnabled === false
      ? false
      : {
          // CLI 运行时只向终端输出警告和错误。
          level: "warn",
          // 即使后续扩展请求 Serializer，也不能让认证字段进入结构化日志。
          redact: {
            censor: "[Redacted]",
            paths: [
              "req.headers.authorization",
              "req.headers.cookie",
              'req.headers["x-api-key"]',
              'res.headers["set-cookie"]',
            ],
          },
          ...(options.logDestination === undefined ? {} : { stream: options.logDestination }),
        };
  const app = Fastify({
    handlerTimeout: 0,
    logController: new CodeAgentLogController(),
    logger,
  });
  app.addHook("onRoute", (routeOptions) => {
    // WebSocket 是显式长连接；普通 HTTP 路由使用 Fastify 原生 request.signal 协作取消。
    if (handlerTimeoutMs > 0 && routeOptions.websocket !== true) {
      routeOptions.handlerTimeout = handlerTimeoutMs;
    }
  });
  const readProjectGitStatus = options.readProjectGitStatus ?? readGitWorkingTreeStatus;
  const commitProjectChanges = options.commitProjectChanges ?? commitSelectedProjectChanges;
  const readFileTree = options.readProjectFileTree ?? readProjectFileTree;
  const readImageFile = options.readProjectImageFile ?? readProjectImageFile;
  const readSourceFile = options.readProjectSourceFile ?? readProjectSourceFile;
  const projectOpenService = options.projectOpenService ?? createProjectOpenService();
  const prepareFileRollback = options.prepareTurnFileRollback ?? prepareTurnFileRollback;
  const attachmentStore = new AttachmentStore();
  const resolveProviderTurnInput = async (
    projectId: string,
    input: AgentPromptInput,
  ): Promise<
    Readonly<{ attachmentIds: readonly string[]; providerInput: AgentProviderTurnInput }>
  > => {
    const attachmentIds = input.attachments.map((attachment) => attachment.id);
    if (new Set(attachmentIds).size !== attachmentIds.length) {
      throw new MutationHttpError("INVALID_REQUEST", "Duplicate attachments are not allowed", 400);
    }
    let resolvedAttachments;
    try {
      resolvedAttachments = await attachmentStore.resolve(projectId, attachmentIds);
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
    // Start 与 steer 共用同一映射，保证附件校验和 Provider 输入语义一致。
    const imageBytes = resolvedAttachments.reduce(
      (total, attachment) => total + (attachment.kind === "image" ? attachment.size : 0),
      0,
    );
    const fileBytes = resolvedAttachments.reduce(
      (total, attachment) => total + (attachment.kind === "image" ? 0 : attachment.size),
      0,
    );
    const imageCount = resolvedAttachments.filter(
      (attachment) => attachment.kind === "image",
    ).length;
    if (imageCount > MAX_AGENT_IMAGES || imageBytes > MAX_AGENT_IMAGE_TOTAL_BYTES) {
      throw new MutationHttpError("INVALID_REQUEST", "Image input limit exceeded", 400);
    }
    if (fileBytes > MAX_AGENT_FILE_TOTAL_BYTES) {
      throw new MutationHttpError("INVALID_REQUEST", "File input limit exceeded", 400);
    }
    return {
      attachmentIds,
      providerInput: {
        files: resolvedAttachments.flatMap((attachment) =>
          attachment.kind === "file"
            ? [
                {
                  mediaType: attachment.mediaType,
                  name: attachment.name,
                  path: attachment.path,
                },
              ]
            : [],
        ),
        images: resolvedAttachments.flatMap((attachment) =>
          attachment.kind === "image"
            ? [{ mediaType: attachment.mediaType, url: attachment.url }]
            : [],
        ),
        skills: input.skills,
        text: input.text,
        textAttachments: resolvedAttachments.flatMap((attachment) =>
          attachment.kind === "text" ? [{ name: attachment.name, text: attachment.text }] : [],
        ),
      },
    };
  };
  const capabilities = await options.provider.getCapabilities();
  const modelCatalogCacheMaxBytes =
    options.modelCatalogCacheMaxBytes ?? DEFAULT_MODEL_CATALOG_CACHE_MAX_BYTES;
  const modelCatalogCacheTtlMs =
    options.modelCatalogCacheTtlMs ?? DEFAULT_MODEL_CATALOG_CACHE_TTL_MS;
  if (!Number.isInteger(modelCatalogCacheMaxBytes) || modelCatalogCacheMaxBytes <= 0) {
    throw new RangeError("Model catalog cache capacity must be a positive integer");
  }
  if (!Number.isFinite(modelCatalogCacheTtlMs) || modelCatalogCacheTtlMs <= 0) {
    throw new RangeError("Model catalog cache TTL must be a positive number");
  }
  const modelCatalogCache = new ModelCatalogCache(() => options.provider.listModels(), {
    maxBytes: modelCatalogCacheMaxBytes,
    ttlMs: modelCatalogCacheTtlMs,
  });
  const projectContexts = new Map<string, ProjectRuntimeContext>();
  const getProjectContext: ProjectContextResolver = async (projectId) => {
    const existing = projectContexts.get(projectId);
    if (existing !== undefined) {
      return existing;
    }
    // 已激活 Runtime 的身份由创建时校验；仅缓存未命中时访问持久层。
    const project = await options.projectRepository.read(projectId);
    if (project === undefined) {
      return undefined;
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
      transportMetrics: { activeClients: 0, slowClientDisconnects: 0 },
      unsubscribe: provider.subscribeEvents((event) => {
        if (event.type === "turn.completed") {
          void attachmentStore
            .releaseTurn(projectId, event.payload.turn.id)
            .catch((error: unknown) => {
              app.log.warn({ error }, "Failed to release turn attachments");
            });
        }
        eventStream.publish(event);
      }),
    };
    projectContexts.set(projectId, context);
    return context;
  };
  const releaseProjectContext = async (projectId: string): Promise<void> => {
    const context = projectContexts.get(projectId);
    if (context !== undefined) {
      // 先断开事件交付，再释放 Provider 与附件，避免销毁期间继续发布 Project 事件。
      context.unsubscribe();
      context.eventStream.close();
      projectContexts.delete(projectId);
    }
    await Promise.all([
      options.provider.releaseProject(projectId),
      attachmentStore.releaseProject(projectId),
    ]);
  };
  const listModels = async (): Promise<readonly AgentModel[]> =>
    (await modelCatalogCache.read()).data;
  const readEffectiveGlobalSettings = async (
    models?: readonly AgentModel[],
  ): Promise<AgentGlobalSettings> => {
    const catalog = models ?? (await listModels());
    const stored = await options.settingsRepository.readGlobalSettings();
    const effectiveModel = resolveProjectDefaults(
      catalog,
      stored,
      stored?.sandboxMode ?? "workspace-write",
    );
    const effectiveCommitModel = resolveProjectDefaults(
      catalog,
      stored === undefined
        ? effectiveModel
        : {
            model: stored.commitMessageModel,
            reasoningEffort: stored.commitMessageReasoningEffort,
            sandboxMode: "read-only",
          },
      "read-only",
    );
    // 全局记录缺失时只返回运行时默认值；读取不能隐式创建用户配置。
    return stored?.approvalsReviewer === "auto_review"
      ? {
          approvalPolicy: "on-request",
          approvalsReviewer: "auto_review",
          commitMessageModel: effectiveCommitModel.model,
          commitMessagePrompt: stored.commitMessagePrompt,
          commitMessageReasoningEffort: effectiveCommitModel.reasoningEffort,
          defaultOpenAppId: stored.defaultOpenAppId,
          followUpBehavior: stored.followUpBehavior,
          ...effectiveModel,
        }
      : {
          approvalPolicy: stored?.approvalPolicy ?? "on-request",
          approvalsReviewer: "user",
          commitMessageModel: effectiveCommitModel.model,
          commitMessagePrompt: stored?.commitMessagePrompt ?? "",
          commitMessageReasoningEffort: effectiveCommitModel.reasoningEffort,
          defaultOpenAppId: stored?.defaultOpenAppId ?? null,
          followUpBehavior: stored?.followUpBehavior ?? "queue",
          ...effectiveModel,
        };
  };
  const readEffectiveProjectDefaults = async (
    projectId: string,
    models?: readonly AgentModel[],
    globalSettings?: AgentGlobalSettings,
  ): Promise<AgentProjectDefaults> => {
    const catalog = models ?? (await listModels());
    const stored = await options.settingsRepository.readProjectDefaults(projectId);
    const inherited = globalSettings ?? (await readEffectiveGlobalSettings(catalog));
    return resolveProjectDefaults(catalog, stored ?? inherited, inherited.sandboxMode);
  };
  const readInheritedTaskSettings = async (
    projectId: string,
    models?: readonly AgentModel[],
  ): Promise<AgentTaskSettings> => {
    const catalog = models ?? (await listModels());
    const globalSettings = await readEffectiveGlobalSettings(catalog);
    const projectDefaults = await readEffectiveProjectDefaults(projectId, catalog, globalSettings);
    return globalSettings.approvalsReviewer === "auto_review"
      ? {
          approvalPolicy: "on-request",
          approvalsReviewer: "auto_review",
          ...projectDefaults,
        }
      : {
          approvalPolicy: globalSettings.approvalPolicy,
          approvalsReviewer: "user",
          ...projectDefaults,
        };
  };
  const readEffectiveTaskSettings = async (
    projectId: string,
    taskId: string,
    models?: readonly AgentModel[],
  ): Promise<AgentTaskSettings> => {
    const catalog = models ?? (await listModels());
    const stored = await options.settingsRepository.readTaskSettings(projectId, taskId);
    if (stored === undefined) {
      return readInheritedTaskSettings(projectId, catalog);
    }
    const effectiveModel = resolveProjectDefaults(catalog, stored, stored.sandboxMode);
    const effective: AgentTaskSettings =
      stored.approvalsReviewer === "auto_review"
        ? {
            approvalPolicy: "on-request",
            approvalsReviewer: "auto_review",
            ...effectiveModel,
          }
        : {
            approvalPolicy: stored.approvalPolicy,
            approvalsReviewer: "user",
            ...effectiveModel,
          };
    return effective;
  };
  // 启动时只为已持久化 Project 建立事件流；后续新增项目在首次注册时懒创建。
  for (const project of await options.projectRepository.list()) {
    await getProjectContext(project.id);
  }
  const idempotencyEntries = new Map<string, IdempotencyEntry>();
  const activeGitMutations = new Set<string>();
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

  const runIdempotent: RunIdempotent = async <T>(
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
  await app.register(fastifyCookie);
  const accessService =
    options.access === undefined ? undefined : new AccessSessionService(options.access);
  app.addHook("onRequest", async (request, reply) => {
    const pathname = request.url.split("?", 1)[0] ?? request.url;
    const websocket = request.headers.upgrade?.toLowerCase() === "websocket";
    const sessionId = request.cookies[ACCESS_SESSION_COOKIE];
    const authenticated =
      options.access === undefined || accessService?.validate(sessionId) === true;
    const anonymous =
      !pathname.startsWith("/v1/") ||
      (request.method === "GET" && (pathname === "/v1/health" || pathname === "/v1/access")) ||
      (request.method === "POST" && pathname === "/v1/access/pair");

    if (!anonymous && !authenticated) {
      return reply
        .code(401)
        .send({ code: "ACCESS_DENIED", message: "Access denied", retryable: false });
    }

    const browserWrite =
      !["GET", "HEAD", "OPTIONS"].includes(request.method) && sessionId !== undefined;
    if (websocket || browserWrite) {
      const origin = request.headers.origin;
      const host = request.headers.host;
      try {
        const parsedOrigin = origin === undefined ? undefined : new URL(origin);
        if (
          parsedOrigin === undefined ||
          host === undefined ||
          (parsedOrigin.protocol !== "http:" && parsedOrigin.protocol !== "https:") ||
          parsedOrigin.host !== host
        ) {
          throw new Error("Origin mismatch");
        }
      } catch {
        return reply
          .code(403)
          .send({ code: "ACCESS_DENIED", message: "Access denied", retryable: false });
      }
    }
  });
  app.addHook("onSend", async (request, reply, payload) => {
    reply.headers({
      "Content-Security-Policy":
        "default-src 'self'; base-uri 'none'; connect-src 'self'; frame-ancestors 'none'; img-src 'self' blob: data:; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'",
      "Permissions-Policy": "camera=(), geolocation=(), microphone=()",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    });
    if (request.url.startsWith("/v1/")) {
      reply.header("Cache-Control", "no-store");
    }
    return payload;
  });
  await app.register(fastifyMultipart, {
    limits: { fields: 0, files: 1, fileSize: MAX_AGENT_FILE_BYTES, parts: 1 },
  });
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
      const accessMutation =
        request.routeOptions.url === "/v1/access/pair" ||
        request.routeOptions.url === "/v1/access/logout";
      const missingKey =
        !accessMutation &&
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
  app.addHook("onClose", async () => {
    // Access 内存必须先随 Server 生命周期失效，重启不能恢复 Session。
    accessService?.close();
    await Promise.all([...projectContexts.keys()].map(releaseProjectContext));
    await attachmentStore.dispose();
    activeGitMutations.clear();
    idempotencyEntries.clear();
    modelCatalogCache.clear();
    taskStartRecoveries.clear();
  });

  const { staticRoot } = options;
  if (staticRoot !== undefined) {
    // 压缩插件必须先于静态插件注册，确保静态文件流进入响应压缩钩子。
    await app.register(fastifyCompress, {
      encodings: ["br", "gzip"],
      globalDecompression: false,
    });
    await app.register(fastifyStatic, {
      cacheControl: false,
      root: staticRoot,
      setHeaders: (response, filePath) => {
        const [topLevelDirectory] = relative(staticRoot, filePath).split(sep);
        // Vite 的 assets 目录使用内容哈希命名，可安全长期缓存；HTML 等入口继续重新验证。
        response.setHeader(
          "Cache-Control",
          topLevelDirectory === "assets"
            ? "public, max-age=31536000, immutable"
            : "public, max-age=0",
        );
      },
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

  const routeContext: ServerRouteContext = {
    ...(accessService === undefined ? {} : { accessService }),
    activeGitMutations,
    assertCommitSelection,
    assertValidProjectDefaults,
    attachmentStore,
    buildCommitMessagePrompt,
    capabilities,
    commitProjectChanges,
    fingerprintPayload,
    generateCommitMessageWithCodex,
    getProjectContext,
    idempotencyCacheSize,
    listModels,
    maximumAttachmentBytes,
    modelCatalogCache,
    multipartEnvelopeBytes: MULTIPART_ENVELOPE_BYTES,
    prepareFileRollback,
    projectContexts,
    projectOpenService,
    projectRepository: options.projectRepository,
    provider: options.provider,
    readEffectiveGlobalSettings,
    readEffectiveProjectDefaults,
    readEffectiveTaskSettings,
    readFileTree,
    readImageFile,
    readInheritedTaskSettings,
    readProjectGitStatus,
    readSourceFile,
    releaseProjectContext,
    resolveProviderTurnInput,
    runIdempotent,
    selectProjectDirectory: options.selectProjectDirectory,
    settingsRepository: options.settingsRepository,
    taskFromSnapshot,
    taskStartRecoveries,
    toGitCommitHttpError,
    toPendingRequestHttpError,
  };
  await app.register(registerAccessRoutes, {
    ...(options.access === undefined ? {} : { access: options.access }),
    ...(accessService === undefined ? {} : { service: accessService }),
  });
  await app.register(registerRuntimeRoutes, routeContext);
  await app.register(registerProjectRoutes, routeContext);
  await app.register(registerTaskRoutes, routeContext);
  await app.register(registerTurnRoutes, routeContext);
  await app.register(registerEventRoutes, routeContext);
  await app.ready();
  return app;
}
