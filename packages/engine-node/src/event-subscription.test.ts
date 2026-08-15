import type { EventStreamMessage } from "@code-agent/protocol";
import { describe, expect, it, vi } from "vitest";

import {
  startNodeEventSubscription,
  type NativeEventEngine,
  type NativeEventSubscription,
} from "./event-subscription.js";

const encode = (value: EventStreamMessage): Uint8Array =>
  Buffer.from(JSON.stringify(value), "utf8");

function harness(): {
  emit: (message: EventStreamMessage) => void;
  engine: NativeEventEngine;
  unsubscribe: ReturnType<typeof vi.fn>;
} {
  let receive: ((frame: Uint8Array) => void) | undefined;
  const unsubscribe = vi.fn(() => true);
  const subscription: NativeEventSubscription = { id: "subscription-1", unsubscribe };
  return {
    emit: (message) => receive?.(encode(message)),
    engine: {
      eventSubscribe: (_request, _project, _session, _sequence, callback) => {
        receive = callback;
        return subscription;
      },
    },
    unsubscribe,
  };
}

describe("startNodeEventSubscription", () => {
  it("delivers 10,000 ordered events and unsubscribes once", () => {
    const native = harness();
    const received: number[] = [];
    const stop = startNodeEventSubscription(native.engine, {
      afterSequence: 0,
      onEvent: (event) => received.push(event.sequence),
      onResyncRequired: vi.fn(),
      projectId: "project-1",
      requestId: "request-1",
      sessionId: "session-1",
    });
    native.emit({
      latestSequence: 0,
      sessionId: "session-1",
      type: "connection.ready",
      version: 2,
    });
    for (let sequence = 1; sequence <= 10_000; sequence += 1) {
      native.emit({
        payload: { code: "runtime_warning", level: "info", message: "ok" },
        provider: "codex",
        sequence,
        sessionId: "session-1",
        taskId: "task-1",
        timestamp: "2026-08-12T00:00:00.000Z",
        type: "task.notice",
        version: 2,
      });
    }
    stop();
    stop();

    expect(received).toHaveLength(10_000);
    expect(received[9_999]).toBe(10_000);
    expect(native.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("stops and requests resync on a sequence gap", () => {
    const native = harness();
    const onResyncRequired = vi.fn();
    startNodeEventSubscription(native.engine, {
      afterSequence: 0,
      onEvent: vi.fn(),
      onResyncRequired,
      projectId: "project-1",
      requestId: "request-1",
      sessionId: "session-1",
    });
    native.emit({
      latestSequence: 0,
      sessionId: "session-1",
      type: "connection.ready",
      version: 2,
    });
    native.emit({
      payload: { code: "runtime_warning", level: "warning", message: "gap" },
      provider: "codex",
      sequence: 2,
      sessionId: "session-1",
      taskId: "task-1",
      timestamp: "2026-08-12T00:00:00.000Z",
      type: "task.notice",
      version: 2,
    });

    expect(onResyncRequired).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "sequence_gap" }),
    );
    expect(native.unsubscribe).toHaveBeenCalledTimes(1);
  });
});
