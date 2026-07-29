import type {
  AgentEvent,
  AgentTaskSnapshot,
  AgentTaskSnapshotResponse,
  AgentTurn,
} from "@code-agent/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CodeAgentRuntimeClient } from "../../projects/project-queries.js";
import { getTaskActivity } from "./task-activity.js";
import { createProjectRuntimeManager } from "./project-runtime.js";
import { createTaskStore } from "./task-store.js";

const taskSettings = {
  approvalPolicy: "on-request",
  model: "gpt-5.6-sol",
  reasoningEffort: "high",
  sandboxMode: "workspace-write",
} as const;

function createTurn(taskId: string, status: AgentTurn["status"] = "running"): AgentTurn {
  return {
    completedAt: status === "running" ? null : "2026-07-28T00:00:01.000Z",
    error: null,
    id: `turn-${taskId}`,
    items: [],
    startedAt: "2026-07-28T00:00:00.000Z",
    status,
  };
}

function createSnapshotResponse(
  taskId: string,
  options: Readonly<{
    pendingRequests?: AgentTaskSnapshot["pendingRequests"];
    sequence?: number;
    sessionId?: string;
    status?: AgentTaskSnapshot["status"];
  }> = {},
): AgentTaskSnapshotResponse {
  const status = options.status ?? "running";
  return {
    checkpoint: { sequence: options.sequence ?? 0, sessionId: options.sessionId ?? "runtime-1" },
    snapshot: {
      contextUsage: null,
      id: taskId,
      pendingRequests: options.pendingRequests ?? [],
      pinned: false,
      projectId: "project-1",
      settings: taskSettings,
      status,
      title: taskId,
      turns: status === "running" ? [createTurn(taskId)] : [],
      updatedAt: "2026-07-28T00:00:00.000Z",
    },
  };
}

function createTurnCompletedEvent(taskId: string, sequence: number): AgentEvent {
  return {
    payload: { turn: createTurn(taskId, "completed") },
    provider: "codex",
    sequence,
    sessionId: "runtime-1",
    taskId,
    timestamp: "2026-07-28T00:00:01.000Z",
    turnId: `turn-${taskId}`,
    type: "turn.completed",
    version: 2,
  };
}

function createTurnStartedEvent(taskId: string, sequence: number): AgentEvent {
  return {
    payload: { turn: createTurn(taskId) },
    provider: "codex",
    sequence,
    sessionId: "runtime-1",
    taskId,
    timestamp: "2026-07-28T00:00:01.000Z",
    turnId: `turn-${taskId}`,
    type: "turn.started",
    version: 2,
  };
}

function createClientHarness() {
  let subscription: Parameters<CodeAgentRuntimeClient["subscribeEvents"]>[0] | undefined;
  const closeConnection = vi.fn();
  const client = {
    readTask: vi.fn<CodeAgentRuntimeClient["readTask"]>(),
    subscribeEvents: vi.fn<CodeAgentRuntimeClient["subscribeEvents"]>((options) => {
      subscription = options;
      return closeConnection;
    }),
    unsubscribeTask: vi.fn<CodeAgentRuntimeClient["unsubscribeTask"]>((_, taskId) =>
      Promise.resolve({
        status: "unsubscribed",
        taskId,
      }),
    ),
  } satisfies CodeAgentRuntimeClient;

  return {
    client,
    closeConnection,
    emit(event: AgentEvent) {
      if (subscription === undefined) {
        throw new Error("Project event subscription has not started");
      }
      subscription.onEvent(event);
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("project runtime manager", () => {
  it("opens one Project connection and fans events out to Activity and matching Task stores", () => {
    const harness = createClientHarness();
    const manager = createProjectRuntimeManager(harness.client);
    const firstResponse = createSnapshotResponse("task-1");
    const secondResponse = createSnapshotResponse("task-2");
    const firstStore = createTaskStore({ projectId: "project-1", taskId: "task-1" });
    const secondStore = createTaskStore({ projectId: "project-1", taskId: "task-2" });

    const detachFirst = manager.attachTaskStore(firstResponse, firstStore, vi.fn());
    const detachSecond = manager.attachTaskStore(secondResponse, secondStore, vi.fn());

    expect(harness.client.subscribeEvents).toHaveBeenCalledTimes(1);
    harness.emit(createTurnCompletedEvent("task-1", 1));

    expect(getTaskActivity(manager.getTaskActivity(), "project-1", "task-1")).toEqual({
      isAwaitingApproval: false,
      isRunning: false,
    });
    expect(firstStore.getState().snapshotMetadata?.status).toBe("idle");
    expect(firstStore.getState().checkpoint?.sequence).toBe(1);
    expect(secondStore.getState().snapshotMetadata?.status).toBe("running");

    detachFirst();
    detachSecond();
    manager.dispose();
  });

  it("releases an inactive Project only after its idle timeout", () => {
    vi.useFakeTimers();
    const harness = createClientHarness();
    const manager = createProjectRuntimeManager(harness.client, { idleTimeoutMs: 1_000 });

    manager.observeSnapshot(createSnapshotResponse("task-1", { status: "idle" }));
    vi.advanceTimersByTime(999);
    expect(harness.closeConnection).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(harness.closeConnection).toHaveBeenCalledTimes(1);
    manager.dispose();
  });

  it("keeps a running Project connected until its terminal event", () => {
    vi.useFakeTimers();
    const harness = createClientHarness();
    const manager = createProjectRuntimeManager(harness.client, { idleTimeoutMs: 1_000 });

    manager.observeSnapshot(createSnapshotResponse("task-1"));
    vi.advanceTimersByTime(10_000);
    expect(harness.closeConnection).not.toHaveBeenCalled();

    harness.emit(createTurnCompletedEvent("task-1", 1));
    vi.runOnlyPendingTimers();
    expect(harness.closeConnection).toHaveBeenCalledTimes(1);
    manager.dispose();
  });

  it("keeps an approval-blocked Project connected until the request resolves", () => {
    vi.useFakeTimers();
    const harness = createClientHarness();
    const manager = createProjectRuntimeManager(harness.client, { idleTimeoutMs: 1_000 });
    const pendingRequest: AgentTaskSnapshot["pendingRequests"][number] = {
      availableDecisions: ["allow", "deny"],
      command: "pnpm check",
      createdAt: "2026-07-28T00:00:00.000Z",
      cwd: "/workspace/CodeAgent",
      expiresAt: null,
      itemId: "item-approval",
      networkAccess: null,
      projectId: "project-1",
      reason: null,
      requestId: "approval-1",
      status: "pending",
      taskId: "task-1",
      turnId: "turn-task-1",
      type: "command_approval",
    };

    manager.observeSnapshot(
      createSnapshotResponse("task-1", { pendingRequests: [pendingRequest], status: "idle" }),
    );
    vi.advanceTimersByTime(10_000);
    expect(harness.closeConnection).not.toHaveBeenCalled();

    harness.emit({
      itemId: pendingRequest.itemId,
      payload: { request: { ...pendingRequest, status: "resolved" } },
      provider: "codex",
      sequence: 1,
      sessionId: "runtime-1",
      taskId: "task-1",
      timestamp: "2026-07-28T00:00:01.000Z",
      turnId: pendingRequest.turnId,
      type: "pending_request.resolved",
      version: 2,
    });
    vi.runOnlyPendingTimers();
    expect(harness.closeConnection).toHaveBeenCalledTimes(1);
    manager.dispose();
  });

  it("replays Project events that arrived while a Task Snapshot was loading", () => {
    const harness = createClientHarness();
    const manager = createProjectRuntimeManager(harness.client);
    manager.observeSnapshot(createSnapshotResponse("task-1", { status: "idle" }));
    harness.emit(createTurnStartedEvent("task-2", 1));
    const secondStore = createTaskStore({ projectId: "project-1", taskId: "task-2" });

    const detach = manager.attachTaskStore(
      createSnapshotResponse("task-2", { status: "idle" }),
      secondStore,
      vi.fn(),
    );

    expect(harness.client.subscribeEvents).toHaveBeenCalledTimes(1);
    expect(secondStore.getState().snapshotMetadata?.status).toBe("running");
    expect(secondStore.getState().checkpoint?.sequence).toBe(1);
    detach();
    manager.dispose();
  });

  it("refreshes stores that still belong to an earlier Project Session", () => {
    const harness = createClientHarness();
    const manager = createProjectRuntimeManager(harness.client);
    const firstStore = createTaskStore({ projectId: "project-1", taskId: "task-1" });
    const secondStore = createTaskStore({ projectId: "project-1", taskId: "task-2" });
    const recoverFirst = vi.fn();
    const recoverSecond = vi.fn();

    const detachFirst = manager.attachTaskStore(
      createSnapshotResponse("task-1"),
      firstStore,
      recoverFirst,
    );
    const detachSecond = manager.attachTaskStore(
      createSnapshotResponse("task-2", { sessionId: "runtime-2" }),
      secondStore,
      recoverSecond,
    );

    expect(harness.client.subscribeEvents).toHaveBeenCalledTimes(2);
    expect(recoverFirst).toHaveBeenCalledTimes(1);
    expect(recoverSecond).not.toHaveBeenCalled();
    expect(firstStore.getState().connectionState).toBe("reconnecting");

    detachFirst();
    detachSecond();
    manager.dispose();
  });
});
