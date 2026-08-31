import type { AgentTaskSnapshotResponse, TaskActivitySnapshot } from "@/protocol/index.js";
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
      { projectId: "project-1", status: "running", taskId: "task-1", taskName: "任务一" },
      { projectId: "project-1", status: "waiting", taskId: "task-2", taskName: "任务二" },
      { projectId: "project-2", status: "completed", taskId: "task-3", taskName: "任务三" },
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
});
