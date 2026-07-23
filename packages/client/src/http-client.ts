import {
  AgentCapabilitiesSchema,
  AgentTaskPageSchema,
  AgentTaskSnapshotSchema,
  HealthResponseSchema,
  ProjectPageSchema,
  type AgentCapabilities,
  type AgentTaskPage,
  type AgentTaskSnapshot,
  type HealthResponse,
  type ProjectPage,
} from "@code-agent/protocol";
import type { Static, TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

export interface CodeAgentClientOptions {
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
}

export type ListTasksOptions = Readonly<{
  cursor?: string;
  limit?: number;
}>;

export class CodeAgentHttpError extends Error {
  public readonly status: number;

  public constructor(status: number, statusText: string) {
    super(`CodeAgent request failed with ${String(status)} ${statusText}`.trim());
    this.name = "CodeAgentHttpError";
    this.status = status;
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

  public constructor(options: CodeAgentClientOptions = {}) {
    this.#baseUrl = options.baseUrl?.replace(/\/$/u, "") ?? "";
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  public async getHealth(): Promise<HealthResponse> {
    return this.#request("/v1/health", HealthResponseSchema);
  }

  public async getCapabilities(): Promise<AgentCapabilities> {
    return this.#request("/v1/capabilities", AgentCapabilitiesSchema);
  }

  public async listProjects(): Promise<ProjectPage> {
    return this.#request("/v1/projects", ProjectPageSchema);
  }

  public async listTasks(
    projectId: string,
    options: ListTasksOptions = {},
  ): Promise<AgentTaskPage> {
    const path = appendQuery(`/v1/projects/${encodeURIComponent(projectId)}/tasks`, options);
    return this.#request(path, AgentTaskPageSchema);
  }

  public async readTask(taskId: string): Promise<AgentTaskSnapshot> {
    return this.#request(`/v1/tasks/${encodeURIComponent(taskId)}`, AgentTaskSnapshotSchema);
  }

  async #request<T extends TSchema>(path: string, schema: T): Promise<Static<T>> {
    const response = await this.#fetch(`${this.#baseUrl}${path}`, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
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
