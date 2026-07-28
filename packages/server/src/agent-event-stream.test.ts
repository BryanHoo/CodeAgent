import type { AgentEvent } from "@code-agent/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentEventStream } from "./agent-event-stream.js";

const deltaEvent = {
  itemId: "item-1",
  payload: { delta: "实时" },
  taskId: "task-1",
  turnId: "turn-1",
  type: "message.delta",
} as const;

afterEach(() => {
  vi.useRealTimers();
});

describe("AgentEventStream", () => {
  it("coalesces matching deltas before assigning a sequence", () => {
    vi.useFakeTimers();
    const stream = new AgentEventStream({
      now: () => new Date("2026-07-23T00:00:00.000Z"),
      provider: "codex",
      sessionId: "runtime-1",
    });
    const listener = vi.fn<(event: AgentEvent) => void>();
    stream.subscribe(listener);

    stream.publish(deltaEvent);
    stream.publish({ ...deltaEvent, payload: { delta: "更新" } });

    expect(listener).not.toHaveBeenCalled();
    vi.advanceTimersByTime(15);
    expect(listener).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith({
      ...deltaEvent,
      payload: { delta: "实时更新" },
      provider: "codex",
      sequence: 1,
      sessionId: "runtime-1",
      timestamp: "2026-07-23T00:00:00.000Z",
      version: 1,
    });
    expect(stream.metrics).toEqual({
      backpressureSignals: 0,
      coalescedEvents: 1,
      pendingDeltas: 0,
      providerEventsReceived: 2,
      publishedEvents: 1,
      retainedEvents: 1,
      retentionEvictions: 0,
    });
  });

  it("uses the pressure window for the next delta batch", () => {
    vi.useFakeTimers();
    const stream = new AgentEventStream({ provider: "codex", sessionId: "runtime-1" });
    const listener = vi.fn<(event: AgentEvent) => void>();
    stream.subscribe(listener);

    stream.noteBackpressure();
    stream.publish(deltaEvent);
    vi.advanceTimersByTime(31);
    expect(listener).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(listener).toHaveBeenCalledOnce();
    expect(stream.metrics.backpressureSignals).toBe(1);
  });

  it("keeps reasoning fields separate and flushes deltas before terminal events", () => {
    vi.useFakeTimers();
    const stream = new AgentEventStream({ provider: "codex", sessionId: "runtime-1" });
    const listener = vi.fn<(event: AgentEvent) => void>();
    stream.subscribe(listener);
    const reasoningDelta = {
      itemId: "reasoning-1",
      payload: { delta: "摘要", field: "summary" as const },
      taskId: "task-1",
      turnId: "turn-1",
      type: "reasoning.delta" as const,
    };

    stream.publish(reasoningDelta);
    stream.publish({
      ...reasoningDelta,
      payload: { delta: "正文", field: "content" },
    });
    stream.publish({
      itemId: "reasoning-1",
      payload: {
        item: { content: "正文", id: "reasoning-1", summary: "完成", type: "reasoning" },
      },
      taskId: "task-1",
      turnId: "turn-1",
      type: "item.completed",
    });

    expect(listener).toHaveBeenCalledTimes(3);
    expect(listener.mock.calls.map(([event]) => event)).toMatchObject([
      { payload: { delta: "摘要", field: "summary" }, sequence: 1 },
      { payload: { delta: "正文", field: "content" }, sequence: 2 },
      { sequence: 3, type: "item.completed" },
    ]);
  });

  it("flushes pending deltas at checkpoint and stops publishing after unsubscribe", () => {
    vi.useFakeTimers();
    const stream = new AgentEventStream({
      capacity: 3,
      provider: "codex",
      sessionId: "runtime-1",
    });
    const listener = vi.fn<(event: AgentEvent) => void>();
    const unsubscribe = stream.subscribe(listener);

    stream.publish(deltaEvent);
    expect(stream.checkpoint).toEqual({ sequence: 1, sessionId: "runtime-1" });
    unsubscribe();
    stream.publish({ ...deltaEvent, payload: { delta: "取消后" } });
    vi.advanceTimersByTime(16);

    expect(listener).toHaveBeenCalledOnce();
    expect(stream.checkpoint).toEqual({ sequence: 2, sessionId: "runtime-1" });
  });

  it("replays ring-buffered events and requires resync outside the bounded window", () => {
    vi.useFakeTimers();
    const stream = new AgentEventStream({
      capacity: 2,
      provider: "codex",
      sessionId: "runtime-1",
    });
    stream.publish({ ...deltaEvent, itemId: "item-1", payload: { delta: "1" } });
    vi.advanceTimersByTime(16);
    stream.publish({ ...deltaEvent, itemId: "item-2", payload: { delta: "2" } });
    vi.advanceTimersByTime(16);
    stream.publish({ ...deltaEvent, itemId: "item-3", payload: { delta: "3" } });

    expect(stream.replayAfter(1)).toMatchObject({
      events: [{ sequence: 2 }, { sequence: 3 }],
      type: "events",
    });
    expect(stream.replayAfter(0)).toEqual({
      latestSequence: 3,
      reason: "event_retention_exceeded",
      type: "resync",
    });
    expect(stream.replayAfter(4)).toEqual({
      latestSequence: 3,
      reason: "session_changed",
      type: "resync",
    });
    expect(stream.metrics).toMatchObject({ retainedEvents: 2, retentionEvictions: 1 });
  });
});
