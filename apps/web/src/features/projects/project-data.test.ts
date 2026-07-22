import { describe, expect, it } from "vitest";

import { createProjectId, getPinnedTasks } from "./project-data.js";

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

  it("uses the folder name to create a stable unique project id", () => {
    expect(createProjectId("New Demo", ["new-demo"])).toBe("new-demo-2");
    expect(createProjectId("中文项目", [])).toBe("project");
  });
});
