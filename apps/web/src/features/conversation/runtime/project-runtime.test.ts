import type {
  AgentEvent,
  AgentTaskSnapshot,
  AgentTaskSnapshotResponse,
  AgentTurn,
} from "@code-agent/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CodeAgentRuntimeClient } from "../../projects/project-queries.js";
import type { TaskNotifier } from "../../notifications/browser-task-notifier.js";
import { estimateRetainedBytes } from "../../../shared/memory/byte-lru.js";
import { getTaskActivity } from "./task-activity.js";
import { createProjectRuntimeManager, ProjectEventHistory } from "./project-runtime.js";
import { createTaskStore } from "./task-store.js";

const taskSettings = {
  approvalPolicy: "on-request",
  approvalsReviewer: "user",
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
    title?: string;
  }> = {},
): AgentTaskSnapshotResponse {
  const status = options.status ?? "running";
  return {
    checkpoint: { sequence: options.sequence ?? 0, sessionId: options.sessionId ?? "runtime-1" },
    snapshot: {
      contextUsage: null,
      plan: null,
      id: taskId,
      pendingRequests: options.pendingRequests ?? [],
      pinned: false,
      projectId: "project-1",
      settings: taskSettings,
      status,
      title: options.title ?? taskId,
      turns: status === "running" ? [createTurn(taskId)] : [],
      updatedAt: "2026-07-28T00:00:00.000Z",
    },
  };
}

function createTurnCompletedEvent(
  taskId: string,
  sequence: number,
  status: Extract<AgentTurn["status"], "completed" | "failed" | "interrupted"> = "completed",
): AgentEvent {
  return {
    payload: { turn: createTurn(taskId, status) },
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

function createMessageDeltaEvent(taskId: string, sequence: number, delta: string): AgentEvent {
  return {
    itemId: `message-${taskId}`,
    payload: { delta },
    provider: "codex",
    sequence,
    sessionId: "runtime-1",
    taskId,
    timestamp: "2026-07-28T00:00:01.000Z",
    turnId: `turn-${taskId}`,
    type: "message.delta",
    version: 2,
  };
}

function createFileChangeCompletedEvent(taskId: string, sequence: number): AgentEvent {
  return {
    itemId: `file-change-${taskId}`,
    payload: {
      item: {
        changes: [{ diff: "+changed", kind: "update", path: "src/app.ts" }],
        id: `file-change-${taskId}`,
        status: "completed",
        type: "file_change",
      },
    },
    provider: "codex",
    sequence,
    sessionId: "runtime-1",
    taskId,
    timestamp: "2026-07-28T00:00:01.000Z",
    turnId: `turn-${taskId}`,
    type: "item.completed",
    version: 2,
  };
}

function createMcpServerStatusUpdatedEvent(taskId: string, sequence: number): AgentEvent {
  return {
    payload: {
      error: null,
      failureReason: null,
      name: "context7",
      status: "ready",
    },
    provider: "codex",
    sequence,
    sessionId: "runtime-1",
    taskId,
    timestamp: "2026-07-28T00:00:01.000Z",
    type: "mcp_server.status_updated",
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
    connectionState(
      state: Parameters<
        NonNullable<Parameters<CodeAgentRuntimeClient["subscribeEvents"]>[0]["onConnectionState"]>
      >[0],
    ) {
      if (subscription === undefined) {
        throw new Error("Project event subscription has not started");
      }
      const onConnectionState = subscription.onConnectionState;
      if (onConnectionState === undefined) {
        throw new Error("Project event subscription does not observe connection state");
      }
      onConnectionState(state);
    },
    connectionError(error: Error) {
      if (subscription === undefined) {
        throw new Error("Project event subscription has not started");
      }
      subscription.onError?.(error);
    },
    emit(event: AgentEvent) {
      if (subscription === undefined) {
        throw new Error("Project event subscription has not started");
      }
      subscription.onEvent(event);
    },
    requireResync() {
      if (subscription === undefined) {
        throw new Error("Project event subscription has not started");
      }
      subscription.onResyncRequired({
        latestSequence: 8,
        reason: "event_retention_exceeded",
        sessionId: "runtime-1",
        type: "resync.required",
        version: 3,
      });
    },
  };
}

function createTaskNotifier() {
  return {
    notify: vi.fn<TaskNotifier["notify"]>(),
    requestPermission: vi.fn<TaskNotifier["requestPermission"]>(() => Promise.resolve()),
  } satisfies TaskNotifier;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("project runtime manager", () => {
  it("forwards permission requests and Project events to the task notifier once", async () => {
    const harness = createClientHarness();
    const taskNotifier = createTaskNotifier();
    const manager = createProjectRuntimeManager(harness.client, { taskNotifier });
    manager.observeSnapshot(createSnapshotResponse("task-1", { title: "初始任务名称" }));
    manager.rememberTaskTitles([{ id: "task-1", projectId: "project-1", title: "完善通知功能" }]);

    await manager.requestNotificationPermission();
    harness.emit(createTurnCompletedEvent("task-1", 1));

    expect(taskNotifier.requestPermission).toHaveBeenCalledOnce();
    expect(taskNotifier.notify).toHaveBeenCalledOnce();
    expect(taskNotifier.notify).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({ taskId: "task-1", type: "turn.completed" }),
      "完善通知功能",
    );
    manager.dispose();
  });

  it("logs browser notification isolation failures without interrupting Project events", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const harness = createClientHarness();
    const taskNotifier = createTaskNotifier();
    taskNotifier.requestPermission.mockRejectedValueOnce(new Error("permission API failed"));
    taskNotifier.notify.mockImplementationOnce(() => {
      throw new Error("notification constructor failed");
    });
    const manager = createProjectRuntimeManager(harness.client, { taskNotifier });
    manager.observeSnapshot(createSnapshotResponse("task-1"));

    await manager.requestNotificationPermission();
    harness.emit(createTurnCompletedEvent("task-1", 1));

    expect(warn).toHaveBeenCalledWith("CodeAgent internal warning", {
      diagnosticCode: "notification_permission_failed",
      errorMessage: "permission API failed",
    });
    expect(warn).toHaveBeenCalledWith("CodeAgent internal warning", {
      diagnosticCode: "task_notification_failed",
      errorMessage: "notification constructor failed",
      projectId: "project-1",
      taskId: "task-1",
    });
    expect(getTaskActivity(manager.getTaskActivity(), "project-1", "task-1").attention).toBe(
      "completed",
    );
    manager.dispose();
    warn.mockRestore();
  });

  it("logs realtime transport failures without publishing them as Task errors", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const harness = createClientHarness();
    const manager = createProjectRuntimeManager(harness.client);
    const store = createTaskStore({ projectId: "project-1", taskId: "task-1" });
    const detach = manager.attachTaskStore(createSnapshotResponse("task-1"), store, vi.fn());

    harness.connectionError(new Error("socket failed"));

    expect(store.getState().error).toBeNull();
    expect(warn).toHaveBeenCalledWith("CodeAgent internal warning", {
      diagnosticCode: "event_connection_failed",
      errorMessage: "socket failed",
      projectId: "project-1",
    });
    detach();
    manager.dispose();
  });

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
      attention: "completed",
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

  it("clears attention when a task is viewed and only records later background events", () => {
    const harness = createClientHarness();
    const manager = createProjectRuntimeManager(harness.client);
    manager.observeSnapshot(createSnapshotResponse("task-1"));

    harness.emit(createTurnCompletedEvent("task-1", 1));
    expect(getTaskActivity(manager.getTaskActivity(), "project-1", "task-1").attention).toBe(
      "completed",
    );

    manager.viewTask("project-1", "task-1");
    expect(getTaskActivity(manager.getTaskActivity(), "project-1", "task-1").attention).toBeNull();

    manager.viewTask("project-1", "task-2");
    harness.emit(createTurnStartedEvent("task-1", 2));
    harness.emit(createTurnCompletedEvent("task-1", 3));
    expect(getTaskActivity(manager.getTaskActivity(), "project-1", "task-1").attention).toBe(
      "completed",
    );
    manager.dispose();
  });

  it("requests task metadata refresh when a background turn completes", () => {
    const harness = createClientHarness();
    const onTaskMetadataChanged = vi.fn();
    const manager = createProjectRuntimeManager(harness.client, { onTaskMetadataChanged });
    manager.observeSnapshot(createSnapshotResponse("task-1", { title: "新聊天" }));
    manager.viewTask("project-1", "task-2");

    harness.emit(createTurnCompletedEvent("task-1", 1));

    expect(onTaskMetadataChanged).toHaveBeenCalledOnce();
    expect(onTaskMetadataChanged).toHaveBeenCalledWith("project-1", "task-1", "turn_completed");
    manager.dispose();
  });

  it("applies native task state and project cache invalidation events", () => {
    const harness = createClientHarness();
    const onSkillsChanged = vi.fn();
    const onQueueChanged = vi.fn();
    const onTaskMetadataChanged = vi.fn();
    const onTaskRemoved = vi.fn();
    const manager = createProjectRuntimeManager(harness.client, {
      onSkillsChanged,
      onQueueChanged,
      onTaskMetadataChanged,
      onTaskRemoved,
    });
    manager.observeSnapshot(createSnapshotResponse("task-1", { status: "idle" }));

    const envelope = {
      provider: "codex",
      sessionId: "runtime-1",
      timestamp: "2026-07-28T00:00:01.000Z",
      version: 2,
    } as const;
    harness.emit({
      ...envelope,
      payload: { status: "running" },
      sequence: 1,
      taskId: "task-1",
      type: "task.status_updated",
    });
    expect(getTaskActivity(manager.getTaskActivity(), "project-1", "task-1").isRunning).toBe(true);
    harness.emit({
      ...envelope,
      payload: {},
      sequence: 2,
      taskId: "task-1",
      type: "task.metadata_changed",
    });
    harness.emit({
      ...envelope,
      payload: {},
      sequence: 3,
      taskId: "project-1",
      type: "skills.changed",
    });
    harness.emit({
      ...envelope,
      payload: {},
      sequence: 4,
      taskId: "task-1",
      type: "queue.changed",
    });
    harness.emit({
      ...envelope,
      payload: { reason: "deleted" },
      sequence: 5,
      taskId: "task-1",
      type: "task.removed",
    });

    expect(onTaskMetadataChanged).toHaveBeenCalledWith(
      "project-1",
      "task-1",
      "native_notification",
    );
    expect(onSkillsChanged).toHaveBeenCalledWith("project-1");
    expect(onQueueChanged).toHaveBeenCalledWith("project-1", "task-1");
    expect(onTaskRemoved).toHaveBeenCalledWith("project-1", "task-1");
    manager.dispose();
  });

  it("reports optimistic and realtime Project Git activity", () => {
    const harness = createClientHarness();
    const onProjectGitActivity = vi.fn();
    const manager = createProjectRuntimeManager(harness.client, { onProjectGitActivity });
    manager.observeSnapshot(createSnapshotResponse("task-1"));

    manager.markTaskRunning("project-1", "task-optimistic");
    harness.emit(createTurnStartedEvent("task-1", 1));
    harness.emit(createFileChangeCompletedEvent("task-1", 2));
    harness.emit(createTurnCompletedEvent("task-1", 3));

    expect(onProjectGitActivity.mock.calls).toEqual([
      ["project-1", "task-1", "turn_started"],
      ["project-1", "task-optimistic", "turn_started"],
      ["project-1", "task-1", "turn_started"],
      ["project-1", "task-1", "file_changed"],
      ["project-1", "task-1", "turn_completed"],
    ]);
    manager.dispose();
  });

  it("reports MCP status changes for only the event task", () => {
    const harness = createClientHarness();
    const onMcpServerStatusChanged = vi.fn();
    const manager = createProjectRuntimeManager(harness.client, { onMcpServerStatusChanged });
    manager.observeSnapshot(createSnapshotResponse("task-1"));

    harness.emit(createMcpServerStatusUpdatedEvent("task-1", 1));

    expect(onMcpServerStatusChanged).toHaveBeenCalledOnce();
    expect(onMcpServerStatusChanged).toHaveBeenCalledWith("project-1", "task-1");
    manager.dispose();
  });

  it("reports Project Git activity when a Snapshot changes running state", () => {
    const harness = createClientHarness();
    const onProjectGitActivity = vi.fn();
    const manager = createProjectRuntimeManager(harness.client, { onProjectGitActivity });

    manager.observeSnapshot(createSnapshotResponse("task-1"));
    manager.observeSnapshot(createSnapshotResponse("task-1"));
    manager.observeSnapshot(createSnapshotResponse("task-1", { status: "idle" }));
    manager.observeSnapshot(createSnapshotResponse("task-1", { status: "idle" }));

    expect(onProjectGitActivity.mock.calls).toEqual([
      ["project-1", "task-1", "turn_started"],
      ["project-1", "task-1", "turn_completed"],
    ]);
    manager.dispose();
  });

  it("requests one task metadata refresh when a background assistant reply starts", () => {
    const harness = createClientHarness();
    const onTaskMetadataChanged = vi.fn();
    const manager = createProjectRuntimeManager(harness.client, { onTaskMetadataChanged });
    manager.observeSnapshot(createSnapshotResponse("task-1", { title: "新聊天" }));
    manager.viewTask("project-1", "task-2");

    harness.emit(createMessageDeltaEvent("task-1", 1, "正在"));
    harness.emit(createMessageDeltaEvent("task-1", 2, "回复"));

    expect(onTaskMetadataChanged).toHaveBeenCalledOnce();
    expect(onTaskMetadataChanged).toHaveBeenCalledWith(
      "project-1",
      "task-1",
      "assistant_reply_started",
    );
    manager.dispose();
  });

  it("does not create attention for terminal events on the viewed task", () => {
    const harness = createClientHarness();
    const manager = createProjectRuntimeManager(harness.client);
    manager.observeSnapshot(createSnapshotResponse("task-1"));
    manager.viewTask("project-1", "task-1");

    harness.emit(createTurnCompletedEvent("task-1", 1));

    expect(getTaskActivity(manager.getTaskActivity(), "project-1", "task-1").attention).toBeNull();
    manager.dispose();
  });

  it("records an interrupted background reply until the task is viewed", () => {
    const harness = createClientHarness();
    const manager = createProjectRuntimeManager(harness.client);
    manager.observeSnapshot(createSnapshotResponse("task-1"));

    harness.emit(createTurnCompletedEvent("task-1", 1, "interrupted"));
    expect(getTaskActivity(manager.getTaskActivity(), "project-1", "task-1").attention).toBe(
      "failed",
    );

    manager.viewTask("project-1", "task-1");
    expect(getTaskActivity(manager.getTaskActivity(), "project-1", "task-1").attention).toBeNull();
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

  it("immediately forgets a removed Project runtime and task activity", () => {
    const harness = createClientHarness();
    const manager = createProjectRuntimeManager(harness.client);
    manager.observeSnapshot(createSnapshotResponse("task-1"));

    manager.forgetProject("project-1");

    expect(harness.closeConnection).toHaveBeenCalledOnce();
    expect(getTaskActivity(manager.getTaskActivity(), "project-1", "task-1")).toEqual({
      attention: null,
      isAwaitingApproval: false,
      isRunning: false,
    });
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

  it("preserves retained turn items when a refreshed snapshot omits them", () => {
    const harness = createClientHarness();
    const manager = createProjectRuntimeManager(harness.client);
    const response = createSnapshotResponse("task-1", { sequence: 2, title: "刷新后的标题" });
    const currentResponse: AgentTaskSnapshotResponse = {
      ...response,
      snapshot: {
        ...response.snapshot,
        title: "旧标题",
        turns: [
          {
            ...createTurn("task-1"),
            items: [
              {
                id: "tool-read-file",
                input: { path: "package.json" },
                name: "read_file",
                output: { content: "CodeAgent" },
                status: "completed",
                type: "tool",
              },
            ],
          },
        ],
      },
    };
    const store = createTaskStore({ projectId: "project-1", taskId: "task-1" }, currentResponse);

    const detach = manager.attachTaskStore(response, store, vi.fn());

    expect(store.getState().getItem("tool-read-file")).toMatchObject({
      name: "read_file",
      status: "completed",
    });
    expect(store.getState().checkpoint).toEqual(response.checkpoint);
    expect(store.getState().snapshotMetadata?.title).toBe("刷新后的标题");
    detach();
    manager.dispose();
  });

  it("replays wrapped Project history without shifting the backing array", () => {
    const harness = createClientHarness();
    const manager = createProjectRuntimeManager(harness.client, {
      maxEventHistoryEvents: 2,
      taskNotifier: createTaskNotifier(),
    });
    manager.observeSnapshot(createSnapshotResponse("task-1", { status: "idle" }));
    const retainedHistory = new ProjectEventHistory({
      maxBytes: Number.MAX_SAFE_INTEGER,
      maxEvents: 2,
    });
    const retainedEvents: AgentEvent[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    try {
      const firstEvent = createTurnStartedEvent("task-1", 1);
      const secondEvent = createTurnStartedEvent("task-2", 2);
      const thirdEvent = createMessageDeltaEvent("task-2", 3, "环绕后继续输出");
      retainedHistory.append(firstEvent);
      retainedHistory.append(secondEvent);
      retainedHistory.append(thirdEvent);
      retainedHistory.forEachAfter(1, (event) => {
        retainedEvents.push(event);
      });
      harness.emit(firstEvent);
      harness.emit(secondEvent);
      harness.emit(thirdEvent);

      const secondStore = createTaskStore({ projectId: "project-1", taskId: "task-2" });
      const detach = manager.attachTaskStore(
        createSnapshotResponse("task-2", { sequence: 1, status: "idle" }),
        secondStore,
        vi.fn(),
      );

      expect(secondStore.getState().checkpoint?.sequence).toBe(3);
      expect(secondStore.getState().getItem("message-task-2")).toMatchObject({
        text: "环绕后继续输出",
      });
      expect(retainedHistory.floorSequence).toBe(1);
      expect(retainedEvents.map((event) => event.sequence)).toEqual([2, 3]);
      detach();
    } finally {
      manager.dispose();
      vi.unstubAllGlobals();
    }
  });

  it("evicts the oldest Project event when the byte budget is exceeded", () => {
    const firstEvent = createTurnStartedEvent("task-1", 1);
    const secondEvent = createTurnStartedEvent("task-2", 2);
    const history = new ProjectEventHistory({
      maxBytes: Math.max(estimateRetainedBytes(firstEvent), estimateRetainedBytes(secondEvent)),
      maxEvents: 10,
    });
    const retainedSequences: number[] = [];

    history.append(firstEvent);
    history.append(secondEvent);
    history.forEachAfter(0, (event) => {
      retainedSequences.push(event.sequence);
    });

    expect(history.floorSequence).toBe(1);
    expect(retainedSequences).toEqual([2]);
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

  it("retries a failed Snapshot recovery before accepting later realtime events", async () => {
    vi.useFakeTimers();
    const harness = createClientHarness();
    const manager = createProjectRuntimeManager(harness.client);
    const store = createTaskStore({ projectId: "project-1", taskId: "task-1" });
    const recoveredSnapshot = createSnapshotResponse("task-1", { sequence: 8 });
    const recoverSnapshot = vi
      .fn<() => Promise<AgentTaskSnapshotResponse | undefined>>()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(recoveredSnapshot);
    const detach = manager.attachTaskStore(
      createSnapshotResponse("task-1"),
      store,
      recoverSnapshot,
    );

    harness.requireResync();
    await Promise.resolve();
    expect(recoverSnapshot).toHaveBeenCalledTimes(1);

    // Socket 提前连通不能绕过 Snapshot 校准，恢复成功前始终保持非阻塞恢复状态。
    harness.connectionState("connected");
    expect(store.getState().connectionState).toBe("reconnecting");

    await vi.advanceTimersByTimeAsync(1_000);
    expect(recoverSnapshot).toHaveBeenCalledTimes(2);
    harness.connectionState("connected");
    harness.emit(createFileChangeCompletedEvent("task-1", 9));

    expect(store.getState().connectionState).toBe("connected");
    expect(store.getState().getItem("file-change-task-1")).toBeDefined();
    expect(store.getState().checkpoint?.sequence).toBe(9);

    detach();
    manager.dispose();
  });

  it("retries Snapshot recovery without Task Store consumers and resumes Project events", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const harness = createClientHarness();
    const manager = createProjectRuntimeManager(harness.client);
    harness.client.readTask
      .mockRejectedValueOnce(new Error("Snapshot recovery failed"))
      .mockResolvedValueOnce(createSnapshotResponse("task-1", { sequence: 8 }));
    manager.observeSnapshot(createSnapshotResponse("task-1"));

    harness.requireResync();
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.client.readTask).toHaveBeenCalledTimes(1);
    expect(harness.client.subscribeEvents).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("CodeAgent internal warning", {
      diagnosticCode: "snapshot_recovery_failed",
      errorMessage: "Snapshot recovery failed",
    });

    await vi.advanceTimersByTimeAsync(999);
    expect(harness.client.readTask).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(harness.client.readTask).toHaveBeenCalledTimes(2);
    expect(harness.client.subscribeEvents).toHaveBeenCalledTimes(2);

    harness.emit(createTurnCompletedEvent("task-1", 9));
    expect(getTaskActivity(manager.getTaskActivity(), "project-1", "task-1").isRunning).toBe(false);
    manager.dispose();
  });
});
