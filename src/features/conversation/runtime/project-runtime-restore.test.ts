import type { AgentTaskSnapshotResponse, RunningTaskSnapshot } from "@/protocol/index.js";
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

describe("ProjectRuntimeManager running task restoration", () => {
  it("registers every running task and reconnects once per project", async () => {
    const readTask = vi.fn(async (projectId: string, taskId: string) =>
      createSnapshot(projectId, taskId),
    );
    const subscribeEvents = vi.fn(() => () => undefined);
    const client = {
      readTask,
      subscribeEvents,
      unsubscribeTask: vi.fn(async () => undefined),
    } as unknown as NativeRuntimeClient;
    const runtime = createProjectRuntimeManager(client);
    const tasks: readonly RunningTaskSnapshot[] = [
      { projectId: "project-1", taskId: "task-1", taskName: "任务一" },
      { projectId: "project-1", taskId: "task-2", taskName: "任务二" },
      { projectId: "project-2", taskId: "task-3", taskName: "任务三" },
    ];

    await runtime.restoreRunningTasks(tasks);

    expect([...runtime.getTaskActivity().values()]).toEqual([
      expect.objectContaining({ isRunning: true, projectId: "project-1", taskId: "task-1" }),
      expect.objectContaining({ isRunning: true, projectId: "project-1", taskId: "task-2" }),
      expect.objectContaining({ isRunning: true, projectId: "project-2", taskId: "task-3" }),
    ]);
    expect(readTask).toHaveBeenCalledTimes(3);
    expect(subscribeEvents).toHaveBeenCalledTimes(2);
    runtime.dispose();
  });
});
