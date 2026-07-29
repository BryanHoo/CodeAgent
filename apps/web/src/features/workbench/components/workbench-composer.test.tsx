import { describe, expect, it, vi } from "vitest";

import {
  applyApprovalMode,
  deriveComposerActions,
  deriveComposerInputAvailability,
  deriveComposerState,
  deriveApprovalMode,
  interruptPromptTurn,
  resolveIdempotencyAttempt,
  resolveActiveTurnId,
  resolveReasoningEffort,
  startPromptTurn,
  startTaskReview,
} from "./workbench-composer.js";

const task = {
  contextUsage: null,
  id: "task-1",
  pendingRequests: [],
  pinned: false,
  projectId: "code-agent",
  settings: {
    approvalPolicy: "on-request" as const,
    approvalsReviewer: "user" as const,
    model: "gpt-5.6-sol",
    reasoningEffort: "high",
    sandboxMode: "workspace-write" as const,
  },
  title: "新任务",
  updatedAt: "2026-07-23T00:00:00.000Z",
};

const model = {
  defaultReasoningEffort: "high",
  description: "适合复杂编码任务",
  displayName: "GPT-5.6 Sol",
  id: "gpt-5.6-sol",
  isDefault: true,
  supportedReasoningEfforts: [
    { description: "快速回答", id: "low" },
    { description: "深入分析", id: "high" },
  ],
} as const;

const turn = {
  completedAt: null,
  error: null,
  id: "turn-1",
  items: [],
  startedAt: "2026-07-23T00:00:00.000Z",
  status: "running" as const,
};

describe("WorkbenchComposer", () => {
  it("derives available actions from provider capabilities and task context", () => {
    const capabilities = {
      feedback: { upload: false },
      provider: "fake",
      skills: { list: false, use: false },
      tasks: { fork: false, list: true, read: true, start: false },
      turns: { compact: false, interrupt: false, review: false, rollback: false, start: true },
    };

    expect(deriveComposerActions(undefined, false)).toEqual({
      canInterrupt: false,
      canSubmit: false,
    });
    expect(deriveComposerActions(capabilities, false)).toEqual({
      canInterrupt: false,
      canSubmit: false,
    });
    expect(deriveComposerActions(capabilities, true)).toEqual({
      canInterrupt: false,
      canSubmit: true,
    });
  });

  it("derives all mutation states from runtime and local state", () => {
    expect(deriveComposerState({ activeTurnId: undefined, connectionState: "connected" })).toBe(
      "idle",
    );
    expect(
      deriveComposerState({
        activeTurnId: undefined,
        connectionState: "connected",
        isSubmitting: true,
      }),
    ).toBe("submitting");
    expect(deriveComposerState({ activeTurnId: "turn-1", connectionState: "connected" })).toBe(
      "running",
    );
    expect(deriveComposerState({ activeTurnId: "turn-1", connectionState: "reconnecting" })).toBe(
      "reconnecting",
    );
    expect(deriveComposerState({ activeTurnId: undefined, connectionState: "closed" })).toBe(
      "reconnecting",
    );
    expect(
      deriveComposerState({
        activeTurnId: undefined,
        connectionState: "connected",
        mutationFailed: true,
      }),
    ).toBe("failed");
    expect(resolveActiveTurnId({ ...task, status: "running", turns: [turn] }, turn.id)).toBe(
      turn.id,
    );
    expect(
      resolveActiveTurnId(
        {
          ...task,
          status: "idle",
          turns: [{ ...turn, completedAt: "2026-07-23T00:01:00.000Z", status: "completed" }],
        },
        turn.id,
      ),
    ).toBeUndefined();
  });

  it("keeps local draft and attachment input available while the runtime reconnects", () => {
    expect(deriveComposerInputAvailability("reconnecting")).toEqual({
      attachmentsDisabled: false,
      draftInputDisabled: false,
      turnControlsDisabled: true,
    });
    expect(deriveComposerInputAvailability("submitting")).toEqual({
      attachmentsDisabled: true,
      draftInputDisabled: true,
      turnControlsDisabled: true,
    });
  });

  it("reuses an idempotency key until the mutation fingerprint changes", () => {
    const createKey = vi.fn().mockReturnValueOnce("key-1").mockReturnValueOnce("key-2");
    const first = resolveIdempotencyAttempt(undefined, "start-turn:task-1:首次提交", createKey);
    const retried = resolveIdempotencyAttempt(first, "start-turn:task-1:首次提交", createKey);
    const changed = resolveIdempotencyAttempt(retried, "start-turn:task-1:修改后提交", createKey);

    expect(retried).toBe(first);
    expect(changed).toEqual({ fingerprint: "start-turn:task-1:修改后提交", key: "key-2" });
    expect(createKey).toHaveBeenCalledTimes(2);
  });

  it("resolves model reasoning effort", () => {
    expect(resolveReasoningEffort(model, "low")).toBe("low");
    expect(resolveReasoningEffort(model, "unsupported")).toBe("high");
    expect(resolveReasoningEffort(undefined, "high")).toBeUndefined();
  });

  it("maps automatic approval to the Codex reviewer setting", () => {
    const automatic = applyApprovalMode(task.settings, "auto-review");

    expect(automatic).toMatchObject({
      approvalPolicy: "on-request",
      approvalsReviewer: "auto_review",
    });
    expect(deriveApprovalMode(automatic)).toBe("auto-review");
    expect(applyApprovalMode(automatic, "never")).toMatchObject({
      approvalPolicy: "never",
      approvalsReviewer: "user",
    });
  });

  it("creates a task before its first turn and continues existing tasks directly", async () => {
    const client = {
      interruptTurn: vi.fn(),
      startTask: vi.fn(() => Promise.resolve({ task })),
      startTurn: vi.fn(() => Promise.resolve({ taskId: task.id, turn })),
      uploadAttachment: vi.fn(),
    };

    await expect(
      startPromptTurn(client, {
        idempotencyKeys: { startTask: "task-key", startTurn: "turn-key" },
        input: { attachments: [], skills: [], text: "首次提交", type: "prompt" },
        projectId: "code-agent",
        turnOptions: {
          approvalPolicy: "on-request",
          approvalsReviewer: "user",
          model: "gpt-5.6-sol",
          reasoningEffort: "high",
          sandboxMode: "workspace-write",
        },
      }),
    ).resolves.toEqual({ createdTask: task, taskId: task.id, turn });
    await expect(
      startPromptTurn(client, {
        idempotencyKeys: { startTurn: "existing-turn-key" },
        input: { attachments: [], skills: [], text: "继续任务", type: "prompt" },
        projectId: "code-agent",
        taskId: task.id,
        turnOptions: {
          approvalPolicy: "never",
          approvalsReviewer: "user",
          model: "gpt-5.6-terra",
          reasoningEffort: "low",
          sandboxMode: "danger-full-access",
        },
      }),
    ).resolves.toEqual({ taskId: task.id, turn });

    expect(client.startTask).toHaveBeenCalledTimes(1);
    expect(client.startTask).toHaveBeenCalledWith("code-agent", { idempotencyKey: "task-key" });
    expect(client.startTurn).toHaveBeenNthCalledWith(
      1,
      "code-agent",
      task.id,
      {
        attachments: [],
        skills: [],
        text: "首次提交",
        type: "prompt",
      },
      {
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        model: "gpt-5.6-sol",
        reasoningEffort: "high",
        sandboxMode: "workspace-write",
      },
      { idempotencyKey: "turn-key" },
    );
    expect(client.startTurn).toHaveBeenNthCalledWith(
      2,
      "code-agent",
      task.id,
      {
        attachments: [],
        skills: [],
        text: "继续任务",
        type: "prompt",
      },
      {
        approvalPolicy: "never",
        approvalsReviewer: "user",
        model: "gpt-5.6-terra",
        reasoningEffort: "low",
        sandboxMode: "danger-full-access",
      },
      { idempotencyKey: "existing-turn-key" },
    );
  });

  it("starts code review from a new chat without creating message history", async () => {
    const calls: string[] = [];
    const reviewTurn = { ...turn, id: "review-turn" };
    const client = {
      startReview: vi.fn(() => {
        calls.push("review");
        return Promise.resolve({ taskId: task.id, turn: reviewTurn });
      }),
      startTask: vi.fn(() => {
        calls.push("task");
        return Promise.resolve({ task });
      }),
    };

    await expect(
      startTaskReview(client, {
        idempotencyKey: "review-key",
        projectId: "code-agent",
        target: { type: "uncommitted_changes" },
      }),
    ).resolves.toEqual({ createdTask: task, taskId: task.id, turn: reviewTurn });

    expect(calls).toEqual(["task", "review"]);
    expect(client.startTask).toHaveBeenCalledWith("code-agent", {
      idempotencyKey: "review-key",
    });
    expect(client.startReview).toHaveBeenCalledWith(
      "code-agent",
      task.id,
      { target: { type: "uncommitted_changes" } },
      { idempotencyKey: "review-key" },
    );

    await startTaskReview(client, {
      idempotencyKey: "base-review-key",
      projectId: "code-agent",
      target: { branch: "origin/main", type: "base_branch" },
      taskId: task.id,
    });
    expect(client.startReview).toHaveBeenLastCalledWith(
      "code-agent",
      task.id,
      { target: { branch: "origin/main", type: "base_branch" } },
      { idempotencyKey: "base-review-key" },
    );
  });

  it("interrupts the active turn through the client", async () => {
    const client = {
      interruptTurn: vi.fn(() =>
        Promise.resolve({ status: "interrupting" as const, taskId: task.id, turnId: turn.id }),
      ),
      startTask: vi.fn(),
      startTurn: vi.fn(),
      uploadAttachment: vi.fn(),
    };

    await expect(
      interruptPromptTurn(client, "code-agent", task.id, turn.id, "interrupt-key"),
    ).resolves.toMatchObject({
      status: "interrupting",
    });
    expect(client.interruptTurn).toHaveBeenCalledWith("code-agent", task.id, turn.id, {
      idempotencyKey: "interrupt-key",
    });
  });
});
