import { describe, expect, it } from "vitest";

import { TaskRuntimeState } from "./task-runtime-state.js";

describe("TaskRuntimeState", () => {
  it("clears every owned task-scoped collection together", () => {
    const state = new TaskRuntimeState();
    state.projectTaskIds.add("task-1");
    state.resumedTaskIds.add("task-1");
    state.runningTaskIds.add("task-1");
    state.contextUsage.set("task-1", { contextWindow: 100, usedTokens: 10 });
    state.unmaterializedTasks.set("task-1", {
      id: "task-1",
      pinned: false,
      projectId: "project-1",
      title: "Task",
      updatedAt: "2026-08-02T00:00:00.000Z",
    });

    state.clearTask("task-1");

    expect(state.projectTaskIds.has("task-1")).toBe(false);
    expect(state.resumedTaskIds.has("task-1")).toBe(false);
    expect(state.runningTaskIds.has("task-1")).toBe(false);
    expect(state.contextUsage.has("task-1")).toBe(false);
    expect(state.unmaterializedTasks.has("task-1")).toBe(false);
  });
});
