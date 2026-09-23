import type { AgentEvent, AgentTaskSnapshotResponse } from "@/protocol/index.js";
import { describe, expect, it } from "vitest";

import { createTaskStore } from "./task-store.js";

const timestamp = "2026-09-23T00:00:00Z";
const response: AgentTaskSnapshotResponse = {
  checkpoint: { sequence: 0, sessionId: "session" },
  snapshot: {
    id: "task", projectId: "project", title: "Task", pinned: false,
    updatedAt: timestamp, status: "running", pendingRequests: [],
    turns: [{ id: "turn", status: "running", startedAt: timestamp, completedAt: null, error: null, items: [] }],
    turnsNextCursor: null, contextUsage: null, goal: null, plan: null,
    settings: { approvalPolicy: "on-request", approvalsReviewer: "user", model: "model",
      reasoningEffort: "high", sandboxMode: "workspace-write" },
  },
};

const eventBase = {
  version: 2, provider: "codex", taskId: "task", sessionId: "session", timestamp,
} as const;

function warning(sequence: number, code: "runtime_warning" | "model_verification"): AgentEvent {
  return {
    ...eventBase, sequence, type: "task.notice",
    payload: { code, level: "warning", message: code },
  };
}

describe("runtime warning lifetime", () => {
  it.each([
    { type: "message.delta", itemId: "reply", payload: { text: "继续" } },
    { type: "plan.delta", itemId: "plan", payload: { text: "继续" } },
    { type: "command.output_delta", itemId: "command", payload: { delta: "继续" } },
  ] as const)("clears only runtime warnings after $type", (output) => {
    const store = createTaskStore({ projectId: "project", taskId: "task" }, response);
    store.getState().applyEvents([warning(1, "runtime_warning"), warning(2, "model_verification")]);
    expect(store.getState().notices).toHaveLength(2);

    store.getState().applyEvents([{ ...eventBase, ...output, turnId: "turn", sequence: 3 } as AgentEvent]);

    expect(store.getState().notices.map((notice) => notice.payload.code)).toEqual(["model_verification"]);
  });

  it.each(["idle", "failed"] as const)("clears runtime warnings when task becomes %s", (status) => {
    const store = createTaskStore({ projectId: "project", taskId: "task" }, response);
    store.getState().applyEvents([warning(1, "runtime_warning"), warning(2, "model_verification")]);

    store.getState().applyEvents([{
      ...eventBase, sequence: 3, type: "task.status_updated", payload: { status },
    }]);

    expect(store.getState().notices.map((notice) => notice.payload.code)).toEqual(["model_verification"]);
  });

  it("clears warnings when the turn completes", () => {
    const store = createTaskStore({ projectId: "project", taskId: "task" }, response);
    store.getState().applyEvents([warning(1, "runtime_warning")]);
    store.getState().applyEvents([{
      ...eventBase, sequence: 2, type: "turn.completed", turnId: "turn",
      payload: { turn: { ...response.snapshot.turns[0]!, status: "interrupted", completedAt: timestamp } },
    }]);
    expect(store.getState().notices).toEqual([]);
  });
});
