import { describe, expect, it } from "vitest";

import {
  INITIAL_WORKBENCH_STATE,
  reduceWorkbenchState,
} from "@/app/workbench-state";

describe("reduceWorkbenchState", () => {
  it("keeps independent panel, task, search, tab, theme and dialog state", () => {
    const actions = [
      { type: "toggleSidebar" },
      { type: "selectTask", taskId: "task-2" },
      { type: "setSearch", query: "tokens" },
      { type: "selectInspectorTab", tab: "changes" },
      { type: "toggleTheme" },
      { type: "openDialog", dialog: "settings" },
    ] as const;

    const state = actions.reduce(reduceWorkbenchState, INITIAL_WORKBENCH_STATE);

    expect(state).toMatchObject({
      sidebarOpen: false,
      inspectorOpen: true,
      selectedTaskId: "task-2",
      searchQuery: "tokens",
      inspectorTab: "changes",
      theme: "dark",
      dialog: "settings",
    });
  });

  it("closes transient surfaces without changing the workspace selection", () => {
    const opened = reduceWorkbenchState(INITIAL_WORKBENCH_STATE, {
      type: "openDialog",
      dialog: "project",
    });
    const closed = reduceWorkbenchState(opened, { type: "closeDialog" });

    expect(closed.dialog).toBeNull();
    expect(closed.selectedTaskId).toBe(INITIAL_WORKBENCH_STATE.selectedTaskId);
  });
});
