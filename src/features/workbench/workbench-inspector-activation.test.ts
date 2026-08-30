import { describe, expect, it } from "vitest";

import {
  deriveWorkbenchInspectorContextActivation,
  getAvailableWorkbenchInspectorTabs,
  getDefaultWorkbenchInspectorTab,
} from "./workbench-inspector-activation.js";

const gitStatus = {
  repositoryMode: "root" as const,
  staged: [],
  unstaged: [],
};

describe("workbench inspector activation", () => {
  it("places the project tab before the task context tab", () => {
    expect(getAvailableWorkbenchInspectorTabs("task-1", gitStatus)).toEqual([
      "project",
      "context",
      "history",
    ]);
  });

  it("keeps the project tab active when a regular task starts", () => {
    expect(getDefaultWorkbenchInspectorTab(false)).toBe("project");
  });

  it("activates context only when a plan or goal appears", () => {
    const empty = { goal: false, plan: false, scopeKey: "project-1:task-1" };
    const goal = { ...empty, goal: true };
    const plan = { ...empty, plan: true };

    expect(deriveWorkbenchInspectorContextActivation(empty, empty).activateContext).toBe(false);
    expect(deriveWorkbenchInspectorContextActivation(empty, goal).activateContext).toBe(true);
    expect(deriveWorkbenchInspectorContextActivation(empty, plan).activateContext).toBe(true);
    expect(deriveWorkbenchInspectorContextActivation(goal, goal).activateContext).toBe(false);
  });
});
