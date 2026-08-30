import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

describe("tray native client", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue(undefined);
  });

  it("synchronizes task activity updates with the native tray", async () => {
    const { syncTrayTasks } = await import("./tray-client.js");
    const tasks = [
      {
        isRunning: true,
        projectId: "project-1",
        taskId: "task-1",
        taskName: "Implement tray status",
      },
    ];

    await syncTrayTasks(tasks);

    expect(invoke).toHaveBeenCalledWith("sync_tray_tasks", { tasks });
  });
});
