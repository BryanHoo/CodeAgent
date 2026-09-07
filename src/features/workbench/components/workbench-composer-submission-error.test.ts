import { describe, expect, it, vi } from "vitest";

import { NativeCommandError } from "../../../platform/tauri/native-client.js";
import {
  createComposerSubmission,
  findUnsupportedInputModality,
  toPromptSubmissionError,
} from "./workbench-composer-submission.js";

const activeSettings = {
  approvalPolicy: "never" as const,
  approvalsReviewer: "user" as const,
  model: "gpt-5.6-sol",
  reasoningEffort: "high",
  sandboxMode: "workspace-write" as const,
};

const selectedModel = {
  defaultReasoningEffort: "high",
  description: "",
  displayName: "GPT",
  id: "gpt-5.6-sol",
  inputModalities: ["text", "image"],
  isDefault: true,
  supportedReasoningEfforts: [{ description: "", id: "high" }],
};

describe("toPromptSubmissionError", () => {
  it("maps a busy Codex thread to an actionable localized message", () => {
    const error = toPromptSubmissionError(
      new NativeCommandError(
        "CODEX_THREAD_BUSY",
        "Codex thread is active in another session",
      ),
      (key) => (key === "composer.threadBusy" ? "该任务正在另一个 Codex 会话中运行" : key),
    );

    expect(error.message).toBe("该任务正在另一个 Codex 会话中运行");
  });

  it("preserves ordinary Error instances", () => {
    const source = new Error("request timeout");

    expect(toPromptSubmissionError(source, (key) => key)).toBe(source);
  });
});

describe("findUnsupportedInputModality", () => {
  it("uses model/list input modalities for structured media", () => {
    expect(
      findUnsupportedInputModality(
        [{ kind: "image", mediaType: "image/png", name: "diagram.png" }],
        ["text"],
      ),
    ).toBe("image");
    expect(
      findUnsupportedInputModality(
        [{ kind: "file", mediaType: "audio/mpeg", name: "recording.mp3" }],
        ["text", "image"],
      ),
    ).toBe("audio");
    expect(
      findUnsupportedInputModality(
        [{ kind: "file", mediaType: "application/pdf", name: "report.pdf" }],
        ["text"],
      ),
    ).toBeUndefined();
  });
});

describe("createComposerSubmission", () => {
  it("clears an image-only steer after pending task scope becomes the real task scope", async () => {
    const clearComposerInput = vi.fn();
    const onSteerAccepted = vi.fn();
    const steerTurn = vi.fn(async () => ({
      status: "accepted" as const,
      taskId: "task-a",
      turnId: "turn-a",
    }));
    const attachment = {
      detail: "auto" as const,
      id: "asset-a",
      kind: "image" as const,
      mediaType: "image/png",
      name: "diagram.png",
      size: 4,
    };
    const submit = createComposerSubmission({
      activeSettings,
      activeTaskId: "task-a",
      activeTurnId: "turn-a",
      activeUserMessageIds: [],
      canSteer: true,
      canSubmit: true,
      clearComposerInput,
      client: { steerTurn } as never,
      composerMode: undefined,
      controller: {
        actionLock: { run: async (action: () => Promise<unknown>) => action() },
        attachmentUploadPromises: { current: new Map() },
        interruptAttempt: { current: undefined },
        isCurrentScope: () => false,
        setIsSubmitting: vi.fn(),
        setMutationError: vi.fn(),
        setPendingTaskState: vi.fn(),
        setSubmittedTurnState: vi.fn(),
        startTaskAttempt: { current: undefined },
        startTurnAttempt: { current: undefined },
        steerTurnAttempt: { current: undefined },
        uploadAttempts: { current: new Map() },
        uploadedAttachments: { current: new Map() },
      } as never,
      editingQueuedSubmission: false,
      fastMode: false,
      followUpBehavior: "steer",
      isCurrentSubmissionTarget: (projectId, taskId) =>
        projectId === "project-a" && taskId === "task-a",
      onCaptureSubmission: undefined,
      onDirectSubmission: vi.fn(),
      onGoalStarted: vi.fn(),
      onSteerAccepted,
      onTaskCreated: undefined,
      onTaskStarted: vi.fn(),
      onTurnStarted: undefined,
      pendingTask: undefined,
      projectId: "project-a",
      promptContent: [],
      routeScope: "project-a:draft:/workspace",
      saveQueuedSubmission: vi.fn(),
      selectedModel,
      selectedReasoningEffort: "high",
      skillEditorRef: { current: { getContent: () => [] } } as never,
      state: "running",
      taskId: "task-a",
      t: (key) => key,
      turnControlsDisabled: false,
    });

    await expect(
      submit({
        files: [
          {
            ...attachment,
            attachment,
            previewUrl: "asset://diagram.png",
            source: "host",
          },
        ],
        text: "",
      }),
    ).resolves.toBe(true);

    expect(steerTurn).toHaveBeenCalledOnce();
    expect(clearComposerInput).toHaveBeenCalledOnce();
    expect(onSteerAccepted).not.toHaveBeenCalled();
  });
});
