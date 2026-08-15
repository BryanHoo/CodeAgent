import {
  AgentAttachmentUploadResponseSchema,
  AgentBackgroundTerminalPageSchema,
  AgentTaskPageSchema,
  AgentTaskSettingsResponseSchema,
  AgentTaskSnapshotResponseSchema,
  AgentTurnPageSchema,
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
  type AgentPromptInput,
  type AgentTaskSettings,
  type AgentTurnOptions,
  type HostFileKind,
  type PendingRequest,
  type ResolvePendingRequestRequest,
  type ReviewAgentTaskRequest,
  type UploadAgentFeedbackRequest,
} from "@code-agent/protocol";

import type {
  AgentAttachmentUploadInput,
  ListTasksOptions,
  MutationOptions,
  PendingRequestResolution,
  ReadOptions,
} from "./contracts.js";
import { ProjectCodeAgentClient } from "./project-client.js";

export class CodeAgentClient extends ProjectCodeAgentClient {
  public listTasks(
    projectId: string,
    options: ListTasksOptions = {},
    requestOptions: ReadOptions = {},
  ) {
    return this.read(
      { input: { options, projectId }, name: "tasks.list", output: AgentTaskPageSchema },
      requestOptions,
    );
  }

  public readTask(projectId: string, taskId: string, options: ReadOptions = {}) {
    return this.read(
      { input: { projectId, taskId }, name: "tasks.read", output: AgentTaskSnapshotResponseSchema },
      options,
    );
  }

  public listTaskTurns(
    projectId: string,
    taskId: string,
    cursor?: string,
    options: ReadOptions = {},
  ) {
    return this.read(
      { input: { cursor, projectId, taskId }, name: "turns.list", output: AgentTurnPageSchema },
      options,
    );
  }

  public getTaskAttachmentUrl(projectId: string, taskId: string, attachmentId: string): string {
    return this.resolveAssetUrl({
      attachmentId,
      kind: "task-attachment",
      path: attachmentId,
      projectId,
      taskId,
    });
  }

  public openTaskAttachment(
    projectId: string,
    taskId: string,
    attachmentId: string,
    options: MutationOptions = {},
  ) {
    return this.mutation(
      {
        input: { attachmentId, projectId, taskId },
        name: "attachments.open",
        output: OpenAgentTaskAttachmentResponseSchema,
      },
      options,
    );
  }

  public listBackgroundTerminals(projectId: string, taskId: string, options: ReadOptions = {}) {
    return this.read(
      {
        input: { projectId, taskId },
        name: "terminals.list",
        output: AgentBackgroundTerminalPageSchema,
      },
      options,
    );
  }

  public terminateBackgroundTerminal(
    projectId: string,
    taskId: string,
    terminalId: string,
    options: MutationOptions = {},
  ) {
    return this.mutation(
      {
        input: { projectId, taskId, terminalId },
        name: "terminals.terminate",
        output: TerminateAgentBackgroundTerminalResponseSchema,
      },
      options,
    );
  }

  public getTaskSettings(projectId: string, taskId: string, options: ReadOptions = {}) {
    return this.read(
      {
        input: { projectId, taskId },
        name: "task_settings.get",
        output: AgentTaskSettingsResponseSchema,
      },
      options,
    );
  }

  public updateTaskSettings(
    projectId: string,
    taskId: string,
    settings: AgentTaskSettings,
    options: MutationOptions = {},
  ) {
    return this.mutation(
      {
        input: { projectId, settings, taskId },
        name: "task_settings.update",
        output: AgentTaskSettingsResponseSchema,
      },
      options,
    );
  }

  public startTask(projectId: string, options: MutationOptions = {}) {
    return this.mutation(
      { input: { projectId }, name: "tasks.start", output: StartAgentTaskResponseSchema },
      options,
    );
  }

  public pinTask(
    projectId: string,
    taskId: string,
    pinned: boolean,
    options: MutationOptions = {},
  ) {
    return this.mutation(
      {
        input: { pinned, projectId, taskId },
        name: "tasks.pin",
        output: PinAgentTaskResponseSchema,
      },
      options,
    );
  }

  public renameTask(
    projectId: string,
    taskId: string,
    title: string,
    options: MutationOptions = {},
  ) {
    return this.mutation(
      {
        input: { projectId, taskId, title },
        name: "tasks.rename",
        output: RenameAgentTaskResponseSchema,
      },
      options,
    );
  }

  public archiveTask(projectId: string, taskId: string, options: MutationOptions = {}) {
    return this.mutation(
      {
        input: { projectId, taskId },
        name: "tasks.archive",
        output: ArchiveAgentTaskResponseSchema,
      },
      options,
    );
  }

  public unsubscribeTask(projectId: string, taskId: string) {
    return this.mutation({
      input: { projectId, taskId },
      name: "tasks.unsubscribe",
      output: UnsubscribeAgentTaskResponseSchema,
    });
  }

  public startReview(
    projectId: string,
    taskId: string,
    input: ReviewAgentTaskRequest,
    options: MutationOptions = {},
  ) {
    return this.mutation(
      {
        input: { input, projectId, taskId },
        name: "tasks.review",
        output: ReviewAgentTaskResponseSchema,
      },
      options,
    );
  }

  public compactTask(projectId: string, taskId: string, options: MutationOptions = {}) {
    return this.mutation(
      {
        input: { projectId, taskId },
        name: "tasks.compact",
        output: CompactAgentTaskResponseSchema,
      },
      options,
    );
  }

  public forkTask(projectId: string, taskId: string, options: MutationOptions = {}) {
    return this.mutation(
      { input: { projectId, taskId }, name: "tasks.fork", output: ForkAgentTaskResponseSchema },
      options,
    );
  }

  public uploadFeedback(
    projectId: string,
    taskId: string,
    input: UploadAgentFeedbackRequest,
    options: MutationOptions = {},
  ) {
    return this.mutation(
      {
        input: { input, projectId, taskId },
        name: "feedback.upload",
        output: UploadAgentFeedbackResponseSchema,
      },
      options,
    );
  }

  public uploadAttachment(
    projectId: string,
    input: AgentAttachmentUploadInput,
    options: MutationOptions = {},
  ) {
    return this.mutation(
      {
        input: { input, projectId },
        name: "attachments.upload",
        output: AgentAttachmentUploadResponseSchema,
      },
      options,
    );
  }

  public importHostAttachment(
    projectId: string,
    kind: HostFileKind,
    path: string,
    options: MutationOptions = {},
  ) {
    return this.mutation(
      {
        input: { kind, path, projectId },
        name: "attachments.import_host",
        output: AgentAttachmentUploadResponseSchema,
      },
      options,
    );
  }

  public startTurn(
    projectId: string,
    taskId: string,
    input: AgentPromptInput,
    turnOptions: AgentTurnOptions,
    options: MutationOptions = {},
  ) {
    return this.mutation(
      {
        input: { input, projectId, taskId, turnOptions },
        name: "turns.start",
        output: StartAgentTurnResponseSchema,
      },
      options,
    );
  }

  public steerTurn(
    projectId: string,
    taskId: string,
    turnId: string,
    input: AgentPromptInput,
    options: MutationOptions = {},
  ) {
    return this.mutation(
      {
        input: { input, projectId, taskId, turnId },
        name: "turns.steer",
        output: SteerAgentTurnResponseSchema,
      },
      options,
    );
  }

  public interruptTurn(
    projectId: string,
    taskId: string,
    turnId: string,
    options: MutationOptions = {},
  ) {
    return this.mutation(
      {
        input: { projectId, taskId, turnId },
        name: "turns.interrupt",
        output: InterruptAgentTurnResponseSchema,
      },
      options,
    );
  }

  public resolvePendingRequest<T extends PendingRequest>(
    request: T,
    resolution: PendingRequestResolution<T>,
    options: MutationOptions = {},
  ) {
    const input: ResolvePendingRequestRequest = {
      itemId: request.itemId,
      projectId: request.projectId,
      resolution,
      taskId: request.taskId,
      turnId: request.turnId,
      type: request.type,
    } as ResolvePendingRequestRequest;
    return this.mutation(
      {
        input: { input, requestId: request.requestId },
        name: "pending_requests.resolve",
        output: ResolvePendingRequestResponseSchema,
      },
      options,
    );
  }
}
