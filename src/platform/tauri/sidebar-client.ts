import {
  type ListTasksOptions,
  type ListFilesystemEntriesOptions,
  type PendingRequestResolution,
  type ReadTaskOptions,
  type ReadOptions,
  type MutationOptions,
  type SubscribeAgentEventsOptions,
} from "@/platform/native-client-types.js";
import type {
  AddAgentQueuedSubmissionResponse,
  AddProjectResponse,
  AgentBackgroundTerminalPage,
  AgentEvent,
  AgentPromptInput,
  AgentQueuedSubmissionPage,
  AgentQueuedSubmissionStatus,
  AgentTaskSnapshotResponse,
  AgentTaskPage,
  AgentTaskSettings,
  AgentTaskSettingsResponse,
  AgentTurnOptions,
  ArchiveAgentTaskResponse,
  CompactAgentTaskResponse,
  ClearAgentGoalResponse,
  DeleteAgentTaskResponse,
  DeleteAgentQueuedSubmissionResponse,
  ForkAgentTaskRequest,
  ForkAgentTaskResponse,
  InterruptAgentTurnResponse,
  PinAgentTaskResponse,
  PendingRequest,
  ProjectDirectoryListing,
  ProjectPage,
  RemoveProjectResponse,
  ResolvePendingRequestResponse,
  ReviewAgentTaskRequest,
  ReviewAgentTaskResponse,
  RenameAgentTaskResponse,
  RenameProjectResponse,
  ReorderProjectsResponse,
  ReorderAgentQueuedSubmissionsResponse,
  StartAgentTaskResponse,
  StartAgentTurnResponse,
  StartAgentQueuedSubmissionResponse,
  SteerAgentTurnResponse,
  TerminateAgentBackgroundTerminalResponse,
  UnarchiveAgentTaskResponse,
  UnsubscribeAgentTaskResponse,
  UpdateAgentGoalRequest,
  UpdateAgentGoalResponse,
  UpdateAgentQueuedSubmissionResponse,
} from "@/protocol/index.js";

import type { TauriClientOptions } from "./native-client.js";
import { TauriRuntimeClient } from "./runtime-client.js";

export type { InvokeImplementation } from "./native-client.js";

export class TauriSidebarClient extends TauriRuntimeClient {
  public constructor(options: TauriClientOptions = {}) {
    super(options);
  }

  public async listProjects(_options: ReadOptions = {}): Promise<ProjectPage> {
    return this.call("list_projects");
  }

  public async listTasks(
    projectId: string,
    options: ListTasksOptions = {},
    _requestOptions: ReadOptions = {},
  ): Promise<AgentTaskPage> {
    const response = await this.call<AgentTaskPage>("list_tasks", {
      input: {
        ...(options.archived === true ? { archived: true } : {}),
        ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
        ...(options.limit === undefined ? {} : { limit: options.limit }),
        ...(options.pinned === true ? { pinned: true } : {}),
        projectId,
        ...(options.searchTerm === undefined ? {} : { searchTerm: options.searchTerm }),
      },
    });
    for (const task of response.data) this.taskProjects.set(task.id, projectId);
    return response;
  }

  public async addProject(
    rootPaths: readonly string[],
    _options: MutationOptions = {},
  ): Promise<AddProjectResponse> {
    return this.call("add_project", { rootPaths: [...rootPaths] });
  }

  public async listProjectDirectories(
    path?: string,
    options: ListFilesystemEntriesOptions = {},
  ): Promise<ProjectDirectoryListing> {
    return this.call("list_project_directories", {
      includeHidden: options.includeHidden === true,
      path: path ?? null,
    });
  }

  public async renameProject(
    projectId: string,
    name: string,
  ): Promise<RenameProjectResponse> {
    return this.call("rename_project", { name, projectId });
  }

  public async removeProject(projectId: string): Promise<RemoveProjectResponse> {
    return this.call("remove_project", { projectId });
  }

  public async reorderProjects(
    projectIds: readonly string[],
  ): Promise<ReorderProjectsResponse> {
    return this.call("reorder_projects", { projectIds: [...projectIds] });
  }

  public async pinTask(
    projectId: string,
    taskId: string,
    pinned: boolean,
  ): Promise<PinAgentTaskResponse> {
    return this.call("pin_task", { pinned, projectId, taskId });
  }

  public async renameTask(
    projectId: string,
    taskId: string,
    title: string,
  ): Promise<RenameAgentTaskResponse> {
    return this.call("rename_task", { projectId, taskId, title });
  }

  public async archiveTask(
    projectId: string,
    taskId: string,
  ): Promise<ArchiveAgentTaskResponse> {
    return this.call("archive_task", { projectId, taskId });
  }

  public async unarchiveTask(
    projectId: string,
    taskId: string,
  ): Promise<UnarchiveAgentTaskResponse> {
    return this.call("unarchive_task", { projectId, taskId });
  }

  public async deleteTask(
    projectId: string,
    taskId: string,
  ): Promise<DeleteAgentTaskResponse> {
    return this.call("delete_task", { projectId, taskId });
  }

  public async readTask(
    projectId: string,
    taskId: string,
    options: ReadTaskOptions = {},
  ): Promise<AgentTaskSnapshotResponse> {
    const response = await this.call<AgentTaskSnapshotResponse>("read_task", {
      projectId,
      taskId,
      cursor: options.cursor ?? null,
    });
    this.taskProjects.set(response.snapshot.id, projectId);
    return response;
  }

  public async startTask(
    projectId: string,
    _options: MutationOptions = {},
  ): Promise<StartAgentTaskResponse> {
    const response = await this.call<StartAgentTaskResponse>("start_task", { projectId });
    this.taskProjects.set(response.task.id, projectId);
    return response;
  }

  public async listQueuedSubmissions(
    projectId: string,
    taskId: string,
    input: Readonly<{ cursor?: string; limit?: number }> = {},
    _options: ReadOptions = {},
  ): Promise<AgentQueuedSubmissionPage> {
    return this.call("list_queued_submissions", {
      cursor: input.cursor ?? null,
      limit: input.limit ?? null,
      projectId,
      taskId,
    });
  }

  public async addQueuedSubmission(
    projectId: string,
    taskId: string,
    input: AgentPromptInput,
    clientUserMessageId: string,
    _options: MutationOptions = {},
  ): Promise<AddAgentQueuedSubmissionResponse> {
    return this.call("add_queued_submission", {
      clientUserMessageId,
      input,
      projectId,
      taskId,
    });
  }

  public async updateQueuedSubmission(
    projectId: string,
    taskId: string,
    queuedSubmissionId: string,
    input: AgentPromptInput,
    status: AgentQueuedSubmissionStatus,
    _options: MutationOptions = {},
  ): Promise<UpdateAgentQueuedSubmissionResponse> {
    return this.call("update_queued_submission", {
      input,
      projectId,
      queuedSubmissionId,
      status,
      taskId,
    });
  }

  public async deleteQueuedSubmission(
    projectId: string,
    taskId: string,
    queuedSubmissionId: string,
    _options: MutationOptions = {},
  ): Promise<DeleteAgentQueuedSubmissionResponse> {
    return this.call("delete_queued_submission", { projectId, queuedSubmissionId, taskId });
  }

  public async reorderQueuedSubmissions(
    projectId: string,
    taskId: string,
    queuedSubmissionIds: readonly string[],
    _options: MutationOptions = {},
  ): Promise<ReorderAgentQueuedSubmissionsResponse> {
    return this.call("reorder_queued_submissions", {
      projectId,
      queuedSubmissionIds: [...queuedSubmissionIds],
      taskId,
    });
  }

  public async startQueuedSubmission(
    projectId: string,
    taskId: string,
    queuedSubmissionId?: string,
    _options: MutationOptions = {},
  ): Promise<StartAgentQueuedSubmissionResponse> {
    return this.call("start_queued_submission", {
      projectId,
      queuedSubmissionId: queuedSubmissionId ?? null,
      taskId,
    });
  }

  public async startTurn(
    projectId: string,
    taskId: string,
    input: AgentPromptInput,
    options: AgentTurnOptions,
    _mutationOptions: MutationOptions = {},
  ): Promise<StartAgentTurnResponse> {
    return this.call("start_turn", { input, options, projectId, taskId });
  }

  public async steerTurn(
    _projectId: string,
    taskId: string,
    turnId: string,
    input: AgentPromptInput,
    _options: MutationOptions = {},
  ): Promise<SteerAgentTurnResponse> {
    return this.call("steer_turn", { input, taskId, turnId });
  }

  public async interruptTurn(
    _projectId: string,
    taskId: string,
    turnId: string,
    _options: MutationOptions = {},
  ): Promise<InterruptAgentTurnResponse> {
    return this.call("interrupt_turn", { taskId, turnId });
  }

  public async resolvePendingRequest<T extends PendingRequest>(
    request: T,
    resolution: PendingRequestResolution<T>,
    _options: MutationOptions = {},
  ): Promise<ResolvePendingRequestResponse> {
    return this.call("resolve_pending_request", {
      requestId: request.requestId,
      resolution,
    });
  }

  public async startReview(
    projectId: string,
    taskId: string,
    input: ReviewAgentTaskRequest,
    _options: MutationOptions = {},
  ): Promise<ReviewAgentTaskResponse> {
    return this.call("start_review", { input, projectId, taskId });
  }

  public async getTaskSettings(
    projectId: string,
    taskId: string,
  ): Promise<AgentTaskSettingsResponse> {
    return this.call("get_task_settings", { projectId, taskId });
  }

  public async updateTaskSettings(
    projectId: string,
    taskId: string,
    settings: AgentTaskSettings,
  ): Promise<AgentTaskSettingsResponse> {
    return this.call("update_task_settings", { projectId, settings, taskId });
  }

  public async updateTaskGoal(
    projectId: string,
    taskId: string,
    input: UpdateAgentGoalRequest,
  ): Promise<UpdateAgentGoalResponse> {
    return this.call("update_task_goal", { projectId, status: input.status, taskId });
  }

  public async clearTaskGoal(
    projectId: string,
    taskId: string,
  ): Promise<ClearAgentGoalResponse> {
    return this.call("clear_task_goal", { projectId, taskId });
  }

  public async listBackgroundTerminals(
    projectId: string,
    taskId: string,
    _options: ReadOptions = {},
  ): Promise<AgentBackgroundTerminalPage> {
    return this.call("list_background_terminals", { projectId, taskId });
  }

  public async terminateBackgroundTerminal(
    projectId: string,
    taskId: string,
    terminalId: string,
    _options: MutationOptions = {},
  ): Promise<TerminateAgentBackgroundTerminalResponse> {
    return this.call("terminate_background_terminal", { projectId, taskId, terminalId });
  }

  public async compactTask(
    projectId: string,
    taskId: string,
    _options: MutationOptions = {},
  ): Promise<CompactAgentTaskResponse> {
    return this.call("compact_task", { projectId, taskId });
  }

  public async forkTask(
    projectId: string,
    taskId: string,
    input: ForkAgentTaskRequest,
    _options: MutationOptions = {},
  ): Promise<ForkAgentTaskResponse> {
    const response = await this.call<ForkAgentTaskResponse>("fork_task", {
      lastTurnId: input.lastTurnId ?? null,
      projectId,
      taskId,
    });
    this.taskProjects.set(response.task.id, projectId);
    return response;
  }

  public async unsubscribeTask(
    projectId: string,
    taskId: string,
  ): Promise<UnsubscribeAgentTaskResponse> {
    return this.call("unsubscribe_task", { projectId, taskId });
  }

  public subscribeEvents(options: SubscribeAgentEventsOptions): () => void {
    let active = true;
    let lastSequence = options.afterSequence;
    options.onConnectionState?.("connected");
    const cleanup = this.subscribeNativeEvents({
      afterSequence: options.afterSequence,
      onEvent: (event: AgentEvent) => {
        if (!active || event.sessionId !== options.sessionId) return;
        if (this.taskProjects.get(event.taskId) !== options.projectId) return;
        if (event.sequence <= lastSequence) return;
        if (event.sequence !== lastSequence + 1) {
          active = false;
          options.onResyncRequired({
            latestSequence: event.sequence,
            reason: "sequence_gap",
            sessionId: event.sessionId,
            type: "resync.required",
            version: 3,
          });
          options.onConnectionState?.("closed");
          return;
        }
        lastSequence = event.sequence;
        options.onEvent(event);
      },
    });
    return () => {
      if (!active) return cleanup();
      active = false;
      cleanup();
      options.onConnectionState?.("closed");
    };
  }

}
