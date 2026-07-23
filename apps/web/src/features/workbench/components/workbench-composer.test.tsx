import { describe, expect, it, vi } from "vitest";

import {
  deriveComposerActions,
  deriveComposerState,
  interruptPromptTurn,
  resolveIdempotencyAttempt,
  resolveActiveTurnId,
  startPromptTurn,
} from "./workbench-composer.js";

const task = {
  id: "task-1",
  pinned: false,
  projectId: "code-agent",
  title: "新任务",
  updatedAt: "2026-07-23T00:00:00.000Z",
};

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
      provider: "fake",
      tasks: { list: true, read: true, start: false },
      turns: { interrupt: false, start: true },
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

  it("reuses an idempotency key until the mutation fingerprint changes", () => {
    const createKey = vi.fn().mockReturnValueOnce("key-1").mockReturnValueOnce("key-2");
    const first = resolveIdempotencyAttempt(undefined, "start-turn:task-1:首次提交", createKey);
    const retried = resolveIdempotencyAttempt(first, "start-turn:task-1:首次提交", createKey);
    const changed = resolveIdempotencyAttempt(retried, "start-turn:task-1:修改后提交", createKey);

    expect(retried).toBe(first);
    expect(changed).toEqual({ fingerprint: "start-turn:task-1:修改后提交", key: "key-2" });
    expect(createKey).toHaveBeenCalledTimes(2);
  });

  it("creates a task before its first turn and continues existing tasks directly", async () => {
    const client = {
      interruptTurn: vi.fn(),
      startTask: vi.fn(() => Promise.resolve({ task })),
      startTurn: vi.fn(() => Promise.resolve({ taskId: task.id, turn })),
    };

    await expect(
      startPromptTurn(client, {
        idempotencyKeys: { startTask: "task-key", startTurn: "turn-key" },
        input: { text: "首次提交", type: "text" },
        projectId: "code-agent",
      }),
    ).resolves.toEqual({ createdTask: task, taskId: task.id, turn });
    await expect(
      startPromptTurn(client, {
        idempotencyKeys: { startTurn: "existing-turn-key" },
        input: { text: "继续任务", type: "text" },
        projectId: "code-agent",
        taskId: task.id,
      }),
    ).resolves.toEqual({ taskId: task.id, turn });

    expect(client.startTask).toHaveBeenCalledTimes(1);
    expect(client.startTask).toHaveBeenCalledWith("code-agent", { idempotencyKey: "task-key" });
    expect(client.startTurn).toHaveBeenNthCalledWith(
      1,
      task.id,
      {
        text: "首次提交",
        type: "text",
      },
      { idempotencyKey: "turn-key" },
    );
    expect(client.startTurn).toHaveBeenNthCalledWith(
      2,
      task.id,
      {
        text: "继续任务",
        type: "text",
      },
      { idempotencyKey: "existing-turn-key" },
    );
  });

  it("interrupts the active turn through the client", async () => {
    const client = {
      interruptTurn: vi.fn(() =>
        Promise.resolve({ status: "interrupting" as const, taskId: task.id, turnId: turn.id }),
      ),
      startTask: vi.fn(),
      startTurn: vi.fn(),
    };

    await expect(
      interruptPromptTurn(client, task.id, turn.id, "interrupt-key"),
    ).resolves.toMatchObject({
      status: "interrupting",
    });
    expect(client.interruptTurn).toHaveBeenCalledWith(task.id, turn.id, {
      idempotencyKey: "interrupt-key",
    });
  });
});
