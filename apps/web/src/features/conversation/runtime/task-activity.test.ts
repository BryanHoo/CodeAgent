import type { AgentEvent, AgentTaskSnapshot, AgentTurn } from "@code-agent/protocol";
import { describe, expect, it } from "vitest";

import {
  getTaskActivity,
  recordTaskActivitySnapshot,
  reduceTaskActivityEvent,
  type TaskActivityMap,
} from "./task-activity.js";

const taskSettings = {
  approvalPolicy: "on-request",
  model: "gpt-5.6-sol",
  reasoningEffort: "high",
  sandboxMode: "workspace-write",
} as const;

function createSnapshot(
  taskId: string,
  status: AgentTaskSnapshot["status"],
  pendingRequests: AgentTaskSnapshot["pendingRequests"] = [],
): AgentTaskSnapshot {
  return {
    contextUsage: null,
    id: taskId,
    pendingRequests,
    pinned: false,
    projectId: "code-agent",
    settings: taskSettings,
    status,
    title: taskId,
    turns: [],
    updatedAt: "2026-07-27T00:00:00.000Z",
  };
}

function createTurnEvent(taskId: string, type: "turn.completed" | "turn.started"): AgentEvent {
  const eventEnvelope = {
    provider: "codex",
    sequence: type === "turn.started" ? 1 : 2,
    sessionId: "runtime-1",
    taskId,
    timestamp: "2026-07-27T00:00:00.000Z",
    turnId: `turn-${taskId}`,
    version: 2,
  } as const;
  const turn = {
    completedAt: null,
    error: null,
    id: `turn-${taskId}`,
    items: [] as AgentTurn["items"],
    startedAt: "2026-07-27T00:00:00.000Z",
  };
  return type === "turn.started"
    ? { ...eventEnvelope, payload: { turn: { ...turn, status: "running" } }, type: "turn.started" }
    : {
        ...eventEnvelope,
        payload: {
          turn: {
            ...turn,
            completedAt: "2026-07-27T00:00:01.000Z",
            status: "completed",
          },
        },
        type: "turn.completed",
      };
}

function createApprovalRequest(requestId: string): AgentTaskSnapshot["pendingRequests"][number] {
  return {
    availableDecisions: ["allow", "deny"],
    command: "pnpm check",
    createdAt: "2026-07-27T00:00:00.000Z",
    cwd: "/workspace/CodeAgent",
    expiresAt: null,
    itemId: `item-${requestId}`,
    networkAccess: null,
    projectId: "code-agent",
    reason: null,
    requestId,
    status: "pending",
    taskId: "task-a",
    turnId: "turn-task-a",
    type: "command_approval",
  };
}

describe("task activity registry", () => {
  it("keeps a running task visible when another task becomes active", () => {
    let activity: TaskActivityMap = new Map();
    activity = recordTaskActivitySnapshot(activity, createSnapshot("task-a", "running"));
    activity = recordTaskActivitySnapshot(activity, createSnapshot("task-b", "idle"));

    expect(getTaskActivity(activity, "code-agent", "task-a").isRunning).toBe(true);
    expect(getTaskActivity(activity, "code-agent", "task-b").isRunning).toBe(false);

    activity = reduceTaskActivityEvent(
      activity,
      "code-agent",
      createTurnEvent("task-b", "turn.started"),
    );

    expect(getTaskActivity(activity, "code-agent", "task-a").isRunning).toBe(true);
    expect(getTaskActivity(activity, "code-agent", "task-b").isRunning).toBe(true);
  });

  it("clears only the task that receives a terminal event", () => {
    let activity: TaskActivityMap = new Map();
    activity = recordTaskActivitySnapshot(activity, createSnapshot("task-a", "running"));
    activity = recordTaskActivitySnapshot(activity, createSnapshot("task-b", "running"));

    activity = reduceTaskActivityEvent(
      activity,
      "code-agent",
      createTurnEvent("task-a", "turn.completed"),
    );

    expect(getTaskActivity(activity, "code-agent", "task-a").isRunning).toBe(false);
    expect(getTaskActivity(activity, "code-agent", "task-b").isRunning).toBe(true);
  });

  it("tracks multiple approval requests independently", () => {
    const firstRequest = createApprovalRequest("approval-1");
    const secondRequest = createApprovalRequest("approval-2");
    let activity: TaskActivityMap = new Map();
    activity = recordTaskActivitySnapshot(
      activity,
      createSnapshot("task-a", "running", [firstRequest, secondRequest]),
    );

    const resolvedEvent = {
      itemId: firstRequest.itemId,
      payload: { request: { ...firstRequest, status: "resolved" } },
      provider: "codex",
      sequence: 3,
      sessionId: "runtime-1",
      taskId: "task-a",
      timestamp: "2026-07-27T00:00:01.000Z",
      turnId: firstRequest.turnId,
      type: "pending_request.resolved",
      version: 2,
    } as const satisfies AgentEvent;

    activity = reduceTaskActivityEvent(activity, "code-agent", resolvedEvent);

    expect(getTaskActivity(activity, "code-agent", "task-a").isAwaitingApproval).toBe(true);
  });
});
