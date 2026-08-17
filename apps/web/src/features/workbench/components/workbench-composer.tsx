import type { AgentTaskSettings } from "@code-agent/protocol";
import { useEffect, useImperativeHandle } from "react";
import { v4 as createUuid } from "uuid";

import { useTranslation } from "../../../i18n/i18n.js";
import {
  getTaskStoreAssistantMessageCheckpoints,
  getTurnAssistantMessageCheckpoints,
  retainAcceptedSteerPrompt,
} from "../composer-queue-state.js";
import {
  interruptPromptTurn,
  resolveComposerSubmitAction,
  resolveIdempotencyAttempt,
} from "../composer-state.js";
import { HostAttachmentPickerDialog } from "./host-attachment-picker-dialog.js";
import { isPromptSkillContentEmpty } from "./prompt-skill-editor.js";
import { useWorkbenchBranchSwitch } from "../hooks/use-workbench-branch-switch.js";
import { useComposerQueue } from "../hooks/use-composer-queue.js";
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
  composerRef,
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
    client,
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
    closeFileMenu,
    commandMenuId,
    commandMenuOpen,
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
    fileMenuOpen,
    fileSearchError,
    fileSearchPending,
    fileSearchResults,
    handleAttachmentsChange,
    handlePromptChange,
    isSubmitting,
    menuItemCount,
    navigatePromptHistory,
    pendingTask,
    promptContent,
    promptSubmission,
    queuedPrompts,
    referenceProjectPath,
    replaceQueuedPrompts,
    reviewMenuMode,
    routeScope,
    selectedModel,
    selectedReasoningEffort,
    selectFileReference,
    setActiveCommandIndex,
    setAttachmentPickerKind,
    setAttachments,
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
    void Promise.resolve(onSettingsChange(nextSettings, field)).catch(() => undefined);
  };
  const branchMutation = useWorkbenchBranchSwitch({
    client,
    gitStatus,
    isCurrentScope,
    projectId,
    routeScope,
  });

  useEffect(() => {
    if (turnControlsDisabled) {
      closeCommandMenu();
      closeFileMenu();
    }
  }, [closeCommandMenu, closeFileMenu, turnControlsDisabled]);

  useEffect(() => {
    if (!commandMenuOpen && !fileMenuOpen) {
      return undefined;
    }
    const handleDocumentKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeCommandMenu();
        closeFileMenu();
      }
    };
    const handleDocumentPointerDown = (event: PointerEvent) => {
      const eventTarget = event.target;
      if (eventTarget instanceof Node && !commandSurfaceRef.current?.contains(eventTarget)) {
        // 输入框和命令弹层共享一个交互区域，只有点击区域外部才关闭弹层。
        closeCommandMenu();
        closeFileMenu();
      }
    };
    document.addEventListener("keydown", handleDocumentKeyDown, true);
    document.addEventListener("pointerdown", handleDocumentPointerDown, true);
    return () => {
      document.removeEventListener("keydown", handleDocumentKeyDown, true);
      document.removeEventListener("pointerdown", handleDocumentPointerDown, true);
    };
  }, [closeCommandMenu, closeFileMenu, commandMenuOpen, commandSurfaceRef, fileMenuOpen]);

  const submitPrompt = createComposerSubmission({
    activeAssistantMessages:
      runtime?.store === undefined
        ? getTurnAssistantMessageCheckpoints(runtime?.snapshot, activeTurnId)
        : getTaskStoreAssistantMessageCheckpoints(runtime.store.getState(), activeTurnId),
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
    onSteerAccepted: (accepted) => {
      replaceQueuedPrompts(retainAcceptedSteerPrompt(queuedPrompts, accepted, createUuid));
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

  useImperativeHandle(composerRef, () => ({
    buildPlan: () => {
      setComposerModeState(undefined); // 避免后续 Turn 再次请求生成计划。
      return submitPrompt({ files: [], text: t("composer.buildPlanPrompt") }, [], {
        composerMode: null,
        forceAction: "start",
      });
    },
    referenceProjectPath,
  }));

  const { editQueuedPrompt, removeQueuedPrompt, steerQueuedPrompt } = useComposerQueue({
    activeTaskId,
    activeTurnId,
    autoStartedQueueIds,
    connectionState,
    handleAttachmentsChange,
    isCurrentScope,
    isSubmitting,
    queuedPrompts,
    replacePromptContent: session.replacePromptContent,
    replaceQueuedPrompts,
    routeScope,
    runtime,
    skillEditorRef,
    submitPrompt,
  });

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
      commandSurfaceRef={commandSurfaceRef}
      composerMode={composerMode}
      composerScope={composerScope}
      contextUsage={contextUsage}
      creatingBranch={branchMutation.creatingBranch}
      draftInputDisabled={draftInputDisabled}
      filteredCommands={filteredCommands}
      filteredSkills={filteredSkills}
      fileMenuOpen={fileMenuOpen}
      fileSearchError={fileSearchError}
      fileSearchPending={fileSearchPending}
      fileSearchResults={fileSearchResults}
      getCommandAvailability={getCommandAvailability}
      gitStatus={gitStatus}
      hasComposerInput={hasComposerInput}
      isSubmitting={isSubmitting}
      menuItemCount={menuItemCount}
      models={models}
      modelsError={modelsError}
      modelsPending={modelsPending}
      editQueuedPrompt={editQueuedPrompt}
      onComposerModeRemove={() => {
        setComposerModeState(undefined);
      }}
      onAttachmentsChange={handleAttachmentsChange}
      onBranchCreate={branchMutation.createBranch}
      onBranchChange={(branch) => {
        void branchMutation.switchBranch(branch);
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
      onPromptChange={handlePromptChange}
      onPromptHistoryNavigate={navigatePromptHistory}
      onSelectActiveCommand={selectActiveCommandItem}
      onSelectAttachmentKind={setAttachmentPickerKind}
      onSelectFileReference={selectFileReference}
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
      skills={skills}
      skillEditorRef={skillEditorRef}
      state={state}
      steerQueuedPrompt={(queuedPrompt) => {
        void steerQueuedPrompt(queuedPrompt);
      }}
      submitAction={submitAction}
      switchingBranch={branchMutation.switchingBranch}
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
