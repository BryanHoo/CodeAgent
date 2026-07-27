import {
  AgentCapabilitiesSchema,
  AddProjectResponseSchema,
  ArchiveAgentTaskResponseSchema,
  CompactAgentTaskResponseSchema,
  ForkAgentTaskResponseSchema,
  AgentAttachmentUploadResponseSchema,
  AgentModelPageSchema,
  AgentMutationErrorSchema,
  AgentProjectDefaultsResponseSchema,
  InterruptAgentTurnResponseSchema,
  AgentTaskPageSchema,
  AgentTaskSnapshotResponseSchema,
  AgentTaskSettingsResponseSchema,
  HealthResponseSchema,
  ProjectPageSchema,
  ProjectGitStatusSchema,
  ProjectSourceFileSchema,
  PinAgentTaskResponseSchema,
  ReviewAgentTaskResponseSchema,
  RenameAgentTaskResponseSchema,
  RollbackAgentTurnResponseSchema,
  ResolvePendingRequestResponseSchema,
  StartAgentTaskResponseSchema,
  StartAgentTurnResponseSchema,
  UploadAgentFeedbackResponseSchema,
  type AgentCapabilities,
  type AddProjectResponse,
  type ArchiveAgentTaskResponse,
  type CompactAgentTaskResponse,
  type ForkAgentTaskResponse,
  type AgentAttachmentUploadRequest,
  type AgentAttachmentUploadResponse,
  type AgentMutationError,
  type AgentTaskPage,
  type AgentModelPage,
  type AgentPromptInput,
  type AgentProjectDefaults,
  type AgentProjectDefaultsResponse,
  type AgentTurnOptions,
  type AgentTaskSnapshotResponse,
  type AgentTaskSettings,
  type AgentTaskSettingsResponse,
  type HealthResponse,
  type InterruptAgentTurnResponse,
  type ProjectPage,
  type ProjectGitStatus,
  type ProjectSourceFile,
  type PinAgentTaskResponse,
  type ReviewAgentTaskRequest,
  type ReviewAgentTaskResponse,
  type RenameAgentTaskResponse,
  type RollbackAgentTurnResponse,
  type PendingRequest,
  type ResolvePendingRequestRequest,
  type ResolvePendingRequestResponse,
  type StartAgentTaskResponse,
  type StartAgentTurnResponse,
  type UploadAgentFeedbackRequest,
  type UploadAgentFeedbackResponse,
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
  webSocketFactory?: WebSocketFactory;
}

export type ListTasksOptions = Readonly<{
  cursor?: string;
  limit?: number;
}>;

export type MutationOptions = Readonly<{
  idempotencyKey?: string;
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

export class CodeAgentClient {
  readonly #baseUrl: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #webSocketFactory: WebSocketFactory;

  public constructor(options: CodeAgentClientOptions = {}) {
    this.#baseUrl = options.baseUrl?.replace(/\/$/u, "") ?? "";
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#webSocketFactory = options.webSocketFactory ?? ((url) => new WebSocket(url));
  }

  public async getHealth(): Promise<HealthResponse> {
    return this.#request("/v1/health", HealthResponseSchema);
  }

  public async getCapabilities(): Promise<AgentCapabilities> {
    return this.#request("/v1/capabilities", AgentCapabilitiesSchema);
  }

  public async listModels(): Promise<AgentModelPage> {
    return this.#request("/v1/models", AgentModelPageSchema);
  }

  public async listProjects(): Promise<ProjectPage> {
    return this.#request("/v1/projects", ProjectPageSchema);
  }

  public async getProjectDefaults(projectId: string): Promise<AgentProjectDefaultsResponse> {
    return this.#request(`${projectPath(projectId)}/defaults`, AgentProjectDefaultsResponseSchema);
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

  public async getProjectGitStatus(projectId: string): Promise<ProjectGitStatus> {
    return this.#request(
      `/v1/projects/${encodeURIComponent(projectId)}/git/status`,
      ProjectGitStatusSchema,
    );
  }

  public async readProjectSourceFile(projectId: string, path: string): Promise<ProjectSourceFile> {
    const requestPath = appendQuery(`/v1/projects/${encodeURIComponent(projectId)}/files/source`, {
      path,
    });
    return this.#request(requestPath, ProjectSourceFileSchema);
  }

  public async listTasks(
    projectId: string,
    options: ListTasksOptions = {},
  ): Promise<AgentTaskPage> {
    const path = appendQuery(`/v1/projects/${encodeURIComponent(projectId)}/tasks`, options);
    return this.#request(path, AgentTaskPageSchema);
  }

  public async readTask(projectId: string, taskId: string): Promise<AgentTaskSnapshotResponse> {
    return this.#request(taskPath(projectId, taskId), AgentTaskSnapshotResponseSchema);
  }

  public async getTaskSettings(
    projectId: string,
    taskId: string,
  ): Promise<AgentTaskSettingsResponse> {
    return this.#request(
      `${taskPath(projectId, taskId)}/settings`,
      AgentTaskSettingsResponseSchema,
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
    );
  }

  async #request<T extends TSchema>(
    path: string,
    schema: T,
    init: RequestInit = {},
    errorSchema?: TSchema,
  ): Promise<Static<T>> {
    const response = await this.#fetch(`${this.#baseUrl}${path}`, {
      ...init,
      headers: { accept: "application/json", ...(init.headers as Record<string, string>) },
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
