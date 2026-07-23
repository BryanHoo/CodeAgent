import { describe, expect, it, vi } from "vitest";

import { AgentEventStream } from "./agent-event-stream.js";

const deltaEvent = {
  itemId: "item-1",
  payload: { delta: "实时" },
  taskId: "task-1",
  turnId: "turn-1",
  type: "message.delta",
} as const;

describe("AgentEventStream", () => {
  it("assigns monotonic sequences and publishes to active subscribers", () => {
    const stream = new AgentEventStream({
      capacity: 3,
      now: () => new Date("2026-07-23T00:00:00.000Z"),
      provider: "codex",
      sessionId: "runtime-1",
    });
    const listener = vi.fn();
    const unsubscribe = stream.subscribe(listener);

    const first = stream.publish(deltaEvent);
    const second = stream.publish({ ...deltaEvent, payload: { delta: "完成" } });
    unsubscribe();
    stream.publish({ ...deltaEvent, payload: { delta: "取消后" } });

    expect(first).toMatchObject({
      provider: "codex",
      sequence: 1,
      sessionId: "runtime-1",
      timestamp: "2026-07-23T00:00:00.000Z",
      version: 1,
    });
    expect(second.sequence).toBe(2);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(stream.checkpoint).toEqual({ sequence: 3, sessionId: "runtime-1" });
  });

  it("replays retained events and requires resync outside the bounded window", () => {
    const stream = new AgentEventStream({
      capacity: 2,
      provider: "codex",
      sessionId: "runtime-1",
    });
    stream.publish({ ...deltaEvent, payload: { delta: "1" } });
    stream.publish({ ...deltaEvent, payload: { delta: "2" } });
    stream.publish({ ...deltaEvent, payload: { delta: "3" } });

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
  });
});
