import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();

vi.mock("./native-invoke.js", () => ({ invoke }));

describe("running task client", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("reads the Rust-owned running task snapshot", async () => {
    const snapshot = [{ projectId: "project-1", taskId: "task-1", taskName: "任务" }];
    invoke.mockResolvedValue(snapshot);
    const { getRunningTasks } = await import("./running-task-client.js");

    await expect(getRunningTasks()).resolves.toEqual(snapshot);
    expect(invoke).toHaveBeenCalledWith("get_running_tasks");
  });
});
