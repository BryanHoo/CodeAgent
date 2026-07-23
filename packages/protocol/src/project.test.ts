import { describe, expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";

import {
  AgentCapabilitiesSchema,
  AgentInputSchema,
  AgentMutationErrorSchema,
  AgentTaskPageSchema,
  AgentTaskSchema,
  AgentTaskSnapshotSchema,
  InterruptAgentTurnRequestSchema,
  InterruptAgentTurnResponseSchema,
  StartAgentTaskRequestSchema,
  StartAgentTaskResponseSchema,
  StartAgentTurnRequestSchema,
  StartAgentTurnResponseSchema,
  HealthResponseSchema,
  ProjectPageSchema,
  ProjectSchema,
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

  it("validates a structured task snapshot", () => {
    const snapshot = {
      id: "task-1",
      pinned: false,
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

    expect(Value.Check(AgentInputSchema, { text: "实现功能", type: "text" })).toBe(true);
    expect(Value.Check(AgentInputSchema, { text: "", type: "text" })).toBe(false);
    expect(Value.Check(StartAgentTaskRequestSchema, {})).toBe(true);
    expect(Value.Check(StartAgentTaskRequestSchema, { nativeOptions: {} })).toBe(false);
    expect(Value.Check(StartAgentTaskResponseSchema, { task })).toBe(true);
    expect(
      Value.Check(StartAgentTurnRequestSchema, {
        input: { text: "实现功能", type: "text" },
      }),
    ).toBe(true);
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
