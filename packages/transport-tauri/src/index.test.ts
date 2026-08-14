import { describe, expect, it, vi } from "vitest";

import type { CodeAgentClient } from "@code-agent/client";

import { createHostNotificationApi } from "./index.js";

describe("Tauri host capabilities", () => {
  it("delegates native notifications to the host client", async () => {
    const showHostNotification = vi.fn().mockResolvedValue({ status: "shown" });
    const client = { showHostNotification } as unknown as CodeAgentClient;
    const notificationApi = createHostNotificationApi(client);

    await notificationApi.show("CodeAgent · Task", {
      body: "Task 已完成",
      tag: "project-1:task-1:turn-1:terminal",
    });

    expect(showHostNotification).toHaveBeenCalledWith({
      body: "Task 已完成",
      tag: "project-1:task-1:turn-1:terminal",
      title: "CodeAgent · Task",
    });
  });
});
