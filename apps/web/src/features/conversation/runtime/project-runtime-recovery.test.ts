import type { AgentEvent, AgentTaskSnapshotResponse } from "@code-agent/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TaskEventTarget } from "./project-runtime-recovery.js";
import { createTaskStore } from "./task-store.js";

const response: AgentTaskSnapshotResponse = {
  checkpoint: { sequence: 0, sessionId: "session-performance" },
  snapshot: {
    contextUsage: null,
    id: "task-performance",
    pendingRequests: [],
    pinned: false,
    plan: null,
    projectId: "project-performance",
    settings: {
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      sandboxMode: "workspace-write",
    },
    status: "running",
    title: "Performance",
    turns: [
      {
        completedAt: null,
        error: null,
        id: "turn-performance",
        items: [
          {
            id: "message-performance",
            role: "assistant",
            text: "",
            type: "message",
          },
        ],
        startedAt: "2026-08-14T00:00:00.000Z",
        status: "running",
      },
    ],
    updatedAt: "2026-08-14T00:00:00.000Z",
  },
};

function delta(sequence: number): AgentEvent {
  return {
    itemId: "message-performance",
    payload: { delta: "x" },
    provider: "codex",
    sequence,
    sessionId: "session-performance",
    taskId: "task-performance",
    timestamp: "2026-08-14T00:00:00.000Z",
    turnId: "turn-performance",
    type: "message.delta",
    version: 2,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TaskEventTarget performance samples", () => {
  it("records every sequence after the animation-frame store commit", () => {
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frame = callback;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const samples: { point: string; sequence: number }[] = [];
    const store = createTaskStore(
      { projectId: "project-performance", taskId: "task-performance" },
      response,
    );
    const target = new TaskEventTarget(
      store,
      () => Promise.resolve(response),
      vi.fn(),
      (sample) => samples.push(sample),
    );

    target.apply(delta(1));
    target.apply(delta(2));
    expect(samples).toEqual([]);
    frame?.(16);

    expect(store.getState().checkpoint?.sequence).toBe(2);
    expect(samples).toEqual([expect.objectContaining({ point: "store_committed", sequence: 2 })]);
  });
});
