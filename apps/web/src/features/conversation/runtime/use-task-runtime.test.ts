import { describe, expect, it } from "vitest";

import type { TaskRuntimeState } from "./task-runtime.js";
import { selectActiveTaskRuntime } from "./use-task-runtime.js";

const runtime = {
  checkpoint: { sequence: 3, sessionId: "runtime-1" },
  connectionState: "connected",
  snapshot: {
    contextUsage: null,
    id: "task-1",
    pendingRequests: [],
    pinned: false,
    projectId: "code-agent",
    settings: {
      approvalPolicy: "on-request",
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      sandboxMode: "workspace-write",
    },
    status: "idle",
    title: "CodeAgent Task",
    turns: [],
    updatedAt: "2026-07-26T00:00:00.000Z",
  },
} as const satisfies TaskRuntimeState;

describe("selectActiveTaskRuntime", () => {
  it("rejects a retained snapshot from another project", () => {
    expect(selectActiveTaskRuntime(runtime, "other-project", "task-1")).toBeUndefined();
    expect(selectActiveTaskRuntime(runtime, "code-agent", "task-1")).toBe(runtime);
  });
});
