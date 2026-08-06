import type { AgentTaskSettings } from "@code-agent/protocol";
import { useEffect, useEffectEvent, useImperativeHandle } from "react";

import { useTranslation } from "../../../i18n/i18n.js";
import type { QueuedComposerPrompt } from "../composer-draft-context.js";
import {
  interruptPromptTurn,
  resolveComposerSubmitAction,
  resolveIdempotencyAttempt,
} from "../composer-state.js";
import { HostAttachmentPickerDialog } from "./host-attachment-picker-dialog.js";
import { resolvePromptSlashCommand } from "./prompt-command.js";
import { isPromptSkillContentEmpty } from "./prompt-skill-editor.js";
import { useWorkbenchBranchSwitch } from "../hooks/use-workbench-branch-switch.js";
import { createComposerCommands } from "./workbench-composer-commands.js";
import type { WorkbenchComposerProps } from "./workbench-composer-contracts.js";
import { useComposerSession } from "./workbench-composer-session.js";
import { createComposerSubmission } from "./workbench-composer-submission.js";
import { WorkbenchComposerView } from "./workbench-composer-view.js";
export * from "./workbench-composer-contracts.js";

export {
  applyApprovalMode,
  deriveApprovalMode,
  deriveComposerActions,
  deriveComposerInputAvailability,
  deriveComposerState,
  interruptPromptTurn,
  LARGE_PASTE_CHARACTER_THRESHOLD,
  PASTED_TEXT_ATTACHMENT_NAME,
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

export function WorkbenchComposer({
  buildPlanRef,
  capabilities,
  client,
  fixedSandboxMode,
  followUpBehavior,
  models,
  modelsError,
  modelsPending,
  onDirectSubmission,
  onOpenGitHistory,
  onRequestNotificationPermission,
  onSettingsChange,
  onSubmissionStateChange,
  onTaskCreated,
  onTaskStarted,
  onTurnStarted,
  projectId,
  projectPath,
  projectToolsEnabled = true,
  gitStatus,
  runtime,
  settings,
  skills,
  taskId,
}: WorkbenchComposerProps) {
  const { t } = useTranslation(["workbench", "settings"]);
  const effectiveSettings =
    fixedSandboxMode === undefined || settings.sandboxMode === fixedSandboxMode
      ? settings
      : { ...settings, sandboxMode: fixedSandboxMode };
  const session = useComposerSession({
    capabilities,
    gitStatus,
    models,
    onSubmissionStateChange,
    projectId,
    projectToolsEnabled,
    runtime,
    settings: effectiveSettings,
    skills,
    taskId,
  });
  const {
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
    commandSurfaceRef,
    composerMode,
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
    promptContent,
    promptSubmission,
    queuedPrompts,
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
    setComposerModeState,
    setPromptContent,
    setQueuedPrompts,
    setReviewMenuMode,
    setSettingsOverride,
    skillEditorRef,
    state,
    turnControlsDisabled,
  } = session;
  const {
    actionLock: composerActionLock,
    autoStartedQueueIds,
    interruptAttempt,
    isCurrentScope,
  } = composerController;
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
  const { branchSwitchError, switchBranch, switchingBranch } = useWorkbenchBranchSwitch({
    client,
    failureMessage: t("composer.branchSwitchFailed"),
    gitStatus,
    isCurrentScope,
    projectId,
    routeScope,
  });

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
  }, [closeCommandMenu, commandMenuOpen, commandSurfaceRef]);

  const submitPrompt = createComposerSubmission({
    activeSettings,
    activeTaskId,
    activeTurnId,
    canSteer,
    canSubmit,
    clearComposerInput,
    client,
    composerDraftStore,
    composerScope,
    controller: composerController,
    composerMode,
    followUpBehavior,
    onDirectSubmission,
    onGoalStarted: () => {
      setComposerModeState(undefined);
    },
    onRequestNotificationPermission,
    onTaskCreated,
    onTaskStarted,
    onTurnStarted,
    pendingTask,
    projectId,
    promptContent,
    queuedPrompts,
    routeScope,
    selectedModel,
    selectedReasoningEffort,
    setAttachments,
    setPromptContent,
    setQueuedPrompts,
    skillEditorRef,
    state,
    taskId,
    t,
    turnControlsDisabled,
  });

  useImperativeHandle(buildPlanRef, () => ({
    buildPlan: () => {
      // 构建动作必须退出计划模式，否则后续 Turn 会再次请求生成计划。
      setComposerModeState(undefined);
      return submitPrompt({ files: [], text: t("composer.buildPlanPrompt") }, [], {
        composerMode: null,
        forceAction: "start",
      });
    },
  }));

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

  const {
    executePromptCommand,
    executeReviewTarget,
    getCommandAvailability,
    selectActiveCommandItem,
    selectSkill,
  } = createComposerCommands({
    capabilities,
    client,
    onRequestNotificationPermission,
    onTaskCreated,
    onTaskStarted,
    projectId,
    session,
    submitPrompt,
    t,
    taskId,
  });
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
      branchSwitchError={branchSwitchError}
      canInterrupt={canInterrupt}
      canSteer={canSteer}
      canSubmit={canSubmit}
      commandMenuId={commandMenuId}
      commandMenuOpen={commandMenuOpen}
      commandNotice={commandNotice}
      commandSurfaceRef={commandSurfaceRef}
      composerMode={composerMode}
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
      onComposerModeRemove={() => {
        setComposerModeState(undefined);
      }}
      onAttachmentsChange={handleAttachmentsChange}
      onBranchChange={(branch) => {
        void switchBranch(branch);
      }}
      onExecuteCommand={(command) => {
        void executePromptCommand(command);
      }}
      onExecuteReview={(target) => {
        void executeReviewTarget(target);
      }}
      onInterrupt={() => {
        void interruptTurn();
      }}
      onOpenGitHistory={onOpenGitHistory}
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
      projectToolsEnabled={projectToolsEnabled}
      promptContent={promptContent}
      promptSubmissionText={promptSubmission.text}
      queuedPrompts={queuedPrompts}
      removeQueuedPrompt={removeQueuedPrompt}
      reviewMenuMode={reviewMenuMode}
      sandboxModeSelectable={fixedSandboxMode === undefined}
      selectedModel={selectedModel}
      selectedReasoningEffort={selectedReasoningEffort}
      setActiveCommandIndex={setActiveCommandIndex}
      skillEditorRef={skillEditorRef}
      state={state}
      steerQueuedPrompt={(queuedPrompt) => {
        void steerQueuedPrompt(queuedPrompt);
      }}
      submitAction={submitAction}
      switchingBranch={switchingBranch}
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
