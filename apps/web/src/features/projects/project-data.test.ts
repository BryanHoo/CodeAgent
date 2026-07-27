import { describe, expect, it } from "vitest";

import {
  getPinnedTasks,
  getProjectTaskPreview,
  PROJECT_TASK_PREVIEW_LIMIT,
} from "./project-data.js";

describe("project navigation data", () => {
  it("returns no pinned section data when every task is unpinned", () => {
    expect(
      getPinnedTasks([
        {
          id: "task-1",
          pinned: false,
          projectId: "demo",
          title: "Demo task",
          updatedAt: "2026-07-22T08:00:00.000Z",
        },
      ]),
    ).toEqual([]);
  });

  it("shows five tasks by default and all tasks only after expansion", () => {
    const tasks = Array.from({ length: 7 }, (_, index) => ({
      id: `task-${String(index + 1)}`,
      pinned: false,
      projectId: "demo",
      title: `Task ${String(index + 1)}`,
      updatedAt: "2026-07-22T08:00:00.000Z",
    }));

    expect(PROJECT_TASK_PREVIEW_LIMIT).toBe(5);
    expect(getProjectTaskPreview(tasks, false)).toEqual({
      hasMore: true,
      tasks: tasks.slice(0, 5),
    });
    expect(getProjectTaskPreview(tasks, true)).toEqual({ hasMore: false, tasks });
    expect(getProjectTaskPreview(tasks.slice(0, 5), false)).toEqual({
      hasMore: false,
      tasks: tasks.slice(0, 5),
    });
  });
});
