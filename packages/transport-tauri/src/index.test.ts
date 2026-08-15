import { listen } from "@tauri-apps/api/event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CodeAgentClient } from "@code-agent/client";

import { createHostNotificationApi } from "./index.js";

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

describe("Tauri host capabilities", () => {
  beforeEach(() => {
    vi.mocked(listen).mockReset();
  });

  it("delegates native notifications to the host client", async () => {
    const showHostNotification = vi.fn().mockResolvedValue({ status: "shown" });
    const client = { showHostNotification } as unknown as CodeAgentClient;
    const notificationApi = createHostNotificationApi(client);

    await notificationApi.show("CodeAgent · Task", {
      body: "Task 已完成",
      projectId: "project-1",
      tag: "project-1:task-1:turn-1:terminal",
      taskId: "task-1",
    });

    expect(showHostNotification).toHaveBeenCalledWith({
      body: "Task 已完成",
      projectId: "project-1",
      tag: "project-1:task-1:turn-1:terminal",
      taskId: "task-1",
      title: "CodeAgent · Task",
    });
  });

  it("forwards native notification actions from the host", async () => {
    const unlisten = vi.fn();
    let emitAction:
      ((event: { payload: { projectId: string; taskId: string } }) => void) | undefined;
    vi.mocked(listen).mockImplementation((event, handler) => {
      expect(event).toBe("host-notification-action");
      emitAction = handler as typeof emitAction;
      return Promise.resolve(unlisten);
    });
    const client = { showHostNotification: vi.fn() } as unknown as CodeAgentClient;
    const notificationApi = createHostNotificationApi(client);
    const listener = vi.fn();

    const removeListener = await notificationApi.onAction(listener);
    emitAction?.({ payload: { projectId: "project-1", taskId: "task-1" } });
    removeListener();

    expect(listener).toHaveBeenCalledWith({ projectId: "project-1", taskId: "task-1" });
    expect(unlisten).toHaveBeenCalledOnce();
  });
});
