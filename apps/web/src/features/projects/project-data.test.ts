import { describe, expect, it } from "vitest";

import { getPinnedTasks } from "./project-data.js";

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
});
