import type { SubscribeAgentEventsOptions } from "@/platform/native-client-types.js";
import type { AgentEvent, AgentTaskSnapshotResponse, TaskActivitySnapshot } from "@/protocol/index.js";
import { describe, expect, it, vi } from "vitest";

import type { NativeRuntimeClient } from "../../projects/project-queries.js";
import { createProjectRuntimeManager } from "./project-runtime.js";
import { createTaskStore } from "./task-store.js";
import { NativeCommandError } from "../../../platform/tauri/native-client.js";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createSnapshot(projectId: string, taskId: string): AgentTaskSnapshotResponse {
  return {
    checkpoint: { sequence: 4, sessionId: "session-1" },
    snapshot: {
      contextUsage: null,
      goal: null,
      id: taskId,
      pendingRequests: [],
      pinned: false,
      plan: null,
      projectId,
      settings: {
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        model: "gpt-5.6-sol",
        reasoningEffort: "high",
        sandboxMode: "workspace-write",
      },
      status: "running",
      title: taskId,
      turns: [],
      turnsNextCursor: null,
      updatedAt: "2026-08-31T00:00:00.000Z",
    },
  };
}

describe("ProjectRuntimeManager task activity restoration", () => {
  it("ignores a late ownership failure and releases only after the pending resume settles", async () => {
    const first = deferred();
    const second = deferred();
    const response = createSnapshot("project-1", "task-1");
    const client: NativeRuntimeClient = {
      readTask: vi.fn(async () => response),
      retainTaskSubscription: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise),
      releaseTaskSubscription: vi.fn(async () => undefined),
      subscribeEvents: vi.fn(() => () => undefined),
    };
    const runtime = createProjectRuntimeManager(client);
    const store = createTaskStore({ projectId: "project-1", taskId: "task-1" });
    const detach = runtime.attachTaskStore(response, store, async () => response);
    detach();
    expect(client.releaseTaskSubscription).not.toHaveBeenCalled();
    const detachAgain = runtime.attachTaskStore(response, store, async () => response);
    second.resolve();
    await vi.waitFor(() => expect(store.getState().writeAccess).toBe("writable"));
    first.reject(new NativeCommandError("CODEX_THREAD_BUSY", "busy"));
    await first.promise.catch(() => undefined);
    await Promise.resolve();
    expect(store.getState().writeAccess).toBe("writable");
    expect(client.releaseTaskSubscription).not.toHaveBeenCalled();
    detachAgain();
    await vi.waitFor(() => expect(client.releaseTaskSubscription).toHaveBeenCalledExactlyOnceWith("project-1", "task-1"));
    runtime.dispose();
  });

  it("keeps an externally owned task locked across snapshots and checks again on reopen", async () => {
    const retainTaskSubscription = vi.fn()
      .mockRejectedValueOnce(new NativeCommandError("CODEX_THREAD_BUSY", "busy"))
      .mockResolvedValue(undefined);
    const response = createSnapshot("project-1", "task-1");
    const client = {
      readTask: vi.fn(async () => response), retainTaskSubscription,
      releaseTaskSubscription: vi.fn(async () => undefined),
      subscribeEvents: vi.fn(() => () => undefined),
    } as NativeRuntimeClient;
    const runtime = createProjectRuntimeManager(client);
    const store = createTaskStore({ projectId: "project-1", taskId: "task-1" });
    const detach = runtime.attachTaskStore(response, store, client.readTask.bind(client, "project-1", "task-1"));
    try {
      await vi.waitFor(() => expect(store.getState().writeAccess).toBe("external"));
      store.getState().hydrate(response);
      expect(store.getState().writeAccess).toBe("external");
      expect(retainTaskSubscription).toHaveBeenCalledExactlyOnceWith("project-1", "task-1");
      detach();
      const detachAgain = runtime.attachTaskStore(response, store, async () => response);
      await vi.waitFor(() => expect(store.getState().writeAccess).toBe("writable"));
      detachAgain();
    } finally { detach(); runtime.dispose(); }
  });

  it("reconnects after synchronous replay reports an evicted event", async () => {
    const cleanup = vi.fn();
    const subscribeEvents = vi.fn((options: SubscribeAgentEventsOptions) => {
      if (options.afterSequence === 4) {
        options.onResyncRequired({
          latestSequence: 5,
          reason: "event_retention_exceeded",
          sessionId: "session-1",
          type: "resync.required",
          version: 3,
        });
      }
      return cleanup;
    });
    const client = {
      readTask: vi.fn(async () => ({
        ...createSnapshot("project-1", "task-1"),
        checkpoint: { sequence: 5, sessionId: "session-1" },
      })),
      subscribeEvents,
    } as unknown as NativeRuntimeClient;
    const runtime = createProjectRuntimeManager(client);
    try {
      runtime.observeSnapshot(createSnapshot("project-1", "task-1"));
      await vi.waitFor(() => expect(subscribeEvents).toHaveBeenCalledTimes(2));
      expect(cleanup).toHaveBeenCalledTimes(1);
      expect(subscribeEvents).toHaveBeenLastCalledWith(expect.objectContaining({ afterSequence: 5 }));
    } finally {
      runtime.dispose();
    }
  });

  it("restores native activity and reconnects only active tasks", async () => {
    const readTask = vi.fn(async (projectId: string, taskId: string) =>
      createSnapshot(projectId, taskId),
    );
    const subscribeEvents = vi.fn(() => () => undefined);
    const client = {
      readTask,
      releaseTaskSubscription: vi.fn(async () => undefined),
      retainTaskSubscription: vi.fn(async () => undefined),
      subscribeEvents,
    } as unknown as NativeRuntimeClient;
    const runtime = createProjectRuntimeManager(client);
    const tasks: readonly TaskActivitySnapshot[] = [
      {
        projectId: "project-1",
        requiresApproval: false,
        startedAt: "2026-09-02T08:00:00.000Z",
        status: "running",
        taskId: "task-1",
        taskName: "任务一",
      },
      {
        projectId: "project-1",
        requiresApproval: true,
        startedAt: "2026-09-02T08:05:00.000Z",
        status: "waiting",
        taskId: "task-2",
        taskName: "任务二",
      },
      {
        projectId: "project-2",
        requiresApproval: false,
        status: "completed",
        taskId: "task-3",
        taskName: "任务三",
      },
    ];

    await runtime.restoreTaskActivities(tasks);

    expect([...runtime.getTaskActivity().values()]).toEqual([
      expect.objectContaining({ isRunning: true, projectId: "project-1", taskId: "task-1" }),
      expect.objectContaining({ isRunning: true, projectId: "project-1", taskId: "task-2" }),
      expect.objectContaining({ attention: "completed", projectId: "project-2", taskId: "task-3" }),
    ]);
    expect(readTask).toHaveBeenCalledTimes(2);
    expect(subscribeEvents).toHaveBeenCalledTimes(1);
    runtime.dispose();
  });

  it("does not let stale startup activity overwrite an unviewed completion event", async () => {
    let onEvent: SubscribeAgentEventsOptions["onEvent"] = () => undefined;
    const readTask = vi.fn(async (projectId: string, taskId: string) =>
      createSnapshot(projectId, taskId),
    );
    const client = {
      readTask,
      subscribeEvents: vi.fn((options: SubscribeAgentEventsOptions) => {
        onEvent = options.onEvent;
        return () => undefined;
      }),
    } as unknown as NativeRuntimeClient;
    const runtime = createProjectRuntimeManager(client);
    runtime.observeSnapshot(createSnapshot("project-1", "task-1"));
    onEvent({
      payload: {
        turn: {
          completedAt: "2026-09-02T08:01:00.000Z",
          error: null,
          id: "turn-1",
          items: [],
          startedAt: "2026-09-02T08:00:00.000Z",
          status: "completed",
        },
      },
      provider: "codex",
      sequence: 5,
      sessionId: "session-1",
      taskId: "task-1",
      timestamp: "2026-09-02T08:01:00.000Z",
      turnId: "turn-1",
      type: "turn.completed",
      version: 2,
    });

    await runtime.restoreTaskActivities([
      {
        projectId: "project-1",
        requiresApproval: false,
        startedAt: "2026-09-02T08:00:00.000Z",
        status: "running",
        taskId: "task-1",
        taskName: "任务一",
      },
    ]);

    expect(runtime.getTaskActivity().values().next().value).toMatchObject({
      attention: "completed",
      isRunning: false,
      taskName: "task-1",
    });
    expect(readTask).not.toHaveBeenCalled();
    runtime.dispose();
  });

  it("reports task recency as soon as a turn starts", () => {
    let onEvent: SubscribeAgentEventsOptions["onEvent"] = () => undefined;
    const onTaskMetadataChanged = vi.fn();
    const client = {
      readTask: vi.fn(async (projectId: string, taskId: string) =>
        createSnapshot(projectId, taskId),
      ),
      releaseTaskSubscription: vi.fn(async () => undefined),
      retainTaskSubscription: vi.fn(async () => undefined),
      subscribeEvents: vi.fn((options: SubscribeAgentEventsOptions) => {
        onEvent = options.onEvent;
        return () => undefined;
      }),
    } as unknown as NativeRuntimeClient;
    const runtime = createProjectRuntimeManager(client, { onTaskMetadataChanged });
    runtime.observeSnapshot(createSnapshot("project-1", "task-1"));
    const event: AgentEvent = {
      payload: {
        turn: {
          completedAt: null,
          error: null,
          id: "turn-1",
          items: [],
          startedAt: "2026-09-03T08:00:00.000Z",
          status: "running",
        },
      },
      provider: "codex",
      sequence: 5,
      sessionId: "session-1",
      taskId: "task-1",
      timestamp: "2026-09-03T08:00:00.000Z",
      turnId: "turn-1",
      type: "turn.started",
      version: 2,
    };

    onEvent(event);

    expect(onTaskMetadataChanged).toHaveBeenCalledWith(
      "project-1",
      "task-1",
      "turn_started",
      event.timestamp,
    );
    runtime.dispose();
  });
});
