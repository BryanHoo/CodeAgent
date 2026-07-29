import { describe, expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";

import {
  AgentAttachmentSchema,
  AgentAttachmentUploadRequestSchema,
  AgentAttachmentUploadResponseSchema,
  AgentCapabilitiesSchema,
  AgentModelPageSchema,
  AgentMessageItemSchema,
  AgentProjectDefaultsResponseSchema,
  AgentProjectDefaultsSchema,
  AgentPromptInputSchema,
  AgentSkillPageSchema,
  AgentMutationErrorSchema,
  AgentTaskPageSchema,
  AgentTaskSchema,
  AgentTaskSettingsResponseSchema,
  AgentTaskSettingsSchema,
  AddProjectResponseSchema,
  ArchiveAgentTaskRequestSchema,
  ArchiveAgentTaskResponseSchema,
  AgentTaskSnapshotSchema,
  InterruptAgentTurnRequestSchema,
  InterruptAgentTurnResponseSchema,
  PendingRequestSchema,
  StartAgentTaskRequestSchema,
  StartAgentTaskResponseSchema,
  StartAgentTurnRequestSchema,
  StartAgentTurnResponseSchema,
  HealthResponseSchema,
  ProjectPageSchema,
  ProjectGitStatusSchema,
  ProjectSourceFileSchema,
  ProjectSchema,
  PinAgentTaskRequestSchema,
  PinAgentTaskResponseSchema,
  CompactAgentTaskRequestSchema,
  CompactAgentTaskResponseSchema,
  ForkAgentTaskRequestSchema,
  ForkAgentTaskResponseSchema,
  ReviewAgentTaskRequestSchema,
  ReviewAgentTaskResponseSchema,
  RenameAgentTaskRequestSchema,
  RenameAgentTaskResponseSchema,
  ReorderProjectsRequestSchema,
  ReorderProjectsResponseSchema,
  UploadAgentFeedbackRequestSchema,
  UploadAgentFeedbackResponseSchema,
  RollbackAgentTurnRequestSchema,
  RollbackAgentTurnResponseSchema,
  ResolvePendingRequestRequestSchema,
  ResolvePendingRequestResponseSchema,
} from "./project.js";

describe("project protocol", () => {
  it("accepts a selected project or a cancelled host directory selection", () => {
    expect(Value.Check(AddProjectResponseSchema, { project: null })).toBe(true);
    expect(
      Value.Check(AddProjectResponseSchema, {
        project: {
          createdAt: "2026-07-25T00:00:00.000Z",
          id: "code-agent",
          name: "CodeAgent",
          rootPath: "/workspace/CodeAgent",
        },
      }),
    ).toBe(true);
  });

  it("defines a public project with its local root path", () => {
    expect(ProjectSchema).toMatchObject({
      additionalProperties: false,
      properties: {
        createdAt: { format: "date-time", type: "string" },
        id: { minLength: 1, type: "string" },
        name: { minLength: 1, type: "string" },
        rootPath: { minLength: 1, type: "string" },
      },
      type: "object",
    });
    expect(ProjectSchema.required).toEqual(["createdAt", "id", "name", "rootPath"]);
  });

  it("requires a complete non-duplicated project order", () => {
    expect(
      Value.Check(ReorderProjectsRequestSchema, {
        projectIds: ["superwork", "code-agent"],
      }),
    ).toBe(true);
    expect(Value.Check(ReorderProjectsRequestSchema, { projectIds: [] })).toBe(false);
    expect(
      Value.Check(ReorderProjectsRequestSchema, {
        projectIds: ["code-agent", "code-agent"],
      }),
    ).toBe(false);
    expect(
      Value.Check(ReorderProjectsRequestSchema, {
        projectIds: ["code-agent"],
        staleOrder: true,
      }),
    ).toBe(false);
    expect(
      Value.Check(ReorderProjectsResponseSchema, {
        data: [
          {
            createdAt: "2026-07-23T00:00:00.000Z",
            id: "code-agent",
            name: "CodeAgent",
            rootPath: "/workspace/CodeAgent",
          },
        ],
        nextCursor: null,
      }),
    ).toBe(true);
  });

  it("scopes every task to a project and records its pinned state", () => {
    expect(AgentTaskSchema).toMatchObject({
      additionalProperties: false,
      properties: {
        id: { minLength: 1, type: "string" },
        pinned: { type: "boolean" },
        projectId: { minLength: 1, type: "string" },
        title: { minLength: 1, type: "string" },
        updatedAt: { format: "date-time", type: "string" },
      },
      type: "object",
    });
    expect(AgentTaskSchema.required).toEqual(["id", "pinned", "projectId", "title", "updatedAt"]);
  });

  it("carries bounded image metadata without snapshot data URLs", () => {
    expect(
      Value.Check(AgentMessageItemSchema, {
        attachments: [
          {
            id: "attachment-history-1",
            mediaType: "image/png",
            name: "diagram.png",
            size: 68,
          },
        ],
        id: "message-image",
        role: "user",
        text: "",
        type: "message",
      }),
    ).toBe(true);
    expect(
      Value.Check(AgentMessageItemSchema, {
        attachments: [
          {
            mediaType: "image/png",
            name: "diagram.png",
            url: "data:image/png;base64,iVBORw0KGgo=",
          },
        ],
        id: "message-image",
        role: "user",
        text: "",
        type: "message",
      }),
    ).toBe(false);
  });

  it("validates paginated projects and tasks", () => {
    expect(
      Value.Check(ProjectPageSchema, {
        data: [
          {
            createdAt: "2026-07-23T00:00:00.000Z",
            id: "code-agent",
            name: "CodeAgent",
            rootPath: "/workspace/CodeAgent",
          },
        ],
        nextCursor: null,
      }),
    ).toBe(true);
    expect(
      Value.Check(AgentTaskPageSchema, {
        data: [
          {
            id: "task-1",
            pinned: false,
            projectId: "code-agent",
            title: "实现真实任务历史",
            updatedAt: "2026-07-23T00:00:00.000Z",
          },
        ],
        nextCursor: "next-page",
      }),
    ).toBe(true);
  });

  it("separates staged and unstaged Git file changes", () => {
    const fileChange = {
      diff: "--- a/src/index.ts\n+++ b/src/index.ts\n@@ -1 +1 @@\n-old\n+new",
      kind: "update",
      path: "src/index.ts",
    };

    expect(
      Value.Check(ProjectGitStatusSchema, {
        staged: [fileChange],
        unstaged: [{ ...fileChange, path: "README.md" }],
      }),
    ).toBe(true);
    expect(
      Value.Check(ProjectGitStatusSchema, {
        staged: [],
        unstaged: [],
        legacyChanges: [],
      }),
    ).toBe(false);
  });

  it("describes a bounded project source file preview", () => {
    expect(
      Value.Check(ProjectSourceFileSchema, {
        content: "# Architecture\n",
        path: "docs/architecture-design.md",
        truncated: true,
      }),
    ).toBe(true);
    expect(
      Value.Check(ProjectSourceFileSchema, {
        content: "# Architecture\n",
        path: "/workspace/CodeAgent/docs/architecture-design.md",
        truncated: false,
      }),
    ).toBe(false);
  });

  it("validates a structured task snapshot", () => {
    const snapshot = {
      contextUsage: null,
      id: "task-1",
      pinned: false,
      pendingRequests: [],
      projectId: "code-agent",
      settings: {
        approvalPolicy: "on-request",
        model: "gpt-5.6-sol",
        reasoningEffort: "high",
        sandboxMode: "workspace-write",
      },
      status: "idle",
      title: "实现真实任务历史",
      turns: [
        {
          completedAt: "2026-07-23T00:01:00.000Z",
          error: null,
          id: "turn-1",
          items: [
            { id: "item-1", role: "user", text: "读取真实历史", type: "message" },
            {
              content: "按统一边界实现",
              id: "item-2",
              summary: "分析协议",
              type: "reasoning",
            },
            {
              command: "pnpm check",
              cwd: "/workspace/CodeAgent",
              id: "item-3",
              output: "Done",
              outputTruncated: false,
              status: "completed",
              type: "command",
            },
            {
              changes: [{ diff: "+export {}", kind: "update", path: "src/index.ts" }],
              id: "item-4",
              status: "completed",
              type: "file_change",
            },
            {
              id: "item-5",
              input: { path: "src/index.ts" },
              name: "read_file",
              status: "completed",
              type: "tool",
            },
            { id: "item-6", text: "1. 定义协议", type: "plan" },
            { detail: "上下文已压缩", id: "item-7", label: "压缩上下文", type: "activity" },
          ],
          startedAt: "2026-07-23T00:00:00.000Z",
          status: "completed",
        },
      ],
      updatedAt: "2026-07-23T00:01:00.000Z",
    };

    expect(Value.Check(AgentTaskSnapshotSchema, snapshot)).toBe(true);
    expect(
      Value.Check(AgentTaskSnapshotSchema, {
        ...snapshot,
        turns: [{ ...snapshot.turns[0], error: undefined }],
      }),
    ).toBe(false);
    expect(
      Value.Check(AgentTaskSnapshotSchema, {
        ...snapshot,
        turns: [
          {
            ...snapshot.turns[0],
            items: snapshot.turns[0]?.items.map((item) =>
              item.type === "command" ? { ...item, outputTruncated: undefined } : item,
            ),
          },
        ],
      }),
    ).toBe(false);
    expect(
      Value.Check(AgentTaskSnapshotSchema, {
        ...snapshot,
        turns: [{ ...snapshot.turns[0], status: "inProgress" }],
      }),
    ).toBe(false);
    expect(Value.Check(AgentTaskSnapshotSchema, { ...snapshot, nativeThread: {} })).toBe(false);
  });

  it("accepts user message skills without exposing native paths", () => {
    const message = {
      id: "message-1",
      role: "user",
      skills: [{ name: "review-security" }],
      text: "检查认证边界",
      type: "message",
    };

    expect(Value.Check(AgentMessageItemSchema, message)).toBe(true);
    expect(
      Value.Check(AgentMessageItemSchema, {
        ...message,
        skills: [{ name: "review-security", path: "/private/SKILL.md" }],
      }),
    ).toBe(false);
  });

  it("validates strict project defaults and task settings", () => {
    const projectDefaults = {
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      sandboxMode: "workspace-write",
    };
    const taskSettings = { approvalPolicy: "never", ...projectDefaults };

    expect(Value.Check(AgentProjectDefaultsSchema, projectDefaults)).toBe(true);
    expect(Value.Check(AgentProjectDefaultsResponseSchema, { settings: projectDefaults })).toBe(
      true,
    );
    expect(Value.Check(AgentTaskSettingsSchema, taskSettings)).toBe(true);
    expect(Value.Check(AgentTaskSettingsResponseSchema, { settings: taskSettings })).toBe(true);
    expect(
      Value.Check(AgentProjectDefaultsSchema, { ...projectDefaults, approvalPolicy: "never" }),
    ).toBe(false);
    expect(
      Value.Check(AgentTaskSettingsSchema, { ...taskSettings, approvalPolicy: "always" }),
    ).toBe(false);
    expect(
      Value.Check(AgentTaskSettingsSchema, { ...taskSettings, sandboxMode: "host-write" }),
    ).toBe(false);
    expect(
      Value.Check(AgentTaskSettingsSchema, { ...taskSettings, reasoningEffort: undefined }),
    ).toBe(false);
    expect(
      Value.Check(AgentTaskSettingsResponseSchema, { settings: taskSettings, legacy: true }),
    ).toBe(false);
  });

  it("validates discriminated pending requests and typed resolutions", () => {
    const identity = {
      createdAt: "2026-07-23T00:00:00.000Z",
      expiresAt: null,
      itemId: "item-1",
      projectId: "code-agent",
      requestId: "number:7",
      status: "pending",
      taskId: "task-1",
      turnId: "turn-1",
    } as const;
    const commandRequest = {
      ...identity,
      availableDecisions: ["allow", "allow_for_session", "deny"],
      command: "pnpm check",
      cwd: "/workspace/CodeAgent",
      networkAccess: { host: "api.example.com", protocol: "https" },
      reason: "需要执行检查",
      type: "command_approval",
    } as const;
    const fileRequest = {
      ...identity,
      availableDecisions: ["allow", "deny"],
      grantRoot: "/workspace/CodeAgent",
      reason: null,
      requestId: "number:8",
      type: "file_change_approval",
    } as const;
    const inputRequest = {
      ...identity,
      questions: [
        {
          header: "执行模式",
          id: "mode",
          isOther: false,
          isSecret: false,
          options: [
            { description: "继续实现", label: "继续" },
            { description: "停止当前工作", label: "停止" },
          ],
          prompt: "下一步怎么处理？",
          type: "choice",
        },
      ],
      requestId: "string:input-1",
      type: "user_input",
    } as const;

    expect(
      [commandRequest, fileRequest, inputRequest].every((request) =>
        Value.Check(PendingRequestSchema, request),
      ),
    ).toBe(true);
    expect(
      Value.Check(PendingRequestSchema, {
        ...inputRequest,
        questions: [{ ...inputRequest.questions[0], options: [] }],
      }),
    ).toBe(false);
    expect(
      Value.Check(PendingRequestSchema, {
        ...inputRequest,
        questions: [
          {
            ...inputRequest.questions[0],
            isOther: true,
            type: "confirmation",
          },
        ],
      }),
    ).toBe(false);
    expect(Value.Check(PendingRequestSchema, { ...commandRequest, nativeRequestId: 7 })).toBe(
      false,
    );
    expect(
      Value.Check(PendingRequestSchema, {
        ...commandRequest,
        networkAccess: { host: "api.example.com", protocol: "ftp" },
      }),
    ).toBe(false);
    expect(
      Value.Check(ResolvePendingRequestRequestSchema, {
        itemId: commandRequest.itemId,
        projectId: commandRequest.projectId,
        resolution: { decision: "allow_for_session" },
        taskId: commandRequest.taskId,
        turnId: commandRequest.turnId,
        type: commandRequest.type,
      }),
    ).toBe(true);
    expect(
      Value.Check(ResolvePendingRequestRequestSchema, {
        itemId: inputRequest.itemId,
        projectId: inputRequest.projectId,
        resolution: { answers: { mode: ["继续"] } },
        taskId: inputRequest.taskId,
        turnId: inputRequest.turnId,
        type: inputRequest.type,
      }),
    ).toBe(true);
    expect(
      Value.Check(ResolvePendingRequestRequestSchema, {
        itemId: inputRequest.itemId,
        projectId: inputRequest.projectId,
        resolution: { answers: { mode: [""] } },
        taskId: inputRequest.taskId,
        turnId: inputRequest.turnId,
        type: inputRequest.type,
      }),
    ).toBe(false);
    expect(
      Value.Check(ResolvePendingRequestRequestSchema, {
        itemId: inputRequest.itemId,
        projectId: inputRequest.projectId,
        resolution: { answers: { mode: ["继续", "停止"] } },
        taskId: inputRequest.taskId,
        turnId: inputRequest.turnId,
        type: inputRequest.type,
      }),
    ).toBe(false);
    expect(
      Value.Check(ResolvePendingRequestRequestSchema, {
        itemId: inputRequest.itemId,
        projectId: inputRequest.projectId,
        resolution: { decision: "allow" },
        taskId: inputRequest.taskId,
        turnId: inputRequest.turnId,
        type: inputRequest.type,
      }),
    ).toBe(false);
    expect(
      Value.Check(ResolvePendingRequestResponseSchema, {
        request: { ...commandRequest, status: "resolved" },
      }),
    ).toBe(true);
  });

  it("validates health and capability responses", () => {
    expect(Value.Check(HealthResponseSchema, { status: "ok", version: 1 })).toBe(true);
    expect(
      Value.Check(AgentCapabilitiesSchema, {
        feedback: { upload: true },
        provider: "codex",
        skills: { list: true, use: true },
        tasks: { fork: true, list: true, read: true, start: true },
        turns: { compact: true, interrupt: true, review: true, rollback: true, start: true },
      }),
    ).toBe(true);
  });

  it("validates task command mutation contracts", () => {
    const task = {
      id: "task-2",
      pinned: false,
      projectId: "code-agent",
      title: "续接任务",
      updatedAt: "2026-07-25T00:00:00.000Z",
    };
    const turn = {
      completedAt: null,
      error: null,
      id: "review-turn",
      items: [],
      startedAt: "2026-07-25T00:00:00.000Z",
      status: "running",
    };

    expect(
      Value.Check(ReviewAgentTaskRequestSchema, {
        target: { type: "base_branch", branch: "main" },
      }),
    ).toBe(true);
    expect(Value.Check(ReviewAgentTaskRequestSchema, { target: { type: "base_branch" } })).toBe(
      false,
    );
    expect(Value.Check(ReviewAgentTaskResponseSchema, { taskId: "task-1", turn })).toBe(true);
    expect(Value.Check(CompactAgentTaskRequestSchema, {})).toBe(true);
    expect(
      Value.Check(CompactAgentTaskResponseSchema, { status: "compacting", taskId: "task-1" }),
    ).toBe(true);
    expect(Value.Check(ForkAgentTaskRequestSchema, {})).toBe(true);
    expect(Value.Check(ForkAgentTaskResponseSchema, { task })).toBe(true);
    expect(Value.Check(PinAgentTaskRequestSchema, { pinned: true })).toBe(true);
    expect(Value.Check(PinAgentTaskRequestSchema, { pinned: true, taskId: "task-2" })).toBe(false);
    expect(Value.Check(PinAgentTaskResponseSchema, { task: { ...task, pinned: true } })).toBe(true);
    expect(Value.Check(RenameAgentTaskRequestSchema, { title: "重命名任务" })).toBe(true);
    expect(Value.Check(RenameAgentTaskRequestSchema, { title: "   " })).toBe(false);
    expect(Value.Check(RenameAgentTaskRequestSchema, { title: "" })).toBe(false);
    expect(
      Value.Check(RenameAgentTaskResponseSchema, { task: { ...task, title: "重命名任务" } }),
    ).toBe(true);
    expect(Value.Check(ArchiveAgentTaskRequestSchema, {})).toBe(true);
    expect(Value.Check(ArchiveAgentTaskRequestSchema, { permanent: true })).toBe(false);
    expect(
      Value.Check(ArchiveAgentTaskResponseSchema, { status: "archived", taskId: "task-2" }),
    ).toBe(true);
    expect(
      Value.Check(UploadAgentFeedbackRequestSchema, {
        classification: "other",
        includeLogs: true,
        reason: "菜单操作不符合预期",
      }),
    ).toBe(true);
    expect(
      Value.Check(UploadAgentFeedbackResponseSchema, { status: "sent", taskId: "task-1" }),
    ).toBe(true);
  });

  it("validates the latest turn rollback contract", () => {
    expect(Value.Check(RollbackAgentTurnRequestSchema, { taskId: "task-1" })).toBe(true);
    expect(
      Value.Check(RollbackAgentTurnResponseSchema, {
        restoredFiles: ["src/index.ts"],
        status: "rolled_back",
        taskId: "task-1",
        turnId: "turn-1",
      }),
    ).toBe(true);
    expect(
      Value.Check(RollbackAgentTurnResponseSchema, {
        restoredFiles: [],
        status: "rolled_back",
        taskId: "task-1",
        turnId: "turn-1",
      }),
    ).toBe(false);
  });

  it("validates structured Agent inputs and mutation contracts", () => {
    const task = {
      id: "task-1",
      pinned: false,
      projectId: "code-agent",
      title: "实现写入闭环",
      updatedAt: "2026-07-23T00:00:00.000Z",
    };
    const turn = {
      completedAt: null,
      error: null,
      id: "turn-1",
      items: [],
      startedAt: "2026-07-23T00:00:00.000Z",
      status: "running",
    };

    const attachment = {
      id: "attachment-1",
      mediaType: "image/png",
      name: "screen.png",
      size: 68,
    };
    const prompt = {
      attachments: [{ id: attachment.id }],
      skills: [],
      text: "参考截图实现功能",
      type: "prompt",
    };

    expect(
      Value.Check(AgentSkillPageSchema, {
        data: [
          {
            description: "执行严格的安全审查",
            displayName: "Security review",
            id: "skill_01J00000000000000000000000",
            name: "review-security",
            scope: "system",
          },
        ],
        nextCursor: null,
      }),
    ).toBe(true);

    expect(
      Value.Check(AgentModelPageSchema, {
        data: [
          {
            defaultReasoningEffort: "high",
            description: "适合复杂编码任务",
            displayName: "GPT-5.6 Sol",
            id: "gpt-5.6-sol",
            isDefault: true,
            supportedReasoningEfforts: [
              { description: "快速回答", id: "low" },
              { description: "深入分析", id: "high" },
            ],
          },
        ],
        nextCursor: null,
      }),
    ).toBe(true);
    expect(Value.Check(AgentAttachmentSchema, attachment)).toBe(true);
    expect(
      Value.Check(AgentAttachmentUploadRequestSchema, {
        dataUrl:
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        name: attachment.name,
      }),
    ).toBe(true);
    expect(Value.Check(AgentAttachmentUploadResponseSchema, { attachment })).toBe(true);
    expect(Value.Check(AgentPromptInputSchema, prompt)).toBe(true);
    expect(
      Value.Check(AgentPromptInputSchema, {
        attachments: [{ id: attachment.id }],
        skills: [],
        text: "",
        type: "prompt",
      }),
    ).toBe(true);
    expect(
      Value.Check(AgentPromptInputSchema, {
        attachments: [],
        skills: [{ id: "skill_01J00000000000000000000000", name: "review-security" }],
        text: "",
        type: "prompt",
      }),
    ).toBe(true);
    expect(
      Value.Check(AgentPromptInputSchema, {
        attachments: [],
        skills: [],
        text: "",
        type: "prompt",
      }),
    ).toBe(false);
    expect(
      Value.Check(AgentPromptInputSchema, {
        attachments: [],
        skills: [
          { id: "skill-1", name: "first" },
          { id: "skill-2", name: "second" },
        ],
        text: "run",
        type: "prompt",
      }),
    ).toBe(false);
    expect(
      Value.Check(AgentPromptInputSchema, {
        attachments: [],
        skills: [{ id: "skill-1", name: "first", path: "/private/skill" }],
        text: "run",
        type: "prompt",
      }),
    ).toBe(false);
    expect(
      Value.Check(AgentAttachmentUploadRequestSchema, {
        dataUrl: "data:text/plain;base64,SGVsbG8=",
        name: "notes.txt",
      }),
    ).toBe(false);
    expect(Value.Check(StartAgentTaskRequestSchema, {})).toBe(true);
    expect(Value.Check(StartAgentTaskRequestSchema, { nativeOptions: {} })).toBe(false);
    expect(Value.Check(StartAgentTaskResponseSchema, { task })).toBe(true);
    expect(
      Value.Check(StartAgentTurnRequestSchema, {
        input: prompt,
        options: {
          approvalPolicy: "on-request",
          model: "gpt-5.6-sol",
          reasoningEffort: "high",
          sandboxMode: "workspace-write",
        },
      }),
    ).toBe(true);
    expect(
      Value.Check(StartAgentTurnRequestSchema, {
        input: prompt,
        options: {
          approvalPolicy: "always",
          model: "gpt-5.6-sol",
          reasoningEffort: "high",
          sandboxMode: "workspace-write",
        },
      }),
    ).toBe(false);
    expect(Value.Check(StartAgentTurnResponseSchema, { taskId: task.id, turn })).toBe(true);
    expect(Value.Check(InterruptAgentTurnRequestSchema, { taskId: task.id })).toBe(true);
    expect(
      Value.Check(InterruptAgentTurnResponseSchema, {
        status: "interrupting",
        taskId: task.id,
        turnId: turn.id,
      }),
    ).toBe(true);
    expect(
      Value.Check(AgentMutationErrorSchema, {
        code: "IDEMPOTENCY_CONFLICT",
        message: "Idempotency key was already used with another request",
        retryable: false,
      }),
    ).toBe(true);
  });
});
