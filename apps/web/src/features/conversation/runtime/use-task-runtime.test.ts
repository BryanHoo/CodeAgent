import { describe, expect, it, vi } from "vitest";

import { createTaskStore } from "./task-store.js";
import { loadPreviousTaskTurns, selectActiveTaskStore } from "./use-task-runtime.js";

describe("selectActiveTaskStore", () => {
  it("loads the current older-turn cursor into the normalized store", async () => {
    const store = createTaskStore(
      { projectId: "code-agent", taskId: "task-1" },
      {
        checkpoint: { sequence: 1, sessionId: "session-1" },
        snapshot: {
          contextUsage: null,
          id: "task-1",
          plan: null,
          pendingRequests: [],
          pinned: false,
          projectId: "code-agent",
          settings: {
            approvalPolicy: "on-request",
            approvalsReviewer: "user",
            model: "gpt-5.6-sol",
            reasoningEffort: "high",
            sandboxMode: "workspace-write",
          },
          status: "idle",
          title: "分页任务",
          turns: [],
          turnsNextCursor: "older-page",
          updatedAt: "2026-08-15T00:00:00.000Z",
        },
      },
    );
    const listTaskTurns = vi.fn(() => Promise.resolve({ data: [], nextCursor: null }));

    await expect(loadPreviousTaskTurns({ listTaskTurns }, store)).resolves.toBe(true);

    expect(listTaskTurns).toHaveBeenCalledWith("code-agent", "task-1", "older-page");
    expect(store.getState().snapshotMetadata?.turnsNextCursor).toBeNull();
  });

  it("isolates retained normalized stores by project and task identity", () => {
    const store = createTaskStore({ projectId: "code-agent", taskId: "task-1" });

    expect(selectActiveTaskStore(store, "other-project", "task-1")).toBeUndefined();
    expect(selectActiveTaskStore(store, "code-agent", "task-other")).toBeUndefined();
    expect(selectActiveTaskStore(store, "code-agent", "task-1")).toBe(store);
  });
});
