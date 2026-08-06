import type {
  AgentCapabilities,
  AgentModel,
  AgentSkill,
  AgentTaskSettings,
  HostFileKind,
  ProjectGitStatus,
} from "@code-agent/protocol";
import { useCallback, useId, useLayoutEffect, useRef, useState } from "react";

import type { PromptInputAttachment } from "../../../shared/ai-elements/prompt-input.js";
import type { TaskRuntimeView } from "../../conversation/runtime/use-task-runtime.js";
import {
  createComposerDraftScope,
  useComposerDraftStore,
  type QueuedComposerPrompt,
} from "../composer-draft-context.js";
import {
  deriveComposerActions,
  deriveComposerInputAvailability,
  deriveComposerState,
  resolveActiveTurnId,
  resolveReasoningEffort,
} from "../composer-state.js";
import { useWorkbenchComposerController } from "../hooks/use-workbench-composer-controller.js";
import {
  filterPromptCommandItems,
  filterPromptSkills,
  getPromptCommandItems,
  type PromptSlashCommand,
} from "./prompt-command.js";
import {
  toPromptSkillSubmission,
  type PromptSkillContent,
  type PromptSkillEditorHandle,
} from "./prompt-skill-editor.js";
import type { WorkbenchComposerProps } from "./workbench-composer-contracts.js";
import type { ComposerMode } from "./workbench-composer-contracts.js";

type ComposerSessionOptions = Readonly<{
  capabilities: AgentCapabilities | undefined;
  gitStatus: ProjectGitStatus | undefined;
  models: readonly AgentModel[];
  onSubmissionStateChange: WorkbenchComposerProps["onSubmissionStateChange"];
  projectId: string;
  projectToolsEnabled: boolean;
  runtime: TaskRuntimeView | undefined;
  settings: AgentTaskSettings;
  skills: readonly AgentSkill[];
  taskId: string | undefined;
}>;

export function useComposerSession({
  capabilities,
  gitStatus,
  models,
  onSubmissionStateChange,
  projectId,
  projectToolsEnabled,
  runtime,
  settings,
  skills,
  taskId,
}: ComposerSessionOptions) {
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
  const [composerModeState, setComposerModeState] =
    useState<Readonly<{ mode: ComposerMode; scope: string }>>();
  const [queuedPrompts, setQueuedPrompts] = useState<readonly QueuedComposerPrompt[]>(
    initialComposerDraft.queuedPrompts,
  );
  const composerController = useWorkbenchComposerController(routeScope, onSubmissionStateChange);
  const {
    isSubmitting,
    mutationError,
    pendingTaskState,
    reset: resetController,
    setIsSubmitting,
    setMutationError,
    setPendingTaskState,
    setSubmittedTurnState,
    submittedTurnState,
  } = composerController;
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
  const composerMode = composerModeState?.scope === routeScope ? composerModeState.mode : undefined;
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
  const filteredCommands = filterPromptCommandItems(
    getPromptCommandItems({ projectToolsEnabled }),
    commandQuery,
  );
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
      setComposerModeState(undefined);
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

  return {
    activeCommandIndex,
    activeCommandItemId,
    activeSettings,
    activeTaskId,
    activeTurnId,
    attachmentCount,
    attachmentPickerKind,
    attachments,
    attachmentsDisabled,
    baseBranches,
    canInterrupt,
    canSteer,
    canSubmit,
    clearComposerInput,
    closeCommandMenu,
    commandMenuId,
    commandMenuOpen,
    commandNotice,
    commandSlashCommand,
    commandSurfaceRef,
    composerController,
    composerDraftStore,
    composerScope,
    connectionState,
    contextUsage,
    draftInputDisabled,
    filteredCommands,
    filteredSkills,
    handleAttachmentsChange,
    isSubmitting,
    menuItemCount,
    mutationError,
    pendingTask,
    composerMode,
    promptContent,
    promptSubmission,
    queuedPrompts,
    replacePromptContent,
    replaceQueuedPrompts,
    reviewMenuMode,
    routeScope,
    selectedModel,
    selectedReasoningEffort,
    setActiveCommandIndex,
    setAttachmentPickerKind,
    setAttachments,
    setCommandMenuOpen,
    setCommandNotice,
    setCommandQuery,
    setCommandSlashCommand,
    setIsSubmitting,
    setMutationError,
    setPendingTaskState,
    setComposerModeState,
    setPromptContent,
    setQueuedPrompts,
    setReviewMenuMode,
    setSettingsOverride,
    setSubmittedTurnState,
    skillEditorRef,
    state,
    turnControlsDisabled,
  };
}
