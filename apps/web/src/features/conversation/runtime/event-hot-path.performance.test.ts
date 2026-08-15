/// <reference types="node" />

import { checkEventStreamMessage, type AgentEvent } from "@code-agent/protocol";
import { expect, it } from "vitest";

import performanceBudgets from "../../../../../../tests/performance-budgets.json" with { type: "json" };
import { ProjectEventHistory } from "./project-runtime-history.js";

const timestamp = "2026-08-12T00:00:01.000Z";
const baseEvent = {
  provider: "codex",
  sequence: 1,
  sessionId: "runtime-performance",
  taskId: "task-performance",
  timestamp,
  version: 2,
} as const;
const messageItem = {
  id: "message-1",
  phase: "final_answer",
  role: "assistant",
  text: "完成迁移并通过全部验证。",
  type: "message",
} as const;
const completedTurn = {
  completedAt: "2026-08-12T00:00:02.000Z",
  error: null,
  id: "turn-1",
  items: [messageItem],
  startedAt: timestamp,
  status: "completed",
} as const;
const pendingRequest = {
  additionalPermissions: null,
  availableDecisions: ["allow", "deny"],
  command: "pnpm check",
  createdAt: timestamp,
  cwd: "/workspace/CodeAgent",
  expiresAt: null,
  itemId: "approval-1",
  networkAccess: null,
  projectId: "project-performance",
  reason: "运行项目验证",
  requestId: "number:7",
  status: "pending",
  taskId: "task-performance",
  turnId: "turn-1",
  type: "command_approval",
} as const;

type WireEventTemplate = Readonly<Record<string, unknown>>;

// 载荷取自协议契约测试与真实实时路径 fixture，并按流式 Delta 占多数进行加权。
const eventVariants = [
  {
    ...baseEvent,
    payload: { turn: { ...completedTurn, completedAt: null, items: [], status: "running" } },
    turnId: "turn-1",
    type: "turn.started",
  },
  {
    ...baseEvent,
    itemId: "message-1",
    payload: { delta: "完成迁移" },
    turnId: "turn-1",
    type: "message.delta",
  },
  {
    ...baseEvent,
    itemId: "reasoning-1",
    payload: { delta: "核对协议边界", field: "summary", sectionIndex: 1 },
    turnId: "turn-1",
    type: "reasoning.delta",
  },
  {
    ...baseEvent,
    itemId: "command-1",
    payload: { delta: "Tests: 128 passed\n" },
    turnId: "turn-1",
    type: "command.output_delta",
  },
  {
    ...baseEvent,
    itemId: "plan-1",
    payload: { delta: "验证性能门禁" },
    turnId: "turn-1",
    type: "plan.delta",
  },
  {
    ...baseEvent,
    itemId: "tool-1",
    payload: { message: "正在读取项目文件" },
    turnId: "turn-1",
    type: "tool.progress",
  },
  {
    ...baseEvent,
    itemId: "patch-1",
    payload: {
      changes: [{ diff: "+const ready = true;", kind: "update", path: "src/app.ts" }],
      originalByteLength: 20,
      truncated: false,
    },
    turnId: "turn-1",
    type: "file_change.updated",
  },
  {
    ...baseEvent,
    payload: {
      diff: "diff --git a/src/app.ts b/src/app.ts\n+const ready = true;",
      originalByteLength: 57,
      truncated: false,
    },
    turnId: "turn-1",
    type: "turn.diff_updated",
  },
  {
    ...baseEvent,
    itemId: "message-1",
    payload: { item: messageItem },
    turnId: "turn-1",
    type: "item.started",
  },
  {
    ...baseEvent,
    itemId: "message-1",
    payload: { item: messageItem },
    turnId: "turn-1",
    type: "item.completed",
  },
  {
    ...baseEvent,
    payload: { turn: completedTurn },
    turnId: "turn-1",
    type: "turn.completed",
  },
  {
    ...baseEvent,
    payload: { usage: { contextWindow: 200_000, usedTokens: 25_000 } },
    turnId: "turn-1",
    type: "usage.updated",
  },
  {
    ...baseEvent,
    payload: {
      plan: {
        explanation: "先打通协议，再完成验证。",
        steps: [
          { status: "completed", text: "定义协议" },
          { status: "in_progress", text: "验证热路径" },
        ],
      },
    },
    turnId: "turn-1",
    type: "plan.updated",
  },
  {
    ...baseEvent,
    payload: {
      code: "server_overloaded",
      httpStatusCode: 503,
      message: "模型服务暂时不可用",
      willRetry: true,
    },
    turnId: "turn-1",
    type: "provider.error",
  },
  {
    ...baseEvent,
    payload: { code: "model_verification", level: "warning", message: "需要模型验证" },
    type: "task.notice",
  },
  {
    ...baseEvent,
    payload: { error: null, failureReason: null, name: "context7", status: "ready" },
    type: "mcp_server.status_updated",
  },
  {
    ...baseEvent,
    itemId: pendingRequest.itemId,
    payload: { request: pendingRequest },
    turnId: "turn-1",
    type: "pending_request.created",
  },
  {
    ...baseEvent,
    itemId: pendingRequest.itemId,
    payload: { request: { ...pendingRequest, status: "resolved" } },
    turnId: "turn-1",
    type: "pending_request.resolved",
  },
  {
    ...baseEvent,
    itemId: pendingRequest.itemId,
    payload: { request: { ...pendingRequest, status: "expired" } },
    turnId: "turn-1",
    type: "pending_request.expired",
  },
] satisfies WireEventTemplate[];

function repeatEvent(event: WireEventTemplate | undefined, count: number): WireEventTemplate[] {
  if (event === undefined) {
    throw new Error("Expected a weighted event benchmark template");
  }
  return Array.from({ length: count }, () => event);
}

const weightedVariants: readonly WireEventTemplate[] = [
  ...repeatEvent(eventVariants[1], 55),
  ...repeatEvent(eventVariants[2], 15),
  ...repeatEvent(eventVariants[3], 10),
  ...repeatEvent(eventVariants[4], 5),
  ...eventVariants,
];

function createWireFrames(count: number): string[] {
  return Array.from({ length: count }, (_, index) => {
    const template = weightedVariants[index % weightedVariants.length];
    if (template === undefined) {
      throw new Error("Expected an event benchmark template");
    }
    return JSON.stringify({ ...template, sequence: index + 1 });
  });
}

function measure(run: () => void): number {
  const startedAt = performance.now();
  run();
  return performance.now() - startedAt;
}

it("profiles parse, validate, and append for 10,000 representative wire frames", () => {
  const frameCount = performanceBudgets.eventHotPath.frames;
  expect(frameCount).toBe(10_000);
  const wireFrames = createWireFrames(frameCount);
  const textEncoder = new TextEncoder();
  const wireByteLengths = wireFrames.map((frame) => textEncoder.encode(frame).byteLength);
  let parsedFrames: unknown[] = [];
  const parseMs = measure(() => {
    parsedFrames = wireFrames.map((frame) => JSON.parse(frame) as unknown);
  });

  let validFrames = 0;
  const validatedEvents: AgentEvent[] = [];
  const validateMs = measure(() => {
    for (const frame of parsedFrames) {
      if (
        checkEventStreamMessage(frame) &&
        frame.type !== "connection.ready" &&
        frame.type !== "resync.required"
      ) {
        validatedEvents.push(frame);
        validFrames += 1;
      }
    }
  });
  expect(validFrames).toBe(frameCount);
  expect(validateMs).toBeLessThan(performanceBudgets.eventHotPath.maxValidateMs);

  const history = new ProjectEventHistory({
    maxBytes: Number.MAX_SAFE_INTEGER,
    maxEvents: frameCount,
  });
  const appendMs = measure(() => {
    for (let index = 0; index < validatedEvents.length; index += 1) {
      const event = validatedEvents[index];
      const wireBytes = wireByteLengths[index];
      if (event === undefined || wireBytes === undefined) {
        throw new Error("Expected aligned event benchmark data");
      }
      history.append(event, wireBytes);
    }
  });
  expect(appendMs).toBeLessThan(performanceBudgets.eventHotPath.maxAppendMs);

  const pipelineHistory = new ProjectEventHistory({
    maxBytes: Number.MAX_SAFE_INTEGER,
    maxEvents: frameCount,
  });
  let pipelineEvents = 0;
  const totalMs = measure(() => {
    for (const wireFrame of wireFrames) {
      const wireBytes = textEncoder.encode(wireFrame).byteLength;
      const frame = JSON.parse(wireFrame) as unknown;
      if (
        checkEventStreamMessage(frame) &&
        frame.type !== "connection.ready" &&
        frame.type !== "resync.required"
      ) {
        pipelineHistory.append(frame, wireBytes);
        pipelineEvents += 1;
      }
    }
  });

  expect(pipelineEvents).toBe(frameCount);
  console.info(
    JSON.stringify({
      appendMs,
      benchmark: "event-hot-path",
      frames: frameCount,
      parseMs,
      totalMs,
      validateMs,
    }),
  );
});
