import { describe, expect, it } from "vitest";

import projectSidebarSource from "./project-sidebar.tsx?raw";

describe("ProjectSidebar navigation", () => {
  it("orders primary actions by task workflow", () => {
    const primaryActionPositions = [
      projectSidebarSource.lastIndexOf('t("sidebar.newTask")'),
      projectSidebarSource.lastIndexOf("<SidebarScheduledTasksLink"),
      projectSidebarSource.lastIndexOf("<SidebarTaskBoardLink"),
      projectSidebarSource.lastIndexOf("<SidebarExtensionCenterLink"),
    ];

    expect(primaryActionPositions).not.toContain(-1);
    expect(primaryActionPositions).toEqual(primaryActionPositions.toSorted((left, right) => left - right));
  });
});
