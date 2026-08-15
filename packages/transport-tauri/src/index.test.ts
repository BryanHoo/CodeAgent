import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CodeAgentClient } from "@code-agent/client";

import { createHostExternalUrlApi, createHostNotificationApi } from "./index.js";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

function isExternalUrlInvokePayload(value: unknown): value is { requestId: unknown; url: unknown } {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "requestId" in value &&
    "url" in value
  );
}

describe("Tauri host capabilities", () => {
  beforeEach(() => {
    vi.mocked(listen).mockReset();
    vi.mocked(invoke).mockReset();
  });

  it("opens external URLs with the system default browser", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);

    await createHostExternalUrlApi().open("https://example.com/docs");

    expect(invoke).toHaveBeenCalledOnce();
    const call = vi.mocked(invoke).mock.calls[0];
    const payload = call?.[1];
    expect(call?.[0]).toBe("host_external_url_open");
    expect(isExternalUrlInvokePayload(payload)).toBe(true);
    if (!isExternalUrlInvokePayload(payload)) throw new TypeError("expected object invoke payload");
    expect(payload.url).toBe("https://example.com/docs");
    expect(typeof payload.requestId).toBe("string");
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
