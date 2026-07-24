import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";

import {
  AgentEventSchema,
  AgentTaskSnapshotResponseSchema,
  ConnectionReadySchema,
  EventStreamMessageSchema,
  ResyncRequiredSchema,
} from "./agent-event.js";

const messageItem = {
  id: "item-1",
  role: "assistant",
  text: "完成",
  type: "message",
} as const;

const completedTurn = {
  completedAt: "2026-07-23T00:00:01.000Z",
  error: null,
  id: "turn-1",
  items: [messageItem],
  startedAt: "2026-07-23T00:00:00.000Z",
  status: "completed",
} as const;

const baseEvent = {
  provider: "codex",
  sequence: 1,
  sessionId: "runtime-1",
  taskId: "task-1",
  timestamp: "2026-07-23T00:00:00.000Z",
  version: 1,
} as const;

const pendingRequest = {
  availableDecisions: ["allow", "deny"],
  command: "pnpm check",
  createdAt: "2026-07-23T00:00:00.000Z",
  cwd: "/workspace/CodeAgent",
  expiresAt: null,
  itemId: "item-approval",
  networkAccess: null,
  projectId: "code-agent",
  reason: null,
  requestId: "number:7",
  status: "pending",
  taskId: "task-1",
  turnId: "turn-1",
  type: "command_approval",
} as const;

describe("Agent Event v1 protocol", () => {
  it("validates every supported event variant", () => {
    const events = [
      {
        ...baseEvent,
        payload: {
          turn: { ...completedTurn, completedAt: null, items: [], status: "running" },
        },
        turnId: "turn-1",
        type: "turn.started",
      },
      {
        ...baseEvent,
        itemId: "item-1",
        payload: { delta: "流式文本" },
        turnId: "turn-1",
        type: "message.delta",
      },
      {
        ...baseEvent,
        itemId: "item-2",
        payload: { delta: "推理", field: "summary" },
        turnId: "turn-1",
        type: "reasoning.delta",
      },
      {
        ...baseEvent,
        itemId: "item-3",
        payload: { delta: "Done\n" },
        turnId: "turn-1",
        type: "command.output_delta",
      },
      {
        ...baseEvent,
        itemId: "item-1",
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
        payload: { message: "模型服务不可用", willRetry: false },
        turnId: "turn-1",
        type: "provider.error",
      },
      {
        ...baseEvent,
        itemId: pendingRequest.itemId,
        payload: { request: pendingRequest },
        turnId: pendingRequest.turnId,
        type: "pending_request.created",
      },
      {
        ...baseEvent,
        itemId: pendingRequest.itemId,
        payload: { request: { ...pendingRequest, status: "resolved" } },
        turnId: pendingRequest.turnId,
        type: "pending_request.resolved",
      },
      {
        ...baseEvent,
        itemId: pendingRequest.itemId,
        payload: { request: { ...pendingRequest, status: "expired" } },
        turnId: pendingRequest.turnId,
        type: "pending_request.expired",
      },
    ];

    expect(events.every((event) => Value.Check(AgentEventSchema, event))).toBe(true);
  });

  it("validates connection control frames and snapshot checkpoints", () => {
    const ready = {
      latestSequence: 7,
      sessionId: "runtime-1",
      type: "connection.ready",
      version: 1,
    };
    const resync = {
      latestSequence: 7,
      reason: "event_retention_exceeded",
      sessionId: "runtime-1",
      type: "resync.required",
      version: 1,
    };
    const response = {
      checkpoint: { sequence: 7, sessionId: "runtime-1" },
      snapshot: {
        id: "task-1",
        pinned: false,
        pendingRequests: [pendingRequest],
        projectId: "code-agent",
        status: "idle",
        title: "实时链路",
        turns: [],
        updatedAt: "2026-07-23T00:00:00.000Z",
      },
    };

    expect(Value.Check(ConnectionReadySchema, ready)).toBe(true);
    expect(Value.Check(ResyncRequiredSchema, resync)).toBe(true);
    expect(Value.Check(EventStreamMessageSchema, ready)).toBe(true);
    expect(Value.Check(EventStreamMessageSchema, resync)).toBe(true);
    expect(Value.Check(AgentTaskSnapshotResponseSchema, response)).toBe(true);
    expect(
      Value.Check(AgentTaskSnapshotResponseSchema, {
        ...response,
        snapshot: {
          ...response.snapshot,
          pendingRequests: [{ ...pendingRequest, status: "resolved" }],
        },
      }),
    ).toBe(false);
  });

  it("rejects pending request lifecycle events with contradictory statuses", () => {
    const event = {
      ...baseEvent,
      itemId: pendingRequest.itemId,
      payload: { request: pendingRequest },
      turnId: pendingRequest.turnId,
    };

    expect(Value.Check(AgentEventSchema, { ...event, type: "pending_request.created" })).toBe(true);
    expect(Value.Check(AgentEventSchema, { ...event, type: "pending_request.resolved" })).toBe(
      false,
    );
    expect(
      Value.Check(AgentEventSchema, {
        ...event,
        payload: { request: { ...pendingRequest, status: "expired" } },
        type: "pending_request.expired",
      }),
    ).toBe(true);
    expect(
      Value.Check(AgentEventSchema, {
        ...event,
        payload: { request: { ...pendingRequest, status: "resolved" } },
        type: "pending_request.expired",
      }),
    ).toBe(false);
  });

  it("rejects invalid versions, sequences, discriminants, and extra fields", () => {
    const valid = {
      ...baseEvent,
      itemId: "item-1",
      payload: { delta: "text" },
      turnId: "turn-1",
      type: "message.delta",
    };

    expect(Value.Check(AgentEventSchema, { ...valid, sequence: -1 })).toBe(false);
    expect(Value.Check(AgentEventSchema, { ...valid, version: 2 })).toBe(false);
    expect(Value.Check(AgentEventSchema, { ...valid, type: "native.delta" })).toBe(false);
    expect(Value.Check(AgentEventSchema, { ...valid, nativeItem: {} })).toBe(false);
    expect(
      Value.Check(ResyncRequiredSchema, {
        latestSequence: 1,
        reason: "unknown",
        sessionId: "runtime-1",
        type: "resync.required",
        version: 1,
      }),
    ).toBe(false);
  });
});
