import type {
  AgentAttachment,
  AgentCapabilities,
  AgentGlobalSettings,
  AgentMessageAttachment,
  AgentModel,
  AgentPromptInput,
  AgentReviewTarget,
  AgentSkill,
  AgentTask,
  AgentTaskSettings,
  AgentTurn,
  AgentTurnOptions,
  HostFileKind,
  ProjectGitStatus,
} from "@code-agent/protocol";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { v4 as createUuid } from "uuid";

import type { TaskRuntimeView } from "../../conversation/runtime/use-task-runtime.js";
import type { CodeAgentMutationClient } from "../../projects/project-queries.js";
import {
  createComposerDraftScope,
  useComposerDraftStore,
  type QueuedComposerPrompt,
} from "../composer-draft-context.js";
import type {
  BrowserPromptInputAttachment,
  PromptInputAttachment,
  PromptInputMessage,
} from "../../../shared/ai-elements/prompt-input.js";
import { useTranslation } from "../../../i18n/i18n.js";
import { useWorkbenchComposerController } from "../hooks/use-workbench-composer-controller.js";
import { WorkbenchComposerView } from "./workbench-composer-view.js";
import { HostAttachmentPickerDialog } from "./host-attachment-picker-dialog.js";
import {
  insertPromptSkill,
  isPromptSkillContentEmpty,
  removePromptSlashCommand,
  toPromptSkillSubmission,
  type PromptSkillContent,
  type PromptSkillEditorHandle,
} from "./prompt-skill-editor.js";
import {
  filterPromptCommandItems,
  filterPromptSkills,
  getPromptCommandItems,
  getPromptCommandAvailability,
  resolvePromptSlashCommand,
  type PromptCommandItem,
  type PromptSlashCommand,
} from "./prompt-command.js";

export {
  LARGE_PASTE_CHARACTER_THRESHOLD,
  PASTED_TEXT_ATTACHMENT_NAME,
  applyApprovalMode,
  deriveApprovalMode,
  deriveComposerActions,
  deriveComposerInputAvailability,
  deriveComposerState,
  interruptPromptTurn,
  resolveActiveTurnId,
  resolveComposerPlaceholder,
  resolveComposerSubmitAction,
  resolveIdempotencyAttempt,
  resolveReasoningEffort,
  startPromptTurn,
  startTaskReview,
  steerPromptTurn,
  type ApprovalMode,
  type ComposerState,
  type ComposerSubmitAction,
  type IdempotencyAttempt,
} from "../composer-state.js";
import {
  deriveComposerActions,
  deriveComposerInputAvailability,
  deriveComposerState,
  interruptPromptTurn,
  resolveActiveTurnId,
  resolveComposerSubmitAction,
  resolveIdempotencyAttempt,
  resolveReasoningEffort,
  startPromptTurn,
  startTaskReview,
  steerPromptTurn,
} from "../composer-state.js";

export function createComposerTurnOptions(
  settings: AgentTaskSettings,
  model: string,
  reasoningEffort: string | undefined,
  planModeEnabled: boolean,
): AgentTurnOptions {
  return {
    ...settings,
    ...(planModeEnabled ? { collaborationMode: "plan" as const } : {}),
    model,
    reasoningEffort: reasoningEffort ?? settings.reasoningEffort,
  };
}

type WorkbenchComposerProps = Readonly<{
  capabilities: AgentCapabilities | undefined;
  client: CodeAgentMutationClient;
  followUpBehavior: AgentGlobalSettings["followUpBehavior"];
  models: readonly AgentModel[];
  modelsError: Error | null;
  modelsPending: boolean;
  onSettingsChange: (
    settings: AgentTaskSettings,
    field: keyof AgentTaskSettings,
  ) => Promise<void> | void;
  onRequestNotificationPermission: () => void;
  onDirectSubmission?: () => void;
  onSubmissionStateChange?: (submitting: boolean) => void;
  onTaskCreated?: (task: AgentTask) => void;
  onTurnStarted?: (
    turn: AgentTurn,
    input: AgentPromptInput,
    messageAttachments: readonly AgentMessageAttachment[],
  ) => void;
  onTaskStarted: (
    task: AgentTask,
    turn?: AgentTurn,
    input?: AgentPromptInput,
    settings?: AgentTaskSettings,
    messageAttachments?: readonly AgentMessageAttachment[],
  ) => void;
  projectId: string;
  projectPath: string;
  gitStatus?: ProjectGitStatus;
  runtime?: TaskRuntimeView;
  settings: AgentTaskSettings;
  skills: readonly AgentSkill[];
  taskId?: string;
}>;

export async function resolvePromptAttachment(
  attachment: PromptInputAttachment,
  uploadBrowserAttachment: (attachment: BrowserPromptInputAttachment) => Promise<AgentAttachment>,
): Promise<AgentAttachment> {
  if (attachment.source === "host") {
    return attachment.attachment;
  }
  return uploadBrowserAttachment(attachment);
}

export function WorkbenchComposer({
  capabilities,
  client,
  followUpBehavior,
  models,
  modelsError,
  modelsPending,
  onDirectSubmission,
  onRequestNotificationPermission,
  onSettingsChange,
  onSubmissionStateChange,
  onTaskCreated,
  onTaskStarted,
  onTurnStarted,
  projectId,
  projectPath,
  gitStatus,
  runtime,
  settings,
  skills,
  taskId,
}: WorkbenchComposerProps) {
  const { t } = useTranslation(["workbench", "settings"]);
  const routeScope = `${projectId}:${taskId ?? "draft"}`;
  const composerScope = createComposerDraftScope(projectId, taskId);
  const composerDraftStore = useComposerDraftStore();
  const initialComposerDraft = composerDraftStore.read(composerScope);
  const [settingsOverride, setSettingsOverride] = useState<{
    scope: string;
    settings: AgentTaskSettings;
  }>();
  const [activeCommandIndex, setActiveCommandIndex] = useState(0);
  const [attachments, setAttachments] = useState<readonly PromptInputAttachment[]>(
    initialComposerDraft.attachments,
  );
  const [attachmentPickerKind, setAttachmentPickerKind] = useState<HostFileKind>();
  const [commandMenuOpen, setCommandMenuOpen] = useState(false);
  const [reviewMenuMode, setReviewMenuMode] = useState<"branches" | "scopes" | null>(null);
  const [commandNotice, setCommandNotice] = useState<string>();
  const [commandQuery, setCommandQuery] = useState("");
  const [commandSlashCommand, setCommandSlashCommand] = useState<PromptSlashCommand>();
  const [promptContent, setPromptContent] = useState<PromptSkillContent>(
    initialComposerDraft.content,
  );
  const [planModeState, setPlanModeState] = useState<Readonly<{ scope: string }>>();
  const [queuedPrompts, setQueuedPrompts] = useState<readonly QueuedComposerPrompt[]>(
    initialComposerDraft.queuedPrompts,
  );
  const {
    actionLock: composerActionLock,
    autoStartedQueueIds,
    commandAttempts,
    interruptAttempt,
    isCurrentScope,
    isSubmitting,
    mutationError,
    pendingTaskState,
    reset: resetController,
    setIsSubmitting,
    setMutationError,
    setPendingTaskState,
    setSubmittedTurnState,
    startTaskAttempt,
    startTurnAttempt,
    steerTurnAttempt,
    submittedTurnState,
    uploadAttempts,
    uploadedAttachments,
  } = useWorkbenchComposerController(routeScope, onSubmissionStateChange);
  const commandMenuId = useId();
  const commandSurfaceRef = useRef<HTMLDivElement>(null);
  const skillEditorRef = useRef<PromptSkillEditorHandle>(null);
  const previousRouteScopeRef = useRef(routeScope);
  const previousComposerScopeRef = useRef(composerScope);
  const submittedTurnId =
    submittedTurnState?.scope === routeScope ? submittedTurnState.turnId : undefined;
  const pendingTask = pendingTaskState?.scope === routeScope ? pendingTaskState.task : undefined;
  const activeTurnId = resolveActiveTurnId(runtime?.snapshot, submittedTurnId);
  const activeTaskId = taskId ?? pendingTask?.id;
  const { canInterrupt, canSubmit, canSteer } = deriveComposerActions(
    capabilities,
    activeTaskId !== undefined,
  );
  const connectionState = runtime?.connectionState ?? "connected";
  const state = deriveComposerState({
    activeTurnId,
    connectionState,
    isSubmitting,
    mutationFailed: mutationError !== null || runtime?.error !== null,
  });
  const promptSubmission = toPromptSkillSubmission(promptContent);
  const activeSettings =
    settingsOverride?.scope === routeScope ? settingsOverride.settings : settings;
  const planModeEnabled = planModeState?.scope === routeScope;
  const selectedModel =
    models.find((model) => model.id === activeSettings.model) ??
    models.find((model) => model.isDefault) ??
    models[0];
  const selectedReasoningEffort = resolveReasoningEffort(
    selectedModel,
    activeSettings.reasoningEffort,
  );
  const contextUsage = runtime?.snapshot?.contextUsage;
  const attachmentCount = attachments.length;
  const { attachmentsDisabled, draftInputDisabled, turnControlsDisabled } =
    deriveComposerInputAvailability(state);

  const filteredSkills = filterPromptSkills(
    capabilities?.skills.use === true ? skills : [],
    commandQuery,
  );
  const filteredCommands = filterPromptCommandItems(getPromptCommandItems(), commandQuery);
  const baseBranches = gitStatus?.baseBranches ?? [];
  const menuItemCount =
    reviewMenuMode === "scopes"
      ? 2
      : reviewMenuMode === "branches"
        ? baseBranches.length
        : filteredSkills.length + filteredCommands.length;
  const activeCommandItemId =
    !commandMenuOpen || menuItemCount === 0
      ? undefined
      : `${commandMenuId}-item-${String(activeCommandIndex)}`;
  const handleAttachmentsChange = useCallback(
    (files: readonly PromptInputAttachment[]) => {
      setAttachments(files);
      composerDraftStore.update(composerScope, (current) => ({
        ...current,
        attachments: files,
      }));
    },
    [composerDraftStore, composerScope],
  );
  const closeCommandMenu = useCallback(() => {
    setCommandMenuOpen(false);
    setCommandQuery("");
    setCommandSlashCommand(undefined);
    setReviewMenuMode(null);
  }, []);
  const replacePromptContent = useCallback(
    (nextContent: PromptSkillContent, cursorOffset?: number) => {
      setPromptContent(nextContent);
      composerDraftStore.update(composerScope, (current) => ({
        ...current,
        content: nextContent,
      }));
      // 程序化命令直接同步编辑 DOM，避免受控回写破坏 IME 组合缓冲。
      skillEditorRef.current?.replace(nextContent, cursorOffset);
    },
    [composerDraftStore, composerScope],
  );

  const clearComposerInput = useCallback(() => {
    composerDraftStore.update(composerScope, (current) => ({
      ...current,
      attachments: [],
      content: [],
    }));
    setPromptContent([]);
    setAttachments([]);
    skillEditorRef.current?.replace([]);
  }, [composerDraftStore, composerScope]);

  const replaceQueuedPrompts = useCallback(
    (nextQueuedPrompts: readonly QueuedComposerPrompt[]) => {
      setQueuedPrompts(nextQueuedPrompts);
      composerDraftStore.update(composerScope, (current) => ({
        ...current,
        queuedPrompts: nextQueuedPrompts,
      }));
    },
    [composerDraftStore, composerScope],
  );

  useLayoutEffect(() => {
    if (previousRouteScopeRef.current === routeScope) {
      return;
    }
    previousRouteScopeRef.current = routeScope;
    const composerScopeChanged = previousComposerScopeRef.current !== composerScope;
    if (composerScopeChanged) {
      previousComposerScopeRef.current = composerScope;
      const restoredDraft = composerDraftStore.read(composerScope);
      // 切换聊天时恢复对应草稿，同时保留编辑节点和焦点，避免重建原生 IME 会话。
      setPromptContent(restoredDraft.content);
      setAttachments(restoredDraft.attachments);
      setAttachmentPickerKind(undefined);
      setQueuedPrompts(restoredDraft.queuedPrompts);
      skillEditorRef.current?.replace(restoredDraft.content);
      setSettingsOverride(undefined);
      setActiveCommandIndex(0);
      setCommandMenuOpen(false);
      setReviewMenuMode(null);
      setCommandNotice(undefined);
      setCommandQuery("");
      setCommandSlashCommand(undefined);
    }
    // 路由相关请求结果不能写入刚激活的其他聊天。
    resetController(composerScopeChanged);
  }, [composerDraftStore, composerScope, resetController, routeScope]);

  const updateSettings = (nextSettings: AgentTaskSettings, field: keyof AgentTaskSettings) => {
    const requestScope = routeScope;
    setSettingsOverride({ scope: requestScope, settings: nextSettings });
    setMutationError(null);
    // 设置写回由用户事件直接触发，避免 effect 重放或并发渲染造成重复请求。
    void Promise.resolve(onSettingsChange(nextSettings, field)).catch((error: unknown) => {
      if (isCurrentScope(requestScope)) {
        setMutationError(error instanceof Error ? error : new Error("Settings update failed"));
      }
    });
  };

  useEffect(() => {
    if (turnControlsDisabled) {
      closeCommandMenu();
    }
  }, [closeCommandMenu, turnControlsDisabled]);

  useEffect(() => {
    if (!commandMenuOpen) {
      return undefined;
    }
    const handleDocumentKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeCommandMenu();
      }
    };
    const handleDocumentPointerDown = (event: PointerEvent) => {
      const eventTarget = event.target;
      if (eventTarget instanceof Node && !commandSurfaceRef.current?.contains(eventTarget)) {
        // 输入框和命令弹层共享一个交互区域，只有点击区域外部才关闭弹层。
        closeCommandMenu();
      }
    };
    document.addEventListener("keydown", handleDocumentKeyDown, true);
    document.addEventListener("pointerdown", handleDocumentPointerDown, true);
    return () => {
      document.removeEventListener("keydown", handleDocumentKeyDown, true);
      document.removeEventListener("pointerdown", handleDocumentPointerDown, true);
    };
  }, [closeCommandMenu, commandMenuOpen]);

  const focusEditor = (cursorPosition?: number) => {
    requestAnimationFrame(() => {
      skillEditorRef.current?.focus(cursorPosition);
    });
  };

  const performPromptSubmission = async (
    message: PromptInputMessage,
    promptSkills?: readonly AgentSkill[],
    options: Readonly<{
      clearInputOnSuccess?: boolean;
      forceAction?: "start" | "steer";
      requestTimelineScroll?: boolean;
    }> = {},
  ): Promise<boolean> => {
    const requestScope = routeScope;
    const text = message.text.trim();
    const skills =
      promptSkills ??
      toPromptSkillSubmission(skillEditorRef.current?.getContent() ?? promptContent).skills;
    const hasInput = text !== "" || message.files.length > 0 || skills.length > 0;
    const action =
      options.forceAction ??
      resolveComposerSubmitAction(state, hasInput, followUpBehavior, canSteer);
    if (
      action === "blocked" ||
      action === "interrupt" ||
      !hasInput ||
      selectedModel === undefined ||
      selectedReasoningEffort === undefined ||
      turnControlsDisabled ||
      (action !== "steer" && !canSubmit) ||
      (action === "steer" &&
        (!canSteer || activeTaskId === undefined || activeTurnId === undefined))
    ) {
      return false;
    }

    if (action === "queue") {
      const queuedPrompt: QueuedComposerPrompt = {
        files: message.files,
        id: createUuid(),
        skills,
        text,
      };
      const nextQueuedPrompts = [...queuedPrompts, queuedPrompt];
      setQueuedPrompts(nextQueuedPrompts);
      composerDraftStore.update(composerScope, (current) => ({
        ...current,
        attachments: [],
        content: [],
        queuedPrompts: nextQueuedPrompts,
      }));
      setPromptContent([]);
      setAttachments([]);
      skillEditorRef.current?.replace([]);
      return true;
    }

    // 排队项由调用方关闭置底请求，只有用户当前发出的即时消息改变阅读位置。
    if (options.requestTimelineScroll !== false) {
      onDirectSubmission?.();
    }
    // Notification 权限必须在提交手势内申请，不能等网络 Mutation 完成后再触发。
    onRequestNotificationPermission();
    setIsSubmitting(true);
    setMutationError(null);
    let input: AgentPromptInput;
    let messageAttachments: readonly AgentMessageAttachment[];
    try {
      messageAttachments = await Promise.all(
        message.files.map((attachment) =>
          resolvePromptAttachment(attachment, async (browserAttachment) => {
            const uploaded = uploadedAttachments.current.get(browserAttachment.id);
            if (uploaded !== undefined) {
              return uploaded;
            }
            const idempotencyKey = uploadAttempts.current.get(browserAttachment.id) ?? createUuid();
            uploadAttempts.current.set(browserAttachment.id, idempotencyKey);
            const response = await client.uploadAttachment(
              projectId,
              {
                content: browserAttachment.file,
                kind: browserAttachment.kind,
                name: browserAttachment.name,
              },
              { idempotencyKey },
            );
            if (isCurrentScope(requestScope)) {
              uploadedAttachments.current.set(browserAttachment.id, response.attachment);
            }
            return response.attachment;
          }),
        ),
      );
      input = {
        attachments: messageAttachments.map((attachment) => ({ id: attachment.id })),
        skills: skills.map((skill) => ({ id: skill.id, name: skill.name })),
        text,
        type: "prompt",
      };
    } catch (error) {
      if (isCurrentScope(requestScope)) {
        setMutationError(
          error instanceof Error ? error : new Error(t("composer.attachmentUploadFailed")),
        );
        setIsSubmitting(false);
      }
      return false;
    }

    if (action === "steer") {
      if (activeTaskId === undefined || activeTurnId === undefined) {
        return false;
      }
      const steerAttempt = resolveIdempotencyAttempt(
        steerTurnAttempt.current,
        JSON.stringify({ input, taskId: activeTaskId, turnId: activeTurnId }),
      );
      steerTurnAttempt.current = steerAttempt;
      try {
        await steerPromptTurn(
          client,
          projectId,
          activeTaskId,
          activeTurnId,
          input,
          steerAttempt.key,
        );
        if (isCurrentScope(requestScope)) {
          if (options.clearInputOnSuccess !== false) {
            clearComposerInput();
          }
          steerTurnAttempt.current = undefined;
          uploadedAttachments.current.clear();
          uploadAttempts.current.clear();
        }
        return true;
      } catch (error) {
        if (isCurrentScope(requestScope)) {
          setMutationError(error instanceof Error ? error : new Error("Prompt steering failed"));
        }
        return false;
      } finally {
        if (isCurrentScope(requestScope)) {
          setIsSubmitting(false);
        }
      }
    }

    const turnOptions = createComposerTurnOptions(
      activeSettings,
      selectedModel.id,
      selectedReasoningEffort,
      planModeEnabled,
    );
    const turnAttempt = resolveIdempotencyAttempt(
      startTurnAttempt.current,
      JSON.stringify({ input, options: turnOptions }),
    );
    startTurnAttempt.current = turnAttempt;
    const taskAttempt =
      activeTaskId === undefined
        ? resolveIdempotencyAttempt(startTaskAttempt.current, projectId)
        : undefined;
    startTaskAttempt.current = taskAttempt;
    try {
      const result = await startPromptTurn(client, {
        idempotencyKeys: {
          ...(taskAttempt === undefined ? {} : { startTask: taskAttempt.key }),
          startTurn: turnAttempt.key,
        },
        input,
        onTaskCreated(task) {
          // Turn 启动失败时保留已创建 Task，重试不能重复创建。
          if (isCurrentScope(requestScope)) {
            setPendingTaskState({ scope: requestScope, task });
            startTaskAttempt.current = undefined;
            // 真实 taskId 可用后立即交给工作台缓存并选中，不等待 turn/start。
            onTaskCreated?.(task);
          }
        },
        projectId,
        ...(activeTaskId === undefined ? {} : { taskId: activeTaskId }),
        turnOptions,
      });
      if (isCurrentScope(requestScope)) {
        if (options.clearInputOnSuccess !== false) {
          clearComposerInput();
        }
        setSubmittedTurnState({ scope: requestScope, turnId: result.turn.id });
      }
      // Mutation 返回后立即上报本次提交，Timeline 不等待 Provider Snapshot 落盘。
      onTurnStarted?.(result.turn, input, messageAttachments);
      if (isCurrentScope(requestScope)) {
        startTurnAttempt.current = undefined;
        uploadedAttachments.current.clear();
        uploadAttempts.current.clear();
      }
      if (taskId === undefined) {
        const startedTask = result.createdTask ?? pendingTask;
        if (startedTask !== undefined) {
          onTaskStarted(startedTask, result.turn, input, turnOptions, messageAttachments);
        }
      }
      return true;
    } catch (error) {
      if (isCurrentScope(requestScope)) {
        setMutationError(error instanceof Error ? error : new Error("Prompt submission failed"));
      }
      return false;
    } finally {
      if (isCurrentScope(requestScope)) {
        setIsSubmitting(false);
      }
    }
  };

  const submitPrompt = (
    message: PromptInputMessage,
    promptSkills?: readonly AgentSkill[],
    options: Readonly<{
      clearInputOnSuccess?: boolean;
      forceAction?: "start" | "steer";
      requestTimelineScroll?: boolean;
    }> = {},
  ): Promise<boolean> =>
    composerActionLock
      .run(() => performPromptSubmission(message, promptSkills, options))
      .then((submitted) => submitted ?? false);

  const submitQueuedPrompt = useEffectEvent(
    (queuedPrompt: QueuedComposerPrompt, queuedScope: string) => {
      void submitPrompt(
        { files: queuedPrompt.files, text: queuedPrompt.text },
        queuedPrompt.skills,
        {
          clearInputOnSuccess: false,
          forceAction: "start",
          requestTimelineScroll: false,
        },
      ).then((sent) => {
        if (sent && isCurrentScope(queuedScope)) {
          replaceQueuedPrompts(queuedPrompts.filter((prompt) => prompt.id !== queuedPrompt.id));
        }
      });
    },
  );

  useEffect(() => {
    const queuedScope = routeScope;
    const queuedPrompt = queuedPrompts[0];
    if (
      queuedPrompt === undefined ||
      activeTurnId !== undefined ||
      activeTaskId === undefined ||
      isSubmitting ||
      connectionState !== "connected" ||
      autoStartedQueueIds.current.has(queuedPrompt.id)
    ) {
      return;
    }
    autoStartedQueueIds.current.add(queuedPrompt.id);
    submitQueuedPrompt(queuedPrompt, queuedScope);
  }, [
    activeTaskId,
    activeTurnId,
    autoStartedQueueIds,
    connectionState,
    isSubmitting,
    queuedPrompts,
    routeScope,
  ]);

  const getCommandAvailability = (command: PromptCommandItem) => {
    const availability = getPromptCommandAvailability(
      command,
      capabilities,
      activeTaskId !== undefined,
    );
    if (availability.available && state === "running") {
      return { available: false, reason: t("composer.taskRunning") } as const;
    }
    return availability;
  };

  const executePromptCommand = async (command: PromptCommandItem) => {
    const requestScope = routeScope;
    if (!getCommandAvailability(command).available) {
      return;
    }
    if (command.action === "plan") {
      const slashCommand = commandSlashCommand;
      if (slashCommand === undefined) {
        return;
      }
      const currentContent = skillEditorRef.current?.getContent() ?? promptContent;
      replacePromptContent(
        removePromptSlashCommand(currentContent, slashCommand),
        slashCommand.start,
      );
      setPlanModeState({ scope: routeScope });
      closeCommandMenu();
      setCommandNotice(undefined);
      focusEditor(slashCommand.start);
      return;
    }

    setCommandQuery("");
    setCommandSlashCommand(undefined);
    setCommandNotice(undefined);
    replacePromptContent([]);

    if (command.action === "review") {
      setActiveCommandIndex(0);
      setReviewMenuMode("scopes");
      return;
    }
    setCommandMenuOpen(false);
    setReviewMenuMode(null);

    if (command.action === "initialize") {
      await submitPrompt(
        {
          files: [],
          text: t("composer.initializingAgentsPrompt"),
        },
        [],
      );
      return;
    }
    if (activeTaskId === undefined) {
      return;
    }

    await composerActionLock.run(async () => {
      if (command.action === "compact") {
        onRequestNotificationPermission();
      }
      setIsSubmitting(true);
      setMutationError(null);
      const attempt = resolveIdempotencyAttempt(
        commandAttempts.current.get(command.action),
        `${command.action}:${activeTaskId}`,
      );
      commandAttempts.current.set(command.action, attempt);
      try {
        if (command.action === "compact") {
          await client.compactTask(projectId, activeTaskId, { idempotencyKey: attempt.key });
          if (isCurrentScope(requestScope)) {
            setCommandNotice(t("composer.compacting"));
          }
        } else {
          const response = await client.forkTask(projectId, activeTaskId, {
            idempotencyKey: attempt.key,
          });
          onTaskStarted(response.task);
        }
        if (isCurrentScope(requestScope)) {
          commandAttempts.current.delete(command.action);
        }
      } catch (error) {
        if (isCurrentScope(requestScope)) {
          setMutationError(error instanceof Error ? error : new Error("Task command failed"));
        }
      } finally {
        if (isCurrentScope(requestScope)) {
          setIsSubmitting(false);
        }
      }
    });
  };

  const executeReviewTarget = (target: AgentReviewTarget) =>
    composerActionLock.run(async () => {
      const requestScope = routeScope;
      onRequestNotificationPermission();
      closeCommandMenu();
      setCommandNotice(undefined);
      setIsSubmitting(true);
      setMutationError(null);
      const attempt = resolveIdempotencyAttempt(
        commandAttempts.current.get("review"),
        JSON.stringify({ target, taskId: activeTaskId ?? projectId }),
      );
      commandAttempts.current.set("review", attempt);
      try {
        const response = await startTaskReview(client, {
          idempotencyKey: attempt.key,
          onTaskCreated(task) {
            // Review 启动失败时保留已创建 Task，重试不能重复创建。
            if (isCurrentScope(requestScope)) {
              setPendingTaskState({ scope: requestScope, task });
              onTaskCreated?.(task);
            }
          },
          projectId,
          target,
          ...(activeTaskId === undefined ? {} : { taskId: activeTaskId }),
        });
        if (isCurrentScope(requestScope)) {
          commandAttempts.current.delete("review");
          setSubmittedTurnState({ scope: requestScope, turnId: response.turn.id });
          setCommandNotice(t("composer.reviewStarted"));
          if (taskId === undefined) {
            const startedTask = response.createdTask ?? pendingTask;
            if (startedTask !== undefined) {
              onTaskStarted(startedTask, response.turn);
            }
          }
        }
      } catch (error) {
        if (isCurrentScope(requestScope)) {
          setMutationError(error instanceof Error ? error : new Error("Review command failed"));
        }
      } finally {
        if (isCurrentScope(requestScope)) {
          setIsSubmitting(false);
        }
      }
    });

  const selectSkill = (skill: AgentSkill) => {
    // Skill 选择只保存不透明引用；原生路径由 Provider 在提交边界解析。
    const slashCommand = commandSlashCommand;
    if (slashCommand === undefined) {
      return;
    }
    const currentContent = skillEditorRef.current?.getContent() ?? promptContent;
    const nextContent = insertPromptSkill(currentContent, slashCommand, skill);
    const cursorPosition = slashCommand.start + `$${skill.name}`.length;
    replacePromptContent(nextContent, cursorPosition);
    setCommandMenuOpen(false);
    setCommandQuery("");
    setCommandSlashCommand(undefined);
    setCommandNotice(undefined);
    focusEditor(cursorPosition);
  };

  const selectActiveCommandItem = () => {
    if (reviewMenuMode === "scopes") {
      if (activeCommandIndex === 0) {
        void executeReviewTarget({ type: "uncommitted_changes" });
      } else if (activeCommandIndex === 1 && baseBranches.length > 0) {
        setActiveCommandIndex(0);
        setReviewMenuMode("branches");
      }
      return;
    }
    if (reviewMenuMode === "branches") {
      const branch = baseBranches[activeCommandIndex];
      if (branch !== undefined) {
        void executeReviewTarget({ branch, type: "base_branch" });
      }
      return;
    }
    const command = filteredCommands[activeCommandIndex];
    if (command !== undefined) {
      void executePromptCommand(command);
      return;
    }
    const skill = filteredSkills[activeCommandIndex - filteredCommands.length];
    if (skill !== undefined) {
      selectSkill(skill);
    }
  };

  const interruptTurn = async () => {
    const requestScope = routeScope;
    if (
      !canInterrupt ||
      activeTaskId === undefined ||
      activeTurnId === undefined ||
      turnControlsDisabled
    ) {
      return;
    }
    await composerActionLock.run(async () => {
      const fingerprint = `${activeTaskId}:${activeTurnId}`;
      setIsSubmitting(true);
      setMutationError(null);
      const attempt = resolveIdempotencyAttempt(interruptAttempt.current, fingerprint);
      interruptAttempt.current = attempt;
      try {
        // `202` 仅确认请求已接收；后续显式重试继续复用同一幂等键。
        await interruptPromptTurn(client, projectId, activeTaskId, activeTurnId, attempt.key);
      } catch (error) {
        if (isCurrentScope(requestScope)) {
          setMutationError(error instanceof Error ? error : new Error("Turn interruption failed"));
        }
      } finally {
        if (isCurrentScope(requestScope)) {
          setIsSubmitting(false);
        }
      }
    });
  };

  const removeQueuedPrompt = (queuedPromptId: string) => {
    replaceQueuedPrompts(queuedPrompts.filter((prompt) => prompt.id !== queuedPromptId));
  };

  const steerQueuedPrompt = async (queuedPrompt: QueuedComposerPrompt) => {
    const sent = await submitPrompt(
      { files: queuedPrompt.files, text: queuedPrompt.text },
      queuedPrompt.skills,
      { clearInputOnSuccess: false, forceAction: "steer", requestTimelineScroll: false },
    );
    if (sent && isCurrentScope(routeScope)) {
      removeQueuedPrompt(queuedPrompt.id);
    }
  };

  const hasComposerInput = !isPromptSkillContentEmpty(promptContent) || attachmentCount > 0;
  const submitAction = resolveComposerSubmitAction(
    state,
    hasComposerInput,
    followUpBehavior,
    canSteer,
  );

  const composerView = (
    <WorkbenchComposerView
      activeCommandIndex={activeCommandIndex}
      activeCommandItemId={activeCommandItemId}
      activeSettings={activeSettings}
      activeTurnId={activeTurnId}
      attachments={attachments}
      attachmentsDisabled={attachmentsDisabled}
      baseBranches={baseBranches}
      canInterrupt={canInterrupt}
      canSteer={canSteer}
      canSubmit={canSubmit}
      commandMenuId={commandMenuId}
      commandMenuOpen={commandMenuOpen}
      commandNotice={commandNotice}
      commandSurfaceRef={commandSurfaceRef}
      composerScope={composerScope}
      contextUsage={contextUsage}
      draftInputDisabled={draftInputDisabled}
      filteredCommands={filteredCommands}
      filteredSkills={filteredSkills}
      getCommandAvailability={getCommandAvailability}
      gitStatus={gitStatus}
      hasComposerInput={hasComposerInput}
      isSubmitting={isSubmitting}
      menuItemCount={menuItemCount}
      models={models}
      modelsError={modelsError}
      modelsPending={modelsPending}
      mutationError={mutationError}
      onPlanModeRemove={() => {
        setPlanModeState(undefined);
      }}
      onAttachmentsChange={handleAttachmentsChange}
      onExecuteCommand={(command) => {
        void executePromptCommand(command);
      }}
      onExecuteReview={(target) => {
        void executeReviewTarget(target);
      }}
      onInterrupt={() => {
        void interruptTurn();
      }}
      onOpenReviewBranches={() => {
        setActiveCommandIndex(0);
        setReviewMenuMode("branches");
      }}
      onPromptChange={(nextContent, serializedText, cursorOffset) => {
        setPromptContent(nextContent);
        composerDraftStore.update(composerScope, (current) => ({
          ...current,
          content: nextContent,
        }));
        setCommandNotice(undefined);
        const slashCommand = resolvePromptSlashCommand(serializedText, cursorOffset);
        if (slashCommand === null) {
          setCommandMenuOpen(false);
          setReviewMenuMode(null);
          setCommandQuery("");
          setCommandSlashCommand(undefined);
          return;
        }
        // 文本开头或空白后的 `/` 片段驱动过滤，连续正文中的斜杠保持普通字符。
        setActiveCommandIndex(0);
        setCommandMenuOpen(true);
        setReviewMenuMode(null);
        setCommandQuery(slashCommand.query);
        setCommandSlashCommand(slashCommand);
      }}
      onSelectActiveCommand={selectActiveCommandItem}
      onSelectAttachmentKind={setAttachmentPickerKind}
      onSelectSkill={selectSkill}
      onSettingsChange={updateSettings}
      onSubmit={(message) => void submitPrompt(message)}
      onViewError={(error) => {
        setMutationError(error);
      }}
      projectPath={projectPath}
      planModeEnabled={planModeEnabled}
      promptContent={promptContent}
      promptSubmissionText={promptSubmission.text}
      queuedPrompts={queuedPrompts}
      removeQueuedPrompt={removeQueuedPrompt}
      reviewMenuMode={reviewMenuMode}
      selectedModel={selectedModel}
      selectedReasoningEffort={selectedReasoningEffort}
      setActiveCommandIndex={setActiveCommandIndex}
      skillEditorRef={skillEditorRef}
      state={state}
      steerQueuedPrompt={(queuedPrompt) => {
        void steerQueuedPrompt(queuedPrompt);
      }}
      submitAction={submitAction}
      taskId={taskId}
      turnControlsDisabled={turnControlsDisabled}
    />
  );
  if (attachmentPickerKind === undefined) {
    return composerView;
  }
  return (
    <>
      {composerView}
      <HostAttachmentPickerDialog
        client={client}
        kind={attachmentPickerKind}
        onAdd={(attachment) => {
          if (!isCurrentScope(routeScope)) {
            return;
          }
          handleAttachmentsChange([...attachments, attachment]);
          setAttachmentPickerKind(undefined);
        }}
        onClose={() => {
          setAttachmentPickerKind(undefined);
        }}
        projectId={projectId}
      />
    </>
  );
}
