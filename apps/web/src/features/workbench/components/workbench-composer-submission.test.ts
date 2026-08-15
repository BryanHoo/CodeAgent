import { describe, expect, it, vi } from "vitest";

import { createAsyncActionLock } from "../../../shared/utils/async-action-lock.js";
import { createComposerDraftStore } from "../composer-draft-context.js";
import { createPromptSkillContent } from "./prompt-skill-content.js";
import { createComposerSubmission } from "./workbench-composer-submission.js";

type ComposerSubmissionOptions = Parameters<typeof createComposerSubmission>[0];

const settings = {
  approvalPolicy: "on-request",
  approvalsReviewer: "user",
  model: "gpt-5.6-sol",
  reasoningEffort: "high",
  sandboxMode: "workspace-write",
} as const;

const model = {
  defaultReasoningEffort: "high",
  description: "适合复杂编码任务",
  displayName: "GPT-5.6 Sol",
  id: "gpt-5.6-sol",
  isDefault: true,
  supportedReasoningEfforts: [{ description: "深入分析", id: "high" }],
} as const;

const task = {
  id: "task-created",
  pinned: false,
  projectId: "code-agent",
  title: "新任务",
  updatedAt: "2026-08-11T00:00:00.000Z",
} as const;

const turn: Awaited<ReturnType<ComposerSubmissionOptions["client"]["startTurn"]>>["turn"] = {
  completedAt: null,
  error: null,
  id: "turn-created",
  items: [],
  startedAt: "2026-08-11T00:00:00.000Z",
  status: "running",
};

function createHarness(overrides: Partial<ComposerSubmissionOptions> = {}) {
  const promptContent = createPromptSkillContent("提交内容");
  const setAttachments = vi.fn();
  const setIsSubmitting = vi.fn();
  const setMutationError = vi.fn();
  const setPendingTaskState = vi.fn();
  const setPromptContent = vi.fn();
  const setQueuedPrompts = vi.fn();
  const setSubmittedTurnState = vi.fn();
  const startTask = vi.fn<ComposerSubmissionOptions["client"]["startTask"]>(() =>
    Promise.resolve({ task }),
  );
  const startTurn = vi.fn<ComposerSubmissionOptions["client"]["startTurn"]>(() =>
    Promise.resolve({ taskId: task.id, turn }),
  );
  const draftStore = createComposerDraftStore();
  const skillEditor = {
    focus: vi.fn(),
    getContent: vi.fn(() => promptContent),
    replace: vi.fn(),
  };
  const controller = {
    actionLock: createAsyncActionLock(),
    isCurrentScope: vi.fn(() => true),
    setIsSubmitting,
    setMutationError,
    setPendingTaskState,
    setSubmittedTurnState,
    startTaskAttempt: { current: undefined },
    startTurnAttempt: { current: undefined },
    steerTurnAttempt: { current: undefined },
    uploadAttempts: { current: new Map() },
    uploadedAttachments: { current: new Map() },
  };
  const onTaskCreated = vi.fn();
  const onTaskStarted = vi.fn();
  const onTurnStarted = vi.fn();
  const options = {
    activeSettings: settings,
    activeTaskId: undefined,
    activeTurnId: undefined,
    canSteer: false,
    canSubmit: true,
    clearComposerInput: vi.fn(),
    client: { startTask, startTurn },
    composerDraftStore: draftStore,
    composerMode: undefined,
    composerScope: "code-agent:draft",
    controller,
    followUpBehavior: "queue",
    onDirectSubmission: vi.fn(),
    onGoalStarted: vi.fn(),
    onRequestNotificationPermission: vi.fn(),
    onTaskCreated,
    onTaskStarted,
    onTurnStarted,
    pendingTask: undefined,
    projectId: "code-agent",
    promptContent,
    queuedPrompts: [],
    routeScope: "code-agent:draft",
    selectedModel: model,
    selectedReasoningEffort: "high",
    setAttachments,
    setPromptContent,
    setQueuedPrompts,
    skillEditorRef: { current: skillEditor },
    state: "idle",
    taskId: undefined,
    t: (key: string) => key,
    turnControlsDisabled: false,
    ...overrides,
  } as ComposerSubmissionOptions;

  return {
    controller,
    onTaskCreated,
    onTaskStarted,
    onTurnStarted,
    options,
    setAttachments,
    setPromptContent,
    setQueuedPrompts,
    skillEditor,
    startTask,
    startTurn,
    submit: createComposerSubmission(options),
  };
}

describe("createComposerSubmission", () => {
  it("rejects an empty Goal objective before starting a mutation", async () => {
    const harness = createHarness({ composerMode: "goal" });

    const submitted = await harness.submit({ files: [], text: "   " });

    expect(submitted).toBe(false);
    expect(harness.controller.setMutationError).toHaveBeenCalledWith(
      new Error("composer.goalObjectiveRequired"),
    );
    expect(harness.startTask).not.toHaveBeenCalled();
    expect(harness.startTurn).not.toHaveBeenCalled();
  });

  it("queues a follow-up and clears the active draft while a Turn is running", async () => {
    const harness = createHarness({
      activeTaskId: "task-1",
      activeTurnId: "turn-1",
      canSteer: true,
      state: "running",
      taskId: "task-1",
    });

    const submitted = await harness.submit({ files: [], text: "排队处理" });

    expect(submitted).toBe(true);
    expect(harness.setQueuedPrompts).toHaveBeenCalledWith([
      expect.objectContaining({ files: [], skills: [], text: "排队处理" }),
    ]);
    expect(harness.setPromptContent).toHaveBeenCalledWith([]);
    expect(harness.setAttachments).toHaveBeenCalledWith([]);
    expect(harness.skillEditor.replace).toHaveBeenCalledWith([]);
    expect(harness.startTurn).not.toHaveBeenCalled();
  });

  it("creates a new Task and starts its first Turn with one submission", async () => {
    const harness = createHarness();

    const submitted = await harness.submit({ files: [], text: "提交内容" });

    expect(submitted).toBe(true);
    const [startTaskProjectId, startTaskOptions] = harness.startTask.mock.calls[0] ?? [];
    expect(startTaskProjectId).toBe("code-agent");
    expect(startTaskOptions?.idempotencyKey).toMatch(/\S/u);
    const [startTurnProjectId, startedTaskId, input, turnSettings, startTurnOptions] =
      harness.startTurn.mock.calls[0] ?? [];
    expect(startTurnProjectId).toBe("code-agent");
    expect(startedTaskId).toBe(task.id);
    expect(input).toEqual({ attachments: [], skills: [], text: "提交内容", type: "prompt" });
    expect(turnSettings).toEqual(settings);
    expect(startTurnOptions?.idempotencyKey).toMatch(/\S/u);
    expect(harness.onTaskCreated).toHaveBeenCalledWith(task);
    expect(harness.onTurnStarted).toHaveBeenCalledWith(turn, expect.any(Object), []);
    expect(harness.onTaskStarted).toHaveBeenCalledWith(
      task,
      turn,
      expect.any(Object),
      settings,
      [],
    );
    expect(harness.controller.setSubmittedTurnState).toHaveBeenCalledWith({
      scope: "code-agent:draft",
      turnId: turn.id,
    });
  });

  it("keeps a direct steer in a waiting composer state until its user message arrives", async () => {
    const steerTurn = vi.fn(() =>
      Promise.resolve({ status: "accepted" as const, taskId: "task-1", turnId: "turn-1" }),
    );
    const harness = createHarness({
      activeTaskId: "task-1",
      activeTurnId: "turn-1",
      canSteer: true,
      client: {
        startTask: vi.fn(),
        startTurn: vi.fn(),
        steerTurn,
      } as unknown as ComposerSubmissionOptions["client"],
      followUpBehavior: "steer",
      state: "running",
      taskId: "task-1",
    });

    await expect(harness.submit({ files: [], text: "立即引导" })).resolves.toBe(true);
    expect(harness.setQueuedPrompts).toHaveBeenCalledWith([
      expect.objectContaining({
        deliveryState: "awaiting_acknowledgement",
        deliveryTurnId: "turn-1",
        presentation: "composer",
        text: "立即引导",
      }),
    ]);
    expect(harness.options.composerDraftStore.read("code-agent:draft").queuedPrompts).toEqual([
      expect.objectContaining({ deliveryTurnId: "turn-1" }),
    ]);
    expect(harness.options.clearComposerInput).not.toHaveBeenCalled();
  });

  it("keeps an automatically started queued message waiting for its Codex user item", async () => {
    const queuedPrompt = {
      acknowledgedUserMessageIds: [],
      deliveryState: "queued" as const,
      files: [],
      id: "queued-1",
      presentation: "queue" as const,
      skills: [],
      text: "顺序发送",
    };
    const harness = createHarness({
      activeTaskId: "task-1",
      queuedPrompts: [queuedPrompt],
      taskId: "task-1",
    });

    await expect(
      harness.submit({ files: [], text: queuedPrompt.text }, [], {
        clearInputOnSuccess: false,
        forceAction: "start",
        queuedPrompt,
      }),
    ).resolves.toBe(true);
    expect(harness.setQueuedPrompts).toHaveBeenCalledWith([
      expect.objectContaining({
        deliveryState: "awaiting_acknowledgement",
        id: queuedPrompt.id,
      }),
    ]);
  });
});
