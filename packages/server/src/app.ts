import { randomUUID } from "node:crypto";
import type { AgentProviderTurnInput } from "@code-agent/core";
import {
  MAX_AGENT_FILE_TOTAL_BYTES,
  MAX_AGENT_IMAGES,
  MAX_AGENT_IMAGE_TOTAL_BYTES,
  BrowserSessionResponseSchema,
  type AgentGlobalSettings,
  type AgentModel,
  type AgentPromptInput,
  type AgentProjectDefaults,
  type AgentTaskSettings,
} from "@code-agent/protocol";
import Fastify, { type FastifyInstance } from "fastify";
import { AgentEventStream } from "./agent-event-stream.js";
import { AttachmentNotFoundError, AttachmentStore } from "./attachment-store.js";
import { commitSelectedProjectChanges } from "./git-commit.js";
import { buildCommitMessagePrompt } from "./git-commit-message.js";
import { readGitWorkingTreeStatus } from "./git-working-tree.js";
import { readHostFileDirectory, resolveHostAttachment } from "./host-file-browser.js";
import { readProjectFileTree } from "./project-file-tree.js";
import { readProjectImageFile } from "./project-image-file.js";
import { readProjectSourceFile } from "./project-source-file.js";
import { createProjectOpenService } from "./project-open.js";
import { readProjectDirectory, resolveProjectDirectory } from "./project-directory-browser.js";
import { prepareTurnFileRollback } from "./turn-file-rollback.js";
import {
  MutationHttpError,
  type ProjectContextResolver,
  type ProjectRuntimeContext,
  type RunIdempotent,
  type ServerRouteContext,
  type TaskStartRecovery,
} from "./routes/context.js";
import { registerEventRoutes } from "./routes/event-routes.js";
import { registerAccessRoutes } from "./routes/access-routes.js";
import { registerProjectRoutes } from "./routes/project-routes.js";
import { registerRuntimeRoutes } from "./routes/runtime-routes.js";
import { registerTaskRoutes } from "./routes/task-routes.js";
import { registerTurnRoutes } from "./routes/turn-routes.js";

import { configureServerDelivery } from "./server-delivery.js";
import type { CreateCodeAgentServerOptions } from "./server-options.js";
import {
  DEFAULT_HANDLER_TIMEOUT_MS,
  DEFAULT_IDEMPOTENCY_CACHE_SIZE,
  DEFAULT_IDEMPOTENCY_TTL_MS,
  DEFAULT_MODEL_CATALOG_CACHE_MAX_BYTES,
  DEFAULT_MODEL_CATALOG_CACHE_TTL_MS,
  MULTIPART_ENVELOPE_BYTES,
  CodeAgentLogController,
  ModelCatalogCache,
  assertCommitSelection,
  assertValidProjectDefaults,
  fingerprintPayload,
  generateCommitMessageWithCodex,
  maximumAttachmentBytes,
  resolveProjectDefaults,
  taskFromSnapshot,
  toGitCommitHttpError,
  toPendingRequestHttpError,
  type IdempotencyEntry,
} from "./server-runtime.js";

export type { CreateCodeAgentServerOptions } from "./server-options.js";

export async function createCodeAgentServer(
  options: CreateCodeAgentServerOptions,
): Promise<FastifyInstance> {
  const browserSessionId = randomUUID();
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
      routeOptions.handlerTimeout ??= handlerTimeoutMs;
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

  const accessService = await configureServerDelivery(app, {
    ...(options.access === undefined ? {} : { access: options.access }),
    releaseResources: async () => {
      await Promise.all([...projectContexts.keys()].map(releaseProjectContext));
      await attachmentStore.dispose();
      activeGitMutations.clear();
      idempotencyEntries.clear();
      modelCatalogCache.clear();
      taskStartRecoveries.clear();
    },
    ...(options.staticRoot === undefined ? {} : { staticRoot: options.staticRoot }),
  });

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
    installAppUpdate: options.installAppUpdate,
    listModels,
    maximumAttachmentBytes,
    modelCatalogCache,
    multipartEnvelopeBytes: MULTIPART_ENVELOPE_BYTES,
    prepareFileRollback,
    projectContexts,
    projectOpenService,
    projectRepository: options.projectRepository,
    provider: options.provider,
    readAppInfo: options.readAppInfo,
    readEffectiveGlobalSettings,
    readEffectiveProjectDefaults,
    readEffectiveTaskSettings,
    readFileTree,
    readHostFileDirectory: options.readHostFileDirectory ?? readHostFileDirectory,
    readProjectDirectory: options.readProjectDirectory ?? readProjectDirectory,
    readImageFile,
    readInheritedTaskSettings,
    readProjectGitStatus,
    readSourceFile,
    releaseProjectContext,
    resolveProviderTurnInput,
    runIdempotent,
    resolveProjectDirectory: options.resolveProjectDirectory ?? resolveProjectDirectory,
    resolveHostAttachment: options.resolveHostAttachment ?? resolveHostAttachment,
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
  app.get(
    "/v1/browser-session",
    { schema: { response: { 200: BrowserSessionResponseSchema } } },
    () => {
      // 页面轮询既用于报告旧标签存在，也用于识别服务是否已重新启动。
      options.onBrowserConnection?.();
      return { instanceId: browserSessionId, version: 1 as const };
    },
  );
  await app.register(registerRuntimeRoutes, routeContext);
  await app.register(registerProjectRoutes, routeContext);
  await app.register(registerTaskRoutes, routeContext);
  await app.register(registerTurnRoutes, routeContext);
  await app.register(registerEventRoutes, routeContext);
  await app.ready();
  return app;
}
