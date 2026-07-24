import { describe, expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";

import {
  AgentAttachmentSchema,
  AgentAttachmentUploadRequestSchema,
  AgentAttachmentUploadResponseSchema,
  AgentCapabilitiesSchema,
  AgentModelPageSchema,
  AgentPromptInputSchema,
  AgentMutationErrorSchema,
  AgentTaskPageSchema,
  AgentTaskSchema,
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
  ProjectSchema,
  ResolvePendingRequestRequestSchema,
  ResolvePendingRequestResponseSchema,
} from "./project.js";

describe("project protocol", () => {
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

  it("validates a structured task snapshot", () => {
    const snapshot = {
      contextUsage: null,
      id: "task-1",
      pinned: false,
      pendingRequests: [],
      projectId: "code-agent",
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
        provider: "codex",
        tasks: { list: true, read: true, start: true },
        turns: { interrupt: true, start: true },
      }),
    ).toBe(true);
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
      text: "参考截图实现功能",
      type: "prompt",
    };

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
        text: "",
        type: "prompt",
      }),
    ).toBe(true);
    expect(Value.Check(AgentPromptInputSchema, { attachments: [], text: "", type: "prompt" })).toBe(
      false,
    );
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
