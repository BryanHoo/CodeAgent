import { invoke } from "@tauri-apps/api/core";
import {
  CodexlyClient,
  type ListTasksOptions,
  type SubscribeAgentEventsOptions,
} from "@/client/index.js";
import type {
  AccessStatusResponse,
  AddProjectResponse,
  AgentCapabilities,
  AgentProviderConnectionStatus,
  AgentTaskSnapshotResponse,
  AgentTaskPage,
  AppInfoResponse,
  ArchiveAgentTaskResponse,
  DeleteAgentTaskResponse,
  PinAgentTaskResponse,
  ProjectDirectoryListing,
  ProjectPage,
  RemoveProjectResponse,
  RenameAgentTaskResponse,
  RenameProjectResponse,
  ReorderProjectsResponse,
  UnarchiveAgentTaskResponse,
  UnsubscribeAgentTaskResponse,
} from "@/protocol/index.js";

import { ensureCodexRuntime } from "./runtime.js";

export type InvokeImplementation = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

type TauriSidebarClientOptions = Readonly<{
  ensureRuntime?: () => Promise<unknown>;
  invoke?: InvokeImplementation;
}>;

function unavailableFetch(): Promise<Response> {
  return Promise.reject(new Error("HTTP transport is unavailable in the Tauri runtime"));
}

export class TauriSidebarClient extends CodexlyClient {
  readonly #ensureRuntime: () => Promise<unknown>;
  readonly #invoke: InvokeImplementation;

  public constructor(options: TauriSidebarClientOptions = {}) {
    super({
      fetch: unavailableFetch as typeof globalThis.fetch,
      webSocketFactory: () => {
        throw new Error("WebSocket transport is unavailable in the Tauri runtime");
      },
    });
    this.#ensureRuntime = options.ensureRuntime ?? ensureCodexRuntime;
    this.#invoke = options.invoke ?? invoke;
  }

  public override async listProjects(): Promise<ProjectPage> {
    return this.#call("list_projects");
  }

  public override async listTasks(
    projectId: string,
    options: ListTasksOptions = {},
  ): Promise<AgentTaskPage> {
    return this.#call("list_tasks", {
      input: {
        ...(options.archived === true ? { archived: true } : {}),
        ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
        ...(options.limit === undefined ? {} : { limit: options.limit }),
        ...(options.pinned === true ? { pinned: true } : {}),
        projectId,
        ...(options.searchTerm === undefined ? {} : { searchTerm: options.searchTerm }),
      },
    });
  }

  public override async addProject(rootPaths: readonly string[]): Promise<AddProjectResponse> {
    return this.#call("add_project", { rootPaths: [...rootPaths] });
  }

  public override async listProjectDirectories(
    path?: string,
    options: Readonly<{ includeHidden?: boolean }> = {},
  ): Promise<ProjectDirectoryListing> {
    return this.#call("list_project_directories", {
      includeHidden: options.includeHidden === true,
      path: path ?? null,
    });
  }

  public override async renameProject(
    projectId: string,
    name: string,
  ): Promise<RenameProjectResponse> {
    return this.#call("rename_project", { name, projectId });
  }

  public override async removeProject(projectId: string): Promise<RemoveProjectResponse> {
    return this.#call("remove_project", { projectId });
  }

  public override async reorderProjects(
    projectIds: readonly string[],
  ): Promise<ReorderProjectsResponse> {
    return this.#call("reorder_projects", { projectIds: [...projectIds] });
  }

  public override async pinTask(
    projectId: string,
    taskId: string,
    pinned: boolean,
  ): Promise<PinAgentTaskResponse> {
    return this.#call("pin_task", { pinned, projectId, taskId });
  }

  public override async renameTask(
    projectId: string,
    taskId: string,
    title: string,
  ): Promise<RenameAgentTaskResponse> {
    return this.#call("rename_task", { projectId, taskId, title });
  }

  public override async archiveTask(
    projectId: string,
    taskId: string,
  ): Promise<ArchiveAgentTaskResponse> {
    return this.#call("archive_task", { projectId, taskId });
  }

  public override async unarchiveTask(
    projectId: string,
    taskId: string,
  ): Promise<UnarchiveAgentTaskResponse> {
    return this.#call("unarchive_task", { projectId, taskId });
  }

  public override async deleteTask(
    projectId: string,
    taskId: string,
  ): Promise<DeleteAgentTaskResponse> {
    return this.#call("delete_task", { projectId, taskId });
  }

  public override async readTask(
    projectId: string,
    taskId: string,
  ): Promise<AgentTaskSnapshotResponse> {
    const task = await this.#call<AgentTaskPage["data"][number]>("read_task", {
      projectId,
      taskId,
    });
    return {
      checkpoint: { sequence: 0, sessionId: "codeagent-runtime" },
      snapshot: {
        ...task,
        contextUsage: null,
        goal: null,
        pendingRequests: [],
        plan: null,
        settings: {
          approvalPolicy: "on-request",
          approvalsReviewer: "user",
          model: "gpt-5.6-sol",
          reasoningEffort: "high",
          sandboxMode: "workspace-write",
        },
        status: "idle",
        turns: [],
        turnsNextCursor: null,
      },
    };
  }

  public override async unsubscribeTask(
    _projectId: string,
    taskId: string,
  ): Promise<UnsubscribeAgentTaskResponse> {
    return { status: "notLoaded", taskId };
  }

  public override subscribeEvents(options: SubscribeAgentEventsOptions): () => void {
    options.onConnectionState?.("connected");
    return () => options.onConnectionState?.("closed");
  }

  public override async getAccessStatus(): Promise<AccessStatusResponse> {
    return { authenticated: true, mode: "local", version: 1 };
  }

  public override async pairAccess(_code: string): Promise<AccessStatusResponse> {
    return this.getAccessStatus();
  }

  public override async logoutAccess(): Promise<AccessStatusResponse> {
    return this.getAccessStatus();
  }

  public override async getProviderConnection(): Promise<AgentProviderConnectionStatus> {
    await this.#ensureRuntime();
    return {
      account: null,
      customBaseUrl: null,
      mode: "official",
      pendingLogin: null,
      state: "connected",
    };
  }

  public override async getCapabilities(): Promise<AgentCapabilities> {
    await this.#ensureRuntime();
    return {
      feedback: { upload: false },
      goals: { clear: false, read: false, update: false },
      provider: "codex",
      skills: { list: false, use: false },
      tasks: { fork: false, list: true, read: true, start: false },
      turns: { compact: false, interrupt: false, review: false, start: false, steer: false },
    };
  }

  public override async getAppInfo(): Promise<AppInfoResponse> {
    return {
      appVersion: "0.1.0",
      codexVersion: "0.149.0",
      latestVersion: null,
      releaseNotes: null,
      status: "current",
      updateAvailable: false,
    };
  }

  async #call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    await this.#ensureRuntime();
    return args === undefined ? this.#invoke<T>(command) : this.#invoke<T>(command, args);
  }
}
