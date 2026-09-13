import { describe, expect, it, vi } from "vitest";

import type { AgentPromptInput, AgentTask, AgentTurnOptions } from "@/protocol/index.js";
import type { NativeMutationClient } from "../projects/project-queries.js";

import { startPromptTurn } from "./composer-state.js";

const task: AgentTask = {
  id: "thread-a",
  pinned: false,
  projectId: "project-a",
  title: "新任务",
  updatedAt: "2025-01-01T00:00:00Z",
};
const input: AgentPromptInput = { attachments: [], skills: [], text: "首条消息", type: "prompt" };
const turnOptions: AgentTurnOptions = {
  approvalPolicy: "on-request",
  approvalsReviewer: "user",
  model: "gpt-5.6-sol",
  reasoningEffort: "high",
  sandboxMode: "workspace-write",
};

describe("startPromptTurn", () => {
  it("delegates creation and turn start to one native submission", async () => {
    const startTask = vi.fn(async () => ({ task }));
    const startTurn = vi.fn(async () => ({
      checkpoint: { sequence: 1, sessionId: "runtime-a" },
      taskId: task.id,
      turn: {
        completedAt: null,
        error: null,
        id: "turn-a",
        items: [],
        startedAt: "2025-01-01T00:00:00Z",
        status: "running" as const,
      },
    }));
    const submitPrompt = vi.fn(startTurn.getMockImplementation()!);
    const client = { startTask, startTurn, submitPrompt } as Pick<
      NativeMutationClient,
      "submitPrompt"
    >;

    await startPromptTurn(client, {
      idempotencyKeys: { startTask: "task-key", startTurn: "turn-key" },
      input,
      projectId: "project-a",
      turnOptions,
    });

    expect(submitPrompt).toHaveBeenCalledWith({
      idempotencyKeys: { startTask: "task-key", startTurn: "turn-key" },
      input,
      projectId: "project-a",
      turnOptions,
    });
    expect(startTask).not.toHaveBeenCalled();
    expect(startTurn).not.toHaveBeenCalled();
  });
});
