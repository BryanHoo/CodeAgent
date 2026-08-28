import type { AgentEvent } from "@/protocol/index.js";
import { describe, expect, it, vi } from "vitest";

import { createDesktopTaskNotifier } from "./desktop-task-notifier.js";

function createCompletedEvent(): AgentEvent {
  return {
    payload: {
      turn: {
        completedAt: "2026-08-28T08:00:00Z",
        error: null,
        id: "turn-a",
        items: [],
        startedAt: "2026-08-28T07:59:00Z",
        status: "completed",
      },
    },
    provider: "codex",
    sequence: 1,
    sessionId: "session-a",
    taskId: "task-a",
    timestamp: "2026-08-28T08:00:00Z",
    turnId: "turn-a",
    type: "turn.completed",
    version: 2,
  };
}

describe("DesktopTaskNotifier", () => {
  it("sends background task completion through the desktop notification API", async () => {
    const show = vi.fn(async () => undefined);
    const notifier = createDesktopTaskNotifier({
      api: { show },
      isPageForeground: () => false,
    });

    notifier.notify("project-a", createCompletedEvent(), "修复通知");

    await vi.waitFor(() => {
      expect(show).toHaveBeenCalledWith({
        body: "Task 已完成",
        title: "CodeAgent · 修复通知",
      });
    });
  });

  it("suppresses notifications while the desktop window is foreground", () => {
    const show = vi.fn(async () => undefined);
    const notifier = createDesktopTaskNotifier({
      api: { show },
      isPageForeground: () => true,
    });

    notifier.notify("project-a", createCompletedEvent(), "修复通知");

    expect(show).not.toHaveBeenCalled();
  });
});
