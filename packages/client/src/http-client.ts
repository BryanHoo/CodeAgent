import {
  AgentCapabilitiesSchema,
  AgentAttachmentUploadResponseSchema,
  AgentModelPageSchema,
  AgentMutationErrorSchema,
  InterruptAgentTurnResponseSchema,
  AgentTaskPageSchema,
  AgentTaskSnapshotResponseSchema,
  HealthResponseSchema,
  ProjectPageSchema,
  ProjectGitStatusSchema,
  ProjectSourceFileSchema,
  RollbackAgentTurnResponseSchema,
  ResolvePendingRequestResponseSchema,
  StartAgentTaskResponseSchema,
  StartAgentTurnResponseSchema,
  type AgentCapabilities,
  type AgentAttachmentUploadRequest,
  type AgentAttachmentUploadResponse,
  type AgentMutationError,
  type AgentTaskPage,
  type AgentModelPage,
  type AgentPromptInput,
  type AgentTurnOptions,
  type AgentTaskSnapshotResponse,
  type HealthResponse,
  type InterruptAgentTurnResponse,
  type ProjectPage,
  type ProjectGitStatus,
  type ProjectSourceFile,
  type RollbackAgentTurnResponse,
  type PendingRequest,
  type ResolvePendingRequestRequest,
  type ResolvePendingRequestResponse,
  type StartAgentTaskResponse,
  type StartAgentTurnResponse,
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

  public async readTask(taskId: string): Promise<AgentTaskSnapshotResponse> {
    return this.#request(
      `/v1/tasks/${encodeURIComponent(taskId)}`,
      AgentTaskSnapshotResponseSchema,
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

  public async uploadAttachment(
    input: AgentAttachmentUploadRequest,
    options: MutationOptions = {},
  ): Promise<AgentAttachmentUploadResponse> {
    return this.#mutation("/v1/attachments", input, AgentAttachmentUploadResponseSchema, options);
  }

  public async startTurn(
    taskId: string,
    input: AgentPromptInput,
    turnOptions: AgentTurnOptions,
    options: MutationOptions = {},
  ): Promise<StartAgentTurnResponse> {
    return this.#mutation(
      `/v1/tasks/${encodeURIComponent(taskId)}/turns`,
      { input, options: turnOptions },
      StartAgentTurnResponseSchema,
      options,
    );
  }

  public async interruptTurn(
    taskId: string,
    turnId: string,
    options: MutationOptions = {},
  ): Promise<InterruptAgentTurnResponse> {
    return this.#mutation(
      `/v1/turns/${encodeURIComponent(turnId)}/interrupt`,
      { taskId },
      InterruptAgentTurnResponseSchema,
      options,
    );
  }

  public async rollbackTurn(
    taskId: string,
    turnId: string,
    options: MutationOptions = {},
  ): Promise<RollbackAgentTurnResponse> {
    return this.#mutation(
      `/v1/turns/${encodeURIComponent(turnId)}/rollback`,
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
      `/v1/pending-requests/${encodeURIComponent(request.requestId)}/resolve`,
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
        method: "POST",
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
