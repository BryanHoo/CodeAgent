import type { AgentEvent, AgentTaskSnapshotResponse, PendingRequest } from "@code-agent/protocol";
import { describe, expect, it } from "vitest";

import { AgentEventBuffer, hydrateTaskRuntime, reduceAgentEvent } from "./task-runtime.js";

const response: AgentTaskSnapshotResponse = {
  checkpoint: { sequence: 10, sessionId: "runtime-1" },
  snapshot: {
    contextUsage: null,
    id: "task-1",
    pendingRequests: [],
    pinned: false,
    projectId: "code-agent",
    status: "idle",
    title: "实时链路",
    turns: [],
    updatedAt: "2026-07-23T00:00:00.000Z",
  },
};

function envelope(sequence: number) {
  return {
    provider: "codex",
    sequence,
    sessionId: "runtime-1",
    taskId: "task-1",
    timestamp: "2026-07-23T00:00:01.000Z",
    version: 1,
  } as const;
}

describe("task runtime", () => {
  it("hydrates a snapshot and applies stream deltas by turn and item id", () => {
    let state = hydrateTaskRuntime(response);
    const started: AgentEvent = {
      ...envelope(11),
      payload: {
        turn: {
          completedAt: null,
          error: null,
          id: "turn-1",
          items: [],
          startedAt: "2026-07-23T00:00:01.000Z",
          status: "running",
        },
      },
      turnId: "turn-1",
      type: "turn.started",
    };
    const events: AgentEvent[] = [
      started,
      {
        ...envelope(12),
        itemId: "message-1",
        payload: { delta: "实时" },
        turnId: "turn-1",
        type: "message.delta",
      },
      {
        ...envelope(13),
        itemId: "message-1",
        payload: { delta: "更新" },
        turnId: "turn-1",
        type: "message.delta",
      },
      {
        ...envelope(14),
        itemId: "reasoning-1",
        payload: { delta: "分析", field: "summary" },
        turnId: "turn-1",
        type: "reasoning.delta",
      },
      {
        ...envelope(15),
        itemId: "command-1",
        payload: { delta: "Done\n" },
        turnId: "turn-1",
        type: "command.output_delta",
      },
    ];
    for (const event of events) {
      state = reduceAgentEvent(state, event);
    }

    expect(state.checkpoint.sequence).toBe(15);
    expect(state.snapshot.status).toBe("running");
    expect(state.snapshot.turns[0]?.items).toEqual([
      { id: "message-1", role: "assistant", text: "实时更新", type: "message" },
      { content: "", id: "reasoning-1", summary: "分析", type: "reasoning" },
      {
        command: "正在执行命令",
        cwd: "",
        id: "command-1",
        output: "Done\n",
        outputTruncated: false,
        status: "running",
        type: "command",
      },
    ]);
  });

  it("uses item and turn terminal events as authoritative state", () => {
    let state = reduceAgentEvent(hydrateTaskRuntime(response), {
      ...envelope(11),
      payload: {
        turn: {
          completedAt: null,
          error: null,
          id: "turn-1",
          items: [],
          startedAt: "2026-07-23T00:00:01.000Z",
          status: "running",
        },
      },
      turnId: "turn-1",
      type: "turn.started",
    });
    state = reduceAgentEvent(state, {
      ...envelope(12),
      itemId: "message-1",
      payload: { delta: "草稿" },
      turnId: "turn-1",
      type: "message.delta",
    });
    state = reduceAgentEvent(state, {
      ...envelope(13),
      itemId: "message-1",
      payload: {
        item: { id: "message-1", role: "assistant", text: "最终文本", type: "message" },
      },
      turnId: "turn-1",
      type: "item.completed",
    });
    const completed: AgentEvent = {
      ...envelope(14),
      payload: {
        turn: {
          completedAt: "2026-07-23T00:00:02.000Z",
          error: null,
          id: "turn-1",
          items: [{ id: "message-1", role: "assistant", text: "权威终态", type: "message" }],
          startedAt: "2026-07-23T00:00:01.000Z",
          status: "completed",
        },
      },
      turnId: "turn-1",
      type: "turn.completed",
    };
    state = reduceAgentEvent(state, completed);
    state = reduceAgentEvent(state, completed);

    expect(state.snapshot.status).toBe("idle");
    expect(state.snapshot.turns[0]).toEqual(completed.payload.turn);
    expect(state.checkpoint.sequence).toBe(14);
  });

  it("records non-retrying provider errors on the affected turn", () => {
    let state = hydrateTaskRuntime({
      ...response,
      snapshot: {
        ...response.snapshot,
        status: "running",
        turns: [
          {
            completedAt: null,
            error: null,
            id: "turn-1",
            items: [],
            startedAt: "2026-07-23T00:00:01.000Z",
            status: "running",
          },
        ],
      },
    });
    state = reduceAgentEvent(state, {
      ...envelope(11),
      payload: { message: "模型服务不可用", willRetry: false },
      turnId: "turn-1",
      type: "provider.error",
    });

    expect(state.snapshot.status).toBe("failed");
    expect(state.snapshot.turns[0]).toMatchObject({
      error: "模型服务不可用",
      status: "failed",
    });
  });

  it("updates current context usage from realtime events", () => {
    const state = reduceAgentEvent(hydrateTaskRuntime(response), {
      ...envelope(11),
      payload: { usage: { contextWindow: 200_000, usedTokens: 25_000 } },
      turnId: "turn-1",
      type: "usage.updated",
    });

    expect(state.snapshot.contextUsage).toEqual({ contextWindow: 200_000, usedTokens: 25_000 });
    expect(state.checkpoint.sequence).toBe(11);
  });

  it("reconciles pending request lifecycle events by request id", () => {
    const request = {
      availableDecisions: ["allow", "deny"],
      command: "pnpm check",
      createdAt: "2026-07-23T00:00:01.000Z",
      cwd: "/workspace/CodeAgent",
      expiresAt: null,
      itemId: "command-1",
      networkAccess: null,
      projectId: "code-agent",
      reason: null,
      requestId: "number:7",
      status: "pending",
      taskId: "task-1",
      turnId: "turn-1",
      type: "command_approval",
    } satisfies PendingRequest & { status: "pending" };
    let state = reduceAgentEvent(hydrateTaskRuntime(response), {
      ...envelope(11),
      itemId: request.itemId,
      payload: { request },
      turnId: request.turnId,
      type: "pending_request.created",
    });
    state = reduceAgentEvent(state, {
      ...envelope(12),
      itemId: request.itemId,
      payload: { request: { ...request, status: "resolved" } },
      turnId: request.turnId,
      type: "pending_request.resolved",
    });
    state = reduceAgentEvent(state, {
      ...envelope(12),
      itemId: request.itemId,
      payload: { request: { ...request, status: "expired" } },
      turnId: request.turnId,
      type: "pending_request.expired",
    });

    expect(state.snapshot.pendingRequests).toEqual([{ ...request, status: "resolved" }]);
    expect(state.checkpoint.sequence).toBe(12);
  });

  it("merges delta buffers and flushes earlier sequences before terminals", () => {
    const buffer = new AgentEventBuffer();
    buffer.push({
      ...envelope(11),
      itemId: "message-1",
      payload: { delta: "实时" },
      turnId: "turn-1",
      type: "message.delta",
    });
    buffer.push({
      ...envelope(12),
      itemId: "message-1",
      payload: { delta: "更新" },
      turnId: "turn-1",
      type: "message.delta",
    });
    buffer.push({
      ...envelope(13),
      itemId: "command-1",
      payload: { delta: "Done" },
      turnId: "turn-1",
      type: "command.output_delta",
    });

    expect(buffer.flushThrough(14)).toEqual([
      expect.objectContaining({ payload: { delta: "实时更新" }, sequence: 12 }),
      expect.objectContaining({ payload: { delta: "Done" }, sequence: 13 }),
    ]);
    expect(buffer.drain()).toEqual([]);
  });

  it("preserves sequence order when delta items are interleaved", () => {
    const buffer = new AgentEventBuffer();
    buffer.push({
      ...envelope(11),
      itemId: "message-1",
      payload: { delta: "第一段" },
      turnId: "turn-1",
      type: "message.delta",
    });
    buffer.push({
      ...envelope(12),
      itemId: "command-1",
      payload: { delta: "命令" },
      turnId: "turn-1",
      type: "command.output_delta",
    });
    buffer.push({
      ...envelope(13),
      itemId: "message-1",
      payload: { delta: "第二段" },
      turnId: "turn-1",
      type: "message.delta",
    });

    expect(
      buffer.drain().map((event) => ({
        itemId: "itemId" in event ? event.itemId : undefined,
        sequence: event.sequence,
      })),
    ).toEqual([
      { itemId: "message-1", sequence: 11 },
      { itemId: "command-1", sequence: 12 },
      { itemId: "message-1", sequence: 13 },
    ]);
  });

  it("keeps realtime command output within the snapshot limits", () => {
    const createRunningState = () =>
      hydrateTaskRuntime({
        ...response,
        snapshot: {
          ...response.snapshot,
          status: "running",
          turns: [
            {
              completedAt: null,
              error: null,
              id: "turn-1",
              items: [],
              startedAt: "2026-07-23T00:00:01.000Z",
              status: "running",
            },
          ],
        },
      });
    const applyOutput = (delta: string) =>
      reduceAgentEvent(createRunningState(), {
        ...envelope(11),
        itemId: "command-1",
        payload: { delta },
        turnId: "turn-1",
        type: "command.output_delta",
      });

    const lineLimited = applyOutput("line\n".repeat(10_001)).snapshot.turns[0]?.items[0];
    const byteLimited = applyOutput("实".repeat(400_000)).snapshot.turns[0]?.items[0];

    expect(lineLimited).toMatchObject({ outputTruncated: true, type: "command" });
    expect(
      lineLimited?.type === "command" ? lineLimited.output?.split("\n").length : undefined,
    ).toBeLessThanOrEqual(10_001);
    expect(byteLimited).toMatchObject({ outputTruncated: true, type: "command" });
    expect(
      byteLimited?.type === "command"
        ? new TextEncoder().encode(byteLimited.output).byteLength
        : undefined,
    ).toBeLessThanOrEqual(1_048_576);
  });

  it("does not merge adjacent deltas from different tasks", () => {
    const buffer = new AgentEventBuffer();
    buffer.push({
      ...envelope(11),
      itemId: "message-1",
      payload: { delta: "任务一" },
      turnId: "turn-1",
      type: "message.delta",
    });
    buffer.push({
      ...envelope(12),
      itemId: "message-1",
      payload: { delta: "任务二" },
      taskId: "task-2",
      turnId: "turn-1",
      type: "message.delta",
    });

    expect(
      buffer.drain().map((event) => ({ payload: event.payload, taskId: event.taskId })),
    ).toEqual([
      { payload: { delta: "任务一" }, taskId: "task-1" },
      { payload: { delta: "任务二" }, taskId: "task-2" },
    ]);
  });

  it("rejects and clears delta batches that exceed hard limits", () => {
    const countLimited = new AgentEventBuffer({ maxBytes: 100, maxEvents: 2 });
    const createDelta = (sequence: number, itemId: string, delta = "x"): AgentEvent => ({
      ...envelope(sequence),
      itemId,
      payload: { delta },
      turnId: "turn-1",
      type: "message.delta",
    });

    expect(countLimited.push(createDelta(11, "item-1"))).toBe(true);
    expect(countLimited.push(createDelta(12, "item-2"))).toBe(true);
    expect(countLimited.push(createDelta(13, "item-3"))).toBe(false);
    expect(countLimited.drain()).toEqual([]);

    const byteLimited = new AgentEventBuffer({ maxBytes: 5, maxEvents: 10 });
    expect(byteLimited.push(createDelta(11, "item-1", "实时"))).toBe(false);
    expect(byteLimited.drain()).toEqual([]);
  });
});
