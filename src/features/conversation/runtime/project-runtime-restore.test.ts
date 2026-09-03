import type { SubscribeAgentEventsOptions } from "@/platform/native-client-types.js";
import type { AgentEvent, AgentTaskSnapshotResponse, TaskActivitySnapshot } from "@/protocol/index.js";
import { describe, expect, it, vi } from "vitest";

import type { NativeRuntimeClient } from "../../projects/project-queries.js";
import { createProjectRuntimeManager } from "./project-runtime.js";

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
