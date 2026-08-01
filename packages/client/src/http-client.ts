import {
  AgentCapabilitiesSchema,
  AgentBackgroundTerminalPageSchema,
  AddProjectResponseSchema,
  ArchiveAgentTaskResponseSchema,
  CompactAgentTaskResponseSchema,
  ForkAgentTaskResponseSchema,
  AgentAttachmentUploadResponseSchema,
  AgentGlobalSettingsResponseSchema,
  AgentModelPageSchema,
  AgentMutationErrorSchema,
  AgentProjectDefaultsResponseSchema,
  AgentSkillPageSchema,
  InterruptAgentTurnResponseSchema,
  AgentTaskPageSchema,
  AgentTaskSnapshotResponseSchema,
  AgentTaskSettingsResponseSchema,
  HealthResponseSchema,
  ProjectPageSchema,
  ProjectFileTreeSchema,
  ProjectOpenCapabilitiesResponseSchema,
  ReorderProjectsResponseSchema,
  ProjectGitStatusSchema,
  ProjectSourceFileSchema,
  OpenProjectResponseSchema,
  PinAgentTaskResponseSchema,
  ReviewAgentTaskResponseSchema,
  RenameAgentTaskResponseSchema,
  RenameProjectResponseSchema,
  RemoveProjectResponseSchema,
  RollbackAgentTurnResponseSchema,
  ResolvePendingRequestResponseSchema,
  StartAgentTaskResponseSchema,
  StartAgentTurnResponseSchema,
  TerminateAgentBackgroundTerminalResponseSchema,
  UploadAgentFeedbackResponseSchema,
  UnsubscribeAgentTaskResponseSchema,
  type AgentCapabilities,
  type AgentBackgroundTerminalPage,
  type AddProjectResponse,
  type ArchiveAgentTaskResponse,
  type CompactAgentTaskResponse,
  type ForkAgentTaskResponse,
  type AgentAttachmentUploadRequest,
  type AgentAttachmentUploadResponse,
  type AgentMutationError,
  type AgentGlobalSettings,
  type AgentGlobalSettingsResponse,
  type AgentTaskPage,
  type AgentModelPage,
  type AgentPromptInput,
  type AgentProjectDefaults,
  type AgentProjectDefaultsResponse,
  type AgentSkillPage,
  type AgentTurnOptions,
  type AgentTaskSnapshotResponse,
  type AgentTaskSettings,
  type AgentTaskSettingsResponse,
  type HealthResponse,
  type InterruptAgentTurnResponse,
  type ProjectPage,
  type ProjectFileTree,
  type ProjectOpenCapabilitiesResponse,
  type ReorderProjectsResponse,
  type ProjectGitStatus,
  type ProjectSourceFile,
  type OpenProjectRequest,
  type OpenProjectResponse,
  type PinAgentTaskResponse,
  type ReviewAgentTaskRequest,
  type ReviewAgentTaskResponse,
  type RenameAgentTaskResponse,
  type RenameProjectResponse,
  type RemoveProjectResponse,
  type RollbackAgentTurnResponse,
  type PendingRequest,
  type ResolvePendingRequestRequest,
  type ResolvePendingRequestResponse,
  type StartAgentTaskResponse,
  type StartAgentTurnResponse,
  type UploadAgentFeedbackRequest,
  type UploadAgentFeedbackResponse,
  type UnsubscribeAgentTaskResponse,
  type TerminateAgentBackgroundTerminalResponse,
} from "@code-agent/protocol";
import type { Static, TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

import {
  startAgentEventSubscription,
  type SubscribeAgentEventsOptions,
  type WebSocketFactory,
} from "./event-client.js";

export interface CodeAgentClientOptions {
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  requestTimeouts?: Partial<CodeAgentRequestTimeouts>;
  webSocketFactory?: WebSocketFactory;
}

export type CodeAgentRequestTimeouts = Readonly<{
  mutationMs: number;
  queryMs: number;
  readMs: number;
}>;

export type ReadOptions = Readonly<{
  signal?: AbortSignal;
}>;

export type ListTasksOptions = Readonly<{
  cursor?: string;
  limit?: number;
}>;

export type MutationOptions = Readonly<{
  idempotencyKey?: string;
  signal?: AbortSignal;
}>;

export type PendingRequestResolution<T extends PendingRequest> = Extract<
  ResolvePendingRequestRequest,
  { type: T["type"] }
>["resolution"];

export class CodeAgentHttpError extends Error {
  public readonly status: number;

  public constructor(status: number, statusText: string, message?: string) {
    super(message ?? `CodeAgent request failed with ${String(status)} ${statusText}`.trim());
    this.name = "CodeAgentHttpError";
    this.status = status;
  }
}

export class CodeAgentMutationError extends CodeAgentHttpError {
  public readonly code: AgentMutationError["code"];
  public readonly retryable: boolean;

  public constructor(status: number, statusText: string, error: AgentMutationError) {
    super(status, statusText, error.message);
    this.name = "CodeAgentMutationError";
    this.code = error.code;
    this.retryable = error.retryable;
  }
}

export class CodeAgentResponseError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CodeAgentResponseError";
  }
}

function appendQuery(path: string, values: Readonly<Record<string, string | number | undefined>>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) {
      query.set(key, String(value));
    }
  }
  const encoded = query.toString();
  return encoded ? `${path}?${encoded}` : path;
}

function projectPath(projectId: string): string {
  return `/v1/projects/${encodeURIComponent(projectId)}`;
}

function taskPath(projectId: string, taskId: string): string {
  return `${projectPath(projectId)}/tasks/${encodeURIComponent(taskId)}`;
}

export function buildTaskAttachmentUrl(
  baseUrl: string,
  projectId: string,
  taskId: string,
  attachmentId: string,
): string {
  return `${baseUrl.replace(/\/$/u, "")}${taskPath(projectId, taskId)}/attachments/${encodeURIComponent(attachmentId)}`;
}

export class CodeAgentClient {
  readonly #baseUrl: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #requestTimeouts: CodeAgentRequestTimeouts;
  readonly #webSocketFactory: WebSocketFactory;

  public constructor(options: CodeAgentClientOptions = {}) {
    this.#baseUrl = options.baseUrl?.replace(/\/$/u, "") ?? "";
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#requestTimeouts = {
      mutationMs: options.requestTimeouts?.mutationMs ?? 60_000,
      queryMs: options.requestTimeouts?.queryMs ?? 30_000,
      readMs: options.requestTimeouts?.readMs ?? 15_000,
    };
    this.#webSocketFactory = options.webSocketFactory ?? ((url) => new WebSocket(url));
  }

  public async getHealth(options: ReadOptions = {}): Promise<HealthResponse> {
    return this.#read("/v1/health", HealthResponseSchema, options);
  }

  public async getCapabilities(options: ReadOptions = {}): Promise<AgentCapabilities> {
    return this.#read("/v1/capabilities", AgentCapabilitiesSchema, options);
  }

  public async listModels(options: ReadOptions = {}): Promise<AgentModelPage> {
    return this.#read("/v1/models", AgentModelPageSchema, options);
  }

  public async getGlobalSettings(options: ReadOptions = {}): Promise<AgentGlobalSettingsResponse> {
    return this.#read("/v1/settings", AgentGlobalSettingsResponseSchema, options);
  }

  public async updateGlobalSettings(
    settings: AgentGlobalSettings,
    options: MutationOptions = {},
  ): Promise<AgentGlobalSettingsResponse> {
    return this.#mutation(
      "/v1/settings",
      settings,
      AgentGlobalSettingsResponseSchema,
      options,
      "PUT",
    );
  }

  public async listSkills(projectId: string, options: ReadOptions = {}): Promise<AgentSkillPage> {
    return this.#read(`${projectPath(projectId)}/skills`, AgentSkillPageSchema, options);
  }

  public async listProjects(options: ReadOptions = {}): Promise<ProjectPage> {
    return this.#read("/v1/projects", ProjectPageSchema, options);
  }

  public async reorderProjects(
    projectIds: readonly string[],
    options: MutationOptions = {},
  ): Promise<ReorderProjectsResponse> {
    return this.#mutation(
      "/v1/projects/order",
      { projectIds },
      ReorderProjectsResponseSchema,
      options,
      "PUT",
    );
  }

  public async getProjectDefaults(
    projectId: string,
    options: ReadOptions = {},
  ): Promise<AgentProjectDefaultsResponse> {
    return this.#read(
      `${projectPath(projectId)}/defaults`,
      AgentProjectDefaultsResponseSchema,
      options,
    );
  }

  public async updateProjectDefaults(
    projectId: string,
    settings: AgentProjectDefaults,
    options: MutationOptions = {},
  ): Promise<AgentProjectDefaultsResponse> {
    return this.#mutation(
      `${projectPath(projectId)}/defaults`,
      settings,
      AgentProjectDefaultsResponseSchema,
      options,
      "PUT",
    );
  }

  public async addProject(options: MutationOptions = {}): Promise<AddProjectResponse> {
    return this.#mutation("/v1/projects", {}, AddProjectResponseSchema, options);
  }

  public async renameProject(
    projectId: string,
    name: string,
    options: MutationOptions = {},
  ): Promise<RenameProjectResponse> {
    return this.#mutation(
      `${projectPath(projectId)}/rename`,
      { name },
      RenameProjectResponseSchema,
      options,
    );
  }

  public async removeProject(
    projectId: string,
    options: MutationOptions = {},
  ): Promise<RemoveProjectResponse> {
    return this.#mutation(
      `${projectPath(projectId)}/remove`,
      {},
      RemoveProjectResponseSchema,
      options,
    );
  }

  public async getProjectOpenCapabilities(
    projectId: string,
    options: ReadOptions = {},
  ): Promise<ProjectOpenCapabilitiesResponse> {
    return this.#read(
      `${projectPath(projectId)}/open-capabilities`,
      ProjectOpenCapabilitiesResponseSchema,
      options,
    );
  }

  public async openProject(
    projectId: string,
    request: OpenProjectRequest,
    options: MutationOptions = {},
  ): Promise<OpenProjectResponse> {
    return this.#mutation(
      `${projectPath(projectId)}/open`,
      request,
      OpenProjectResponseSchema,
      options,
    );
  }

  public async getProjectGitStatus(
    projectId: string,
    options: ReadOptions = {},
  ): Promise<ProjectGitStatus> {
    return this.#read(
      `/v1/projects/${encodeURIComponent(projectId)}/git/status`,
      ProjectGitStatusSchema,
      options,
    );
  }

  public async listProjectFiles(
    projectId: string,
    directoryPath: string | null,
    options: ReadOptions = {},
  ): Promise<ProjectFileTree> {
    const requestPath = appendQuery(`/v1/projects/${encodeURIComponent(projectId)}/files/tree`, {
      path: directoryPath ?? undefined,
    });
    return this.#read(requestPath, ProjectFileTreeSchema, options);
  }

  public async readProjectSourceFile(
    projectId: string,
    path: string,
    options: ReadOptions = {},
  ): Promise<ProjectSourceFile> {
    const requestPath = appendQuery(`/v1/projects/${encodeURIComponent(projectId)}/files/source`, {
      path,
    });
    return this.#read(requestPath, ProjectSourceFileSchema, options);
  }

  public async listTasks(
    projectId: string,
    options: ListTasksOptions = {},
    requestOptions: ReadOptions = {},
  ): Promise<AgentTaskPage> {
    const path = appendQuery(`/v1/projects/${encodeURIComponent(projectId)}/tasks`, options);
    return this.#read(path, AgentTaskPageSchema, requestOptions);
  }

  public async readTask(
    projectId: string,
    taskId: string,
    options: ReadOptions = {},
  ): Promise<AgentTaskSnapshotResponse> {
    return this.#read(taskPath(projectId, taskId), AgentTaskSnapshotResponseSchema, options);
  }

  public getTaskAttachmentUrl(projectId: string, taskId: string, attachmentId: string): string {
    return buildTaskAttachmentUrl(this.#baseUrl, projectId, taskId, attachmentId);
  }

  public async listBackgroundTerminals(
    projectId: string,
    taskId: string,
    options: ReadOptions = {},
  ): Promise<AgentBackgroundTerminalPage> {
    return this.#read(
      `${taskPath(projectId, taskId)}/background-terminals`,
      AgentBackgroundTerminalPageSchema,
      options,
    );
  }

  public async terminateBackgroundTerminal(
    projectId: string,
    taskId: string,
    terminalId: string,
    options: MutationOptions = {},
  ): Promise<TerminateAgentBackgroundTerminalResponse> {
    return this.#mutation(
      `${taskPath(projectId, taskId)}/background-terminals/${encodeURIComponent(terminalId)}/terminate`,
      {},
      TerminateAgentBackgroundTerminalResponseSchema,
      options,
    );
  }

  public async getTaskSettings(
    projectId: string,
    taskId: string,
    options: ReadOptions = {},
  ): Promise<AgentTaskSettingsResponse> {
    return this.#read(
      `${taskPath(projectId, taskId)}/settings`,
      AgentTaskSettingsResponseSchema,
      options,
    );
  }

  public async updateTaskSettings(
    projectId: string,
    taskId: string,
    settings: AgentTaskSettings,
    options: MutationOptions = {},
  ): Promise<AgentTaskSettingsResponse> {
    return this.#mutation(
      `${taskPath(projectId, taskId)}/settings`,
      settings,
      AgentTaskSettingsResponseSchema,
      options,
      "PUT",
    );
  }

  public async startTask(
    projectId: string,
    options: MutationOptions = {},
  ): Promise<StartAgentTaskResponse> {
    return this.#mutation(
      `/v1/projects/${encodeURIComponent(projectId)}/tasks`,
      {},
      StartAgentTaskResponseSchema,
      options,
    );
  }

  public async pinTask(
    projectId: string,
    taskId: string,
    pinned: boolean,
    options: MutationOptions = {},
  ): Promise<PinAgentTaskResponse> {
    return this.#mutation(
      `${taskPath(projectId, taskId)}/pin`,
      { pinned },
      PinAgentTaskResponseSchema,
      options,
      "PUT",
    );
  }

  public async renameTask(
    projectId: string,
    taskId: string,
    title: string,
    options: MutationOptions = {},
  ): Promise<RenameAgentTaskResponse> {
    return this.#mutation(
      `${taskPath(projectId, taskId)}/rename`,
      { title },
      RenameAgentTaskResponseSchema,
      options,
    );
  }

  public async archiveTask(
    projectId: string,
    taskId: string,
    options: MutationOptions = {},
  ): Promise<ArchiveAgentTaskResponse> {
    return this.#mutation(
      `${taskPath(projectId, taskId)}/archive`,
      {},
      ArchiveAgentTaskResponseSchema,
      options,
    );
  }

  public async unsubscribeTask(
    projectId: string,
    taskId: string,
  ): Promise<UnsubscribeAgentTaskResponse> {
    return this.#request(
      `${taskPath(projectId, taskId)}/unsubscribe`,
      UnsubscribeAgentTaskResponseSchema,
      { body: "{}", headers: { "content-type": "application/json" }, method: "POST" },
    );
  }

  public async startReview(
    projectId: string,
    taskId: string,
    input: ReviewAgentTaskRequest,
    options: MutationOptions = {},
  ): Promise<ReviewAgentTaskResponse> {
    return this.#mutation(
      `${taskPath(projectId, taskId)}/review`,
      input,
      ReviewAgentTaskResponseSchema,
      options,
    );
  }

  public async compactTask(
    projectId: string,
    taskId: string,
    options: MutationOptions = {},
  ): Promise<CompactAgentTaskResponse> {
    return this.#mutation(
      `${taskPath(projectId, taskId)}/compact`,
      {},
      CompactAgentTaskResponseSchema,
      options,
    );
  }

  public async forkTask(
    projectId: string,
    taskId: string,
    options: MutationOptions = {},
  ): Promise<ForkAgentTaskResponse> {
    return this.#mutation(
      `${taskPath(projectId, taskId)}/fork`,
      {},
      ForkAgentTaskResponseSchema,
      options,
    );
  }

  public async uploadFeedback(
    projectId: string,
    taskId: string,
    input: UploadAgentFeedbackRequest,
    options: MutationOptions = {},
  ): Promise<UploadAgentFeedbackResponse> {
    return this.#mutation(
      `${taskPath(projectId, taskId)}/feedback`,
      input,
      UploadAgentFeedbackResponseSchema,
      options,
    );
  }

  public async uploadAttachment(
    projectId: string,
    input: AgentAttachmentUploadRequest,
    options: MutationOptions = {},
  ): Promise<AgentAttachmentUploadResponse> {
    return this.#mutation(
      `${projectPath(projectId)}/attachments`,
      input,
      AgentAttachmentUploadResponseSchema,
      options,
    );
  }

  public async startTurn(
    projectId: string,
    taskId: string,
    input: AgentPromptInput,
    turnOptions: AgentTurnOptions,
    options: MutationOptions = {},
  ): Promise<StartAgentTurnResponse> {
    return this.#mutation(
      `${taskPath(projectId, taskId)}/turns`,
      { input, options: turnOptions },
      StartAgentTurnResponseSchema,
      options,
    );
  }

  public async interruptTurn(
    projectId: string,
    taskId: string,
    turnId: string,
    options: MutationOptions = {},
  ): Promise<InterruptAgentTurnResponse> {
    return this.#mutation(
      `${taskPath(projectId, taskId)}/turns/${encodeURIComponent(turnId)}/interrupt`,
      { taskId },
      InterruptAgentTurnResponseSchema,
      options,
    );
  }

  public async rollbackTurn(
    projectId: string,
    taskId: string,
    turnId: string,
    options: MutationOptions = {},
  ): Promise<RollbackAgentTurnResponse> {
    return this.#mutation(
      `${taskPath(projectId, taskId)}/turns/${encodeURIComponent(turnId)}/rollback`,
      { taskId },
      RollbackAgentTurnResponseSchema,
      options,
    );
  }

  public async resolvePendingRequest<T extends PendingRequest>(
    request: T,
    resolution: PendingRequestResolution<T>,
    options: MutationOptions = {},
  ): Promise<ResolvePendingRequestResponse> {
    const body = {
      itemId: request.itemId,
      projectId: request.projectId,
      resolution,
      taskId: request.taskId,
      turnId: request.turnId,
      type: request.type,
    } as ResolvePendingRequestRequest;
    return this.#mutation(
      `${taskPath(request.projectId, request.taskId)}/pending-requests/${encodeURIComponent(request.requestId)}/resolve`,
      body,
      ResolvePendingRequestResponseSchema,
      options,
    );
  }

  public subscribeEvents(options: SubscribeAgentEventsOptions): () => void {
    return startAgentEventSubscription({
      ...options,
      baseUrl: this.#baseUrl,
      webSocketFactory: this.#webSocketFactory,
    });
  }

  #mutation<T extends TSchema>(
    path: string,
    body: unknown,
    schema: T,
    options: MutationOptions,
    method: "POST" | "PUT" = "POST",
  ): Promise<Static<T>> {
    return this.#request(
      path,
      schema,
      {
        body: JSON.stringify(body),
        headers: {
          "content-type": "application/json",
          "idempotency-key": options.idempotencyKey ?? globalThis.crypto.randomUUID(),
        },
        method,
      },
      AgentMutationErrorSchema,
      {
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        timeoutMs: this.#requestTimeouts.mutationMs,
      },
    );
  }

  #read<T extends TSchema>(path: string, schema: T, options: ReadOptions): Promise<Static<T>> {
    return this.#request(path, schema, {}, undefined, {
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      timeoutMs:
        options.signal === undefined ? this.#requestTimeouts.readMs : this.#requestTimeouts.queryMs,
    });
  }

  async #request<T extends TSchema>(
    path: string,
    schema: T,
    init: RequestInit = {},
    errorSchema?: TSchema,
    requestOptions: Readonly<{ signal?: AbortSignal; timeoutMs?: number }> = {},
  ): Promise<Static<T>> {
    // Query 取消与本地截止时间必须共同生效，避免旧响应继续下载、校验并写入缓存。
    const timeoutSignal = AbortSignal.timeout(
      requestOptions.timeoutMs ?? this.#requestTimeouts.readMs,
    );
    const signal =
      requestOptions.signal === undefined
        ? timeoutSignal
        : AbortSignal.any([requestOptions.signal, timeoutSignal]);
    const response = await this.#fetch(`${this.#baseUrl}${path}`, {
      ...init,
      headers: { accept: "application/json", ...(init.headers as Record<string, string>) },
      signal,
    });
    if (!response.ok) {
      if (errorSchema !== undefined) {
        let errorBody: unknown;
        try {
          errorBody = await response.json();
        } catch (error) {
          throw new CodeAgentResponseError("CodeAgent error response is not valid JSON", {
            cause: error,
          });
        }
        // Mutation 错误也必须通过 Protocol Schema 后才能进入页面状态。
        if (!Value.Check(errorSchema, errorBody)) {
          throw new CodeAgentResponseError(
            "CodeAgent error response does not match the protocol schema",
          );
        }
        throw new CodeAgentMutationError(
          response.status,
          response.statusText,
          errorBody as AgentMutationError,
        );
      }
      throw new CodeAgentHttpError(response.status, response.statusText);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      throw new CodeAgentResponseError("CodeAgent response is not valid JSON", { cause: error });
    }
    // 只有通过 Protocol Schema 的 unknown 响应才能进入 React Query 与页面状态。
    if (!Value.Check(schema, body)) {
      throw new CodeAgentResponseError("CodeAgent response does not match the protocol schema");
    }
    return body;
  }
}
