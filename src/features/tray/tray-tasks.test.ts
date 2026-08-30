import { describe, expect, it } from "vitest";

import type { TaskActivityMap } from "../conversation/runtime/task-activity.js";
import { deriveTrayTaskUpdates } from "./tray-tasks.js";

describe("deriveTrayTaskUpdates", () => {
  it("projects running state and task titles into bounded tray updates", () => {
    const activity: TaskActivityMap = new Map([
      [
        "project-1\u0000task-running",
        {
          attention: null,
          isRunning: true,
          pendingApprovalRequestIds: new Set(),
          projectId: "project-1",
          taskId: "task-running",
        },
      ],
      [
        "project-1\u0000task-completed",
        {
          attention: "completed",
          isRunning: false,
          pendingApprovalRequestIds: new Set(),
          projectId: "project-1",
          taskId: "task-completed",
        },
      ],
    ]);

    expect(
      deriveTrayTaskUpdates(
        [
          { id: "task-running", projectId: "project-1", title: "Implement tray status" },
          { id: "task-completed", projectId: "project-1", title: "Finished task" },
        ],
        activity,
      ),
    ).toEqual([
      {
        isRunning: true,
        projectId: "project-1",
        taskId: "task-running",
        taskName: "Implement tray status",
      },
      {
        isRunning: false,
        projectId: "project-1",
        taskId: "task-completed",
        taskName: "Finished task",
      },
    ]);
  });
});
