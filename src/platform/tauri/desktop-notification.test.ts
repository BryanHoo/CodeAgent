import { describe, expect, it, vi } from "vitest";

import { showDesktopNotification } from "./desktop-notification.js";

describe("desktop notification IPC", () => {
  it("routes notifications through the native Tauri command", async () => {
    const invoke = vi.fn(async () => undefined);

    await showDesktopNotification(
      { body: "任务已完成", title: "CodeAgent · 修复通知" },
      invoke,
    );

    expect(invoke).toHaveBeenCalledWith("show_task_notification", {
      body: "任务已完成",
      title: "CodeAgent · 修复通知",
    });
  });
});
