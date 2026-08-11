import {
  AgentAttachmentUploadResponseSchema,
  AgentBackgroundTerminalPageSchema,
  AgentMutationErrorSchema,
  AgentTaskPageSchema,
  AgentTaskSettingsResponseSchema,
  AgentTaskSnapshotResponseSchema,
  ArchiveAgentTaskResponseSchema,
  CompactAgentTaskResponseSchema,
  ForkAgentTaskResponseSchema,
  InterruptAgentTurnResponseSchema,
  OpenAgentTaskAttachmentResponseSchema,
  PinAgentTaskResponseSchema,
  RenameAgentTaskResponseSchema,
  ResolvePendingRequestResponseSchema,
  ReviewAgentTaskResponseSchema,
  StartAgentTaskResponseSchema,
  StartAgentTurnResponseSchema,
  SteerAgentTurnResponseSchema,
  TerminateAgentBackgroundTerminalResponseSchema,
  UnsubscribeAgentTaskResponseSchema,
  UploadAgentFeedbackResponseSchema,
  type AgentAttachmentUploadResponse,
  type AgentBackgroundTerminalPage,
  type AgentPromptInput,
  type AgentTaskPage,
  type AgentTaskSettings,
  type AgentTaskSettingsResponse,
  type AgentTaskSnapshotResponse,
  type AgentTurnOptions,
  type ArchiveAgentTaskResponse,
  type CompactAgentTaskResponse,
  type ForkAgentTaskResponse,
  type HostFileKind,
  type InterruptAgentTurnResponse,
  type OpenAgentTaskAttachmentResponse,
  type PendingRequest,
  type PinAgentTaskResponse,
  type RenameAgentTaskResponse,
  type ResolvePendingRequestRequest,
  type ResolvePendingRequestResponse,
  type ReviewAgentTaskRequest,
  type ReviewAgentTaskResponse,
  type StartAgentTaskResponse,
  type StartAgentTurnResponse,
  type SteerAgentTurnResponse,
  type TerminateAgentBackgroundTerminalResponse,
  type UnsubscribeAgentTaskResponse,
  type UploadAgentFeedbackRequest,
  type UploadAgentFeedbackResponse,
} from "@code-agent/protocol";
import { v4 as createUuid } from "uuid";

import {
  appendQuery,
  buildTaskAttachmentUrl,
  projectPath,
  taskPath,
  type AgentAttachmentUploadInput,
  type ListTasksOptions,
  type MutationOptions,
  type PendingRequestResolution,
  type ReadOptions,
} from "./http-client-transport.js";
import { ProjectHttpClient } from "./http-client-projects.js";

export class TaskHttpClient extends ProjectHttpClient {
  public async listTasks(
    projectId: string,
    options: ListTasksOptions = {},
    requestOptions: ReadOptions = {},
  ): Promise<AgentTaskPage> {
    const path = appendQuery(`${projectPath(projectId)}/tasks`, options);
    return this.read(path, AgentTaskPageSchema, requestOptions);
  }

  public async readTask(
    projectId: string,
    taskId: string,
    options: ReadOptions = {},
  ): Promise<AgentTaskSnapshotResponse> {
    return this.read(taskPath(projectId, taskId), AgentTaskSnapshotResponseSchema, options);
  }

  public getTaskAttachmentUrl(projectId: string, taskId: string, attachmentId: string): string {
    return buildTaskAttachmentUrl(this.baseUrl, projectId, taskId, attachmentId);
  }

  public async openTaskAttachment(
    projectId: string,
    taskId: string,
    attachmentId: string,
    options: MutationOptions = {},
  ): Promise<OpenAgentTaskAttachmentResponse> {
    return this.mutation(
      `${taskPath(projectId, taskId)}/attachments/${encodeURIComponent(attachmentId)}/open`,
      {},
      OpenAgentTaskAttachmentResponseSchema,
      options,
    );
  }

  public async listBackgroundTerminals(
    projectId: string,
    taskId: string,
    options: ReadOptions = {},
  ): Promise<AgentBackgroundTerminalPage> {
    return this.read(
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
    return this.mutation(
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
    return this.read(
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
    return this.mutation(
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
    return this.mutation(
      `${projectPath(projectId)}/tasks`,
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
    return this.mutation(
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
    return this.mutation(
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
    return this.mutation(
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
    return this.request(
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
    return this.mutation(
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
    return this.mutation(
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
    return this.mutation(
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
    return this.mutation(
      `${taskPath(projectId, taskId)}/feedback`,
      input,
      UploadAgentFeedbackResponseSchema,
      options,
    );
  }

  public async uploadAttachment(
    projectId: string,
    input: AgentAttachmentUploadInput,
    options: MutationOptions = {},
  ): Promise<AgentAttachmentUploadResponse> {
    const body = new FormData();
    body.set("attachment", input.content, input.name);
    return this.request(
      `${projectPath(projectId)}/attachments/${input.kind}`,
      AgentAttachmentUploadResponseSchema,
      {
        body,
        headers: {
          "idempotency-key": options.idempotencyKey ?? createUuid(),
        },
        method: "POST",
      },
      AgentMutationErrorSchema,
      {
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        timeoutMs: this.requestTimeouts.mutationMs,
      },
    );
  }

  public async importHostAttachment(
    projectId: string,
    kind: HostFileKind,
    path: string,
    options: MutationOptions = {},
  ): Promise<AgentAttachmentUploadResponse> {
    return this.mutation(
      `${projectPath(projectId)}/attachments/${kind}/host`,
      { path },
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
    return this.mutation(
      `${taskPath(projectId, taskId)}/turns`,
      { input, options: turnOptions },
      StartAgentTurnResponseSchema,
      options,
    );
  }

  public async steerTurn(
    projectId: string,
    taskId: string,
    turnId: string,
    input: AgentPromptInput,
    options: MutationOptions = {},
  ): Promise<SteerAgentTurnResponse> {
    return this.mutation(
      `${taskPath(projectId, taskId)}/turns/${encodeURIComponent(turnId)}/steer`,
      { input, taskId },
      SteerAgentTurnResponseSchema,
      options,
    );
  }

  public async interruptTurn(
    projectId: string,
    taskId: string,
    turnId: string,
    options: MutationOptions = {},
  ): Promise<InterruptAgentTurnResponse> {
    return this.mutation(
      `${taskPath(projectId, taskId)}/turns/${encodeURIComponent(turnId)}/interrupt`,
      { taskId },
      InterruptAgentTurnResponseSchema,
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
    return this.mutation(
      `${taskPath(request.projectId, request.taskId)}/pending-requests/${encodeURIComponent(request.requestId)}/resolve`,
      body,
      ResolvePendingRequestResponseSchema,
      options,
    );
  }
}
