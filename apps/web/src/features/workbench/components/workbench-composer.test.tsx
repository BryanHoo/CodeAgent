import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";

import { changeAppLanguage } from "../../../i18n/i18n.js";
import {
  applyApprovalMode,
  createComposerTurnOptions,
  deriveComposerActions,
  deriveComposerInputAvailability,
  deriveComposerState,
  deriveApprovalMode,
  interruptPromptTurn,
  LARGE_PASTE_CHARACTER_THRESHOLD,
  PASTED_TEXT_ATTACHMENT_NAME,
  resolveIdempotencyAttempt,
  resolveActiveTurnId,
  resolveComposerSubmitAction,
  resolveComposerPlaceholder,
  resolveReasoningEffort,
  resolvePromptAttachment,
  startPromptTurn,
  startTaskReview,
  steerPromptTurn,
} from "./workbench-composer.js";
import {
  createComposerBranch,
  createComposerWorktree,
  switchComposerBranch,
  switchComposerWorktree,
} from "../hooks/use-workbench-branch-switch.js";

const rootPath = "/workspace/CodeAgent";

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
  it("uses concise placeholders for new and existing tasks", () => {
    expect(resolveComposerPlaceholder(undefined)).toBe("告诉 CodeAgent 你想完成什么");
    expect(resolveComposerPlaceholder("task-1")).toBe("输入后续要求");
  });

  it("adds plan mode only to the active Turn options", () => {
    expect(createComposerTurnOptions(task.settings, model.id, "high", "plan", false)).toEqual({
      ...task.settings,
      collaborationMode: "plan",
      model: model.id,
      reasoningEffort: "high",
    });
    expect(createComposerTurnOptions(task.settings, model.id, "high", undefined, false)).toEqual({
      ...task.settings,
      model: model.id,
      reasoningEffort: "high",
    });
  });

  it("adds goal mode only to the first Goal Turn options", () => {
    expect(createComposerTurnOptions(task.settings, model.id, "high", "goal", false)).toEqual({
      ...task.settings,
      goalMode: true,
      model: model.id,
      reasoningEffort: "high",
    });
  });

  it("adds fast mode only to the active Turn options", () => {
    expect(createComposerTurnOptions(task.settings, model.id, "high", undefined, true)).toEqual({
      ...task.settings,
      fastMode: true,
      model: model.id,
      reasoningEffort: "high",
    });
  });

  it("resolves Composer placeholders in English", async () => {
    await changeAppLanguage("en");
    try {
      expect(resolveComposerPlaceholder(undefined)).toBe(
        "Tell CodeAgent what you want to accomplish",
      );
      expect(resolveComposerPlaceholder("task-1")).toBe("Enter follow-up instructions");
    } finally {
      await changeAppLanguage("zh-CN");
    }
  });

  it("uses the official large-paste threshold and attachment name", () => {
    expect(LARGE_PASTE_CHARACTER_THRESHOLD).toBe(1_000);
    expect(PASTED_TEXT_ATTACHMENT_NAME).toBe("Pasted text.txt");
  });

  it("reuses an imported host attachment without uploading browser content again", async () => {
    const attachment = {
      id: "host-image",
      kind: "image" as const,
      mediaType: "image/png",
      name: "screen.png",
      size: 68,
    };
    const uploadBrowserAttachment = vi.fn();

    await expect(
      resolvePromptAttachment(
        {
          attachment,
          id: attachment.id,
          kind: attachment.kind,
          mediaType: attachment.mediaType,
          name: attachment.name,
          previewUrl: "/v1/projects/code-agent/files/image?path=screen.png",
          size: attachment.size,
          source: "host",
        },
        uploadBrowserAttachment,
      ),
    ).resolves.toEqual(attachment);
    expect(uploadBrowserAttachment).not.toHaveBeenCalled();
  });

  it("derives available actions from provider capabilities and task context", () => {
    const capabilities = {
      feedback: { upload: false },
      provider: "fake",
      skills: { list: false, use: false },
      tasks: { fork: false, list: true, read: true, start: false },
      turns: {
        compact: false,
        interrupt: false,
        review: false,
        start: true,
        steer: false,
      },
    };

    expect(deriveComposerActions(undefined, false)).toEqual({
      canInterrupt: false,
      canSubmit: false,
      canSteer: false,
    });
    expect(deriveComposerActions(capabilities, false)).toEqual({
      canInterrupt: false,
      canSubmit: false,
      canSteer: false,
    });
    expect(deriveComposerActions(capabilities, true)).toEqual({
      canInterrupt: false,
      canSubmit: true,
      canSteer: false,
    });
  });

  it("routes active-turn submissions to steer or queue while preserving interrupt", () => {
    expect(resolveComposerSubmitAction("idle", true, "queue", true)).toBe("start");
    expect(resolveComposerSubmitAction("running", false, "queue", true)).toBe("interrupt");
    expect(resolveComposerSubmitAction("running", true, "queue", true)).toBe("queue");
    expect(resolveComposerSubmitAction("running", true, "steer", true)).toBe("steer");
    expect(resolveComposerSubmitAction("running", true, "steer", false)).toBe("blocked");
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
    const onTaskCreated = vi.fn();
    const client = {
      interruptTurn: vi.fn(),
      startTask: vi.fn(() => Promise.resolve({ task })),
      startTurn: vi.fn(() => {
        expect(onTaskCreated).toHaveBeenCalledWith(task);
        return Promise.resolve({ taskId: task.id, turn });
      }),
      uploadAttachment: vi.fn(),
    };

    await expect(
      startPromptTurn(client, {
        idempotencyKeys: { startTask: "task-key", startTurn: "turn-key" },
        input: { attachments: [], skills: [], text: "首次提交", type: "prompt" },
        onTaskCreated,
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
    expect(onTaskCreated).toHaveBeenCalledOnce();
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

  it("steers the active turn through the client", async () => {
    const client = {
      steerTurn: vi.fn(() =>
        Promise.resolve({ status: "accepted" as const, taskId: task.id, turnId: turn.id }),
      ),
    };
    const input = { attachments: [], skills: [], text: "补充约束", type: "prompt" as const };

    await expect(
      steerPromptTurn(client, "code-agent", task.id, turn.id, input, "steer-key"),
    ).resolves.toMatchObject({ status: "accepted" });
    expect(client.steerTurn).toHaveBeenCalledWith("code-agent", task.id, turn.id, input, {
      idempotencyKey: "steer-key",
    });
  });

  it("switches a local branch and replaces the shared Git status cache", async () => {
    const queryClient = new QueryClient();
    const currentStatus = {
      baseBranches: ["origin/main", "main"],
      branch: "feat/review",
      branches: ["feat/review", "main"],
      repositoryMode: "root" as const,
      snapshot: "a".repeat(64),
      staged: [],
      unstaged: [],
    };
    const nextStatus = {
      ...currentStatus,
      baseBranches: ["origin/main", "feat/review"],
      branch: "main",
      branches: ["main", "feat/review"],
      snapshot: "b".repeat(64),
    };
    const client = { switchProjectBranch: vi.fn(() => Promise.resolve(nextStatus)) };
    const cancelQueries = vi.spyOn(queryClient, "cancelQueries");

    await expect(
      switchComposerBranch(client, queryClient, "code-agent", rootPath, currentStatus, "main"),
    ).resolves.toBe(true);

    expect(client.switchProjectBranch).toHaveBeenCalledWith("code-agent", rootPath, {
      branch: "main",
      expectedSnapshot: currentStatus.snapshot,
    });
    expect(cancelQueries).toHaveBeenCalledWith({
      exact: true,
      queryKey: ["projects", "code-agent", rootPath, "git-status"],
    });
    expect(queryClient.getQueryData(["projects", "code-agent", rootPath, "git-status"])).toEqual(
      nextStatus,
    );
  });

  it("does not switch unavailable or already active branches", async () => {
    const queryClient = new QueryClient();
    const client = { switchProjectBranch: vi.fn() };
    const status = {
      baseBranches: ["origin/main"],
      branch: "main",
      branches: ["main"],
      repositoryMode: "root" as const,
      snapshot: "a".repeat(64),
      staged: [],
      unstaged: [],
    };

    await expect(
      switchComposerBranch(client, queryClient, "code-agent", rootPath, status, "main"),
    ).resolves.toBe(false);
    await expect(
      switchComposerBranch(client, queryClient, "code-agent", rootPath, status, "missing"),
    ).resolves.toBe(false);
    expect(client.switchProjectBranch).not.toHaveBeenCalled();
  });

  it("creates a local branch and replaces the shared Git status cache", async () => {
    const queryClient = new QueryClient();
    const currentStatus = {
      baseBranches: ["origin/main", "main"],
      branch: "main",
      branches: ["main"],
      repositoryMode: "root" as const,
      snapshot: "a".repeat(64),
      staged: [],
      unstaged: [],
    };
    const nextStatus = {
      ...currentStatus,
      branch: "feat/new-branch",
      branches: ["feat/new-branch", "main"],
      snapshot: "b".repeat(64),
    };
    const client = { createProjectBranch: vi.fn(() => Promise.resolve(nextStatus)) };
    const cancelQueries = vi.spyOn(queryClient, "cancelQueries");

    await expect(
      createComposerBranch(
        client,
        queryClient,
        "code-agent",
        rootPath,
        currentStatus,
        "feat/new-branch",
      ),
    ).resolves.toBe(true);

    expect(client.createProjectBranch).toHaveBeenCalledWith("code-agent", rootPath, {
      branch: "feat/new-branch",
      expectedSnapshot: currentStatus.snapshot,
    });
    expect(cancelQueries).toHaveBeenCalledWith({
      exact: true,
      queryKey: ["projects", "code-agent", rootPath, "git-status"],
    });
    expect(queryClient.getQueryData(["projects", "code-agent", rootPath, "git-status"])).toEqual(
      nextStatus,
    );
  });

  it("does not create empty, duplicate, or read-only branches", async () => {
    const queryClient = new QueryClient();
    const client = { createProjectBranch: vi.fn() };
    const status = {
      baseBranches: ["origin/main"],
      branch: "main",
      branches: ["main"],
      repositoryMode: "root" as const,
      snapshot: "a".repeat(64),
      staged: [],
      unstaged: [],
    };

    await expect(
      createComposerBranch(client, queryClient, "code-agent", rootPath, status, ""),
    ).resolves.toBe(false);
    await expect(
      createComposerBranch(client, queryClient, "code-agent", rootPath, status, "main"),
    ).resolves.toBe(false);
    await expect(
      createComposerBranch(
        client,
        queryClient,
        "code-agent",
        rootPath,
        { ...status, repositoryMode: "children" },
        "feat/new",
      ),
    ).resolves.toBe(false);
    expect(client.createProjectBranch).not.toHaveBeenCalled();
  });

  it("creates a worktree and writes its target project into shared caches", async () => {
    const queryClient = new QueryClient();
    const status = {
      baseBranches: ["origin/main"],
      branch: "main",
      branches: ["main"],
      repositoryMode: "root" as const,
      snapshot: "a".repeat(64),
      staged: [],
      unstaged: [],
    };
    const response = {
      project: {
        createdAt: "2026-08-18T00:00:00.000Z",
        id: "code-agent-worktree",
        name: "CodeAgent-feat-review",
        roots: [{ path: "/workspace/CodeAgent-feat-review" }],
      },
      worktree: {
        branch: "feat/review",
        current: false,
        path: "/workspace/CodeAgent-feat-review",
      },
    };
    const client = { createProjectWorktree: vi.fn(() => Promise.resolve(response)) };

    await expect(
      createComposerWorktree(client, queryClient, "code-agent", rootPath, status, " feat/review "),
    ).resolves.toEqual(response.project);

    expect(client.createProjectWorktree).toHaveBeenCalledWith("code-agent", rootPath, {
      branch: "feat/review",
      expectedSnapshot: status.snapshot,
    });
    expect(queryClient.getQueryData(["projects"])).toEqual({
      data: [response.project],
      nextCursor: null,
    });
    expect(queryClient.getQueryData(["projects", "code-agent", rootPath, "git-worktrees"])).toEqual(
      {
        worktrees: [response.worktree],
      },
    );
  });

  it("switches only to a listed non-current worktree", async () => {
    const queryClient = new QueryClient();
    const worktree = {
      branch: "feat/review",
      current: false,
      path: "/workspace/CodeAgent-feat-review",
    };
    const response = {
      project: {
        createdAt: "2026-08-18T00:00:00.000Z",
        id: "code-agent-worktree",
        name: "CodeAgent-feat-review",
        roots: [{ path: worktree.path }],
      },
      worktree,
    };
    const client = { switchProjectWorktree: vi.fn(() => Promise.resolve(response)) };

    await expect(
      switchComposerWorktree(
        client,
        queryClient,
        "code-agent",
        rootPath,
        [worktree],
        worktree.path,
      ),
    ).resolves.toEqual(response.project);
    await expect(
      switchComposerWorktree(
        client,
        queryClient,
        "code-agent",
        rootPath,
        [worktree],
        "/workspace/missing",
      ),
    ).resolves.toBeUndefined();

    expect(client.switchProjectWorktree).toHaveBeenCalledOnce();
    expect(client.switchProjectWorktree).toHaveBeenCalledWith("code-agent", rootPath, {
      path: worktree.path,
    });
  });
});
