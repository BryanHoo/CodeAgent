import {
  AGENT_FILE_ACCEPT,
  AGENT_IMAGE_ACCEPT,
  MAX_AGENT_FILE_BYTES,
  MAX_AGENT_FILE_TOTAL_BYTES,
  MAX_AGENT_IMAGES,
  MAX_AGENT_IMAGE_BYTES,
  MAX_AGENT_IMAGE_TOTAL_BYTES,
  type AgentSandboxMode,
} from "@code-agent/protocol";
import { Folder, History } from "lucide-react";

import { useTranslation } from "../../../i18n/i18n.js";
import { Context, ContextTrigger } from "../../../shared/components/agent/context.js";
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSelect,
  PromptInputSubmit,
  PromptInputTools,
  isPromptInputComposing,
  isPromptInputNewlineShortcut,
} from "../../../shared/components/agent/prompt-input.js";
import { Button } from "../../../shared/components/core/button.js";
import { Tooltip } from "../../../shared/components/core/tooltip.js";
import { TooltipContent } from "../../../shared/components/core/tooltip.js";
import { TooltipTrigger } from "../../../shared/components/core/tooltip.js";
import {
  LARGE_PASTE_CHARACTER_THRESHOLD,
  PASTED_TEXT_ATTACHMENT_NAME,
  applyApprovalMode,
  deriveApprovalMode,
  resolveComposerPlaceholder,
  type ApprovalMode,
} from "../composer-state.js";
import { movePromptCommandSelection } from "./prompt-command.js";
import { ComposerBranchSwitcher } from "./composer-branch-switcher.js";
import { ComposerModelSelector } from "./composer-model-selector.js";
import { shouldNavigatePromptHistory } from "./prompt-history.js";
import { PromptSkillEditor } from "./prompt-skill-editor.js";
import { selectionOffset } from "./prompt-skill-editor-dom.js";
import { ComposerCommandMenu } from "./workbench-composer-command-menu.js";
import { ComposerFileMenu } from "./workbench-composer-file-menu.js";
import {
  ComposerQueuedPrompts,
  ComposerWaitingForAcknowledgement,
} from "./workbench-composer-queue.js";
import { ComposerAttachments, ComposerModeTag } from "./workbench-composer-toolbar.js";
import type { WorkbenchComposerViewProps } from "./workbench-composer-view-contracts.js";
export { ComposerModeTag } from "./workbench-composer-toolbar.js";
export * from "./workbench-composer-view-contracts.js";

export function ComposerGitHistoryButton({ onOpen }: Readonly<{ onOpen: () => void }>) {
  const { t } = useTranslation("conversation");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-haspopup="dialog"
          aria-label={t("inspector.openGitHistory")}
          className="inline-grid size-6 shrink-0 place-items-center rounded-control text-muted-foreground hover:bg-control-hover hover:text-foreground"
          id="workbench-git-history"
          onClick={onOpen}
          type="button"
          variant="ghost"
        >
          <History aria-hidden="true" className="size-3" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{t("inspector.openGitHistory")}</TooltipContent>
    </Tooltip>
  );
}

export function WorkbenchComposerView(props: WorkbenchComposerViewProps) {
  const { t } = useTranslation(["workbench", "settings"]);
  return (
    <section className="shrink-0 bg-content px-3 pb-2 sm:px-5" aria-label={t("composer.landmark")}>
      <div className="relative mx-auto w-full max-w-content" ref={props.commandSurfaceRef}>
        <ComposerCommandMenu props={props} />
        <ComposerFileMenu props={props} />
        <ComposerQueuedPrompts
          activeTurnId={props.activeTurnId}
          canEdit={!props.hasComposerInput}
          canSteer={props.canSteer}
          isSubmitting={props.isSubmitting}
          onEdit={props.editQueuedPrompt}
          onRemove={props.removeQueuedPrompt}
          onSteer={props.steerQueuedPrompt}
          prompts={props.queuedPrompts}
        />
        <PromptInput
          attachments={props.attachments}
          aria-busy={
            props.state === "submitting" ||
            props.state === "reconnecting" ||
            props.waitingForAcknowledgement
          }
          className="w-full"
          data-state={props.state}
          disabled={props.attachmentsDisabled}
          fileAccept={AGENT_FILE_ACCEPT}
          globalDrop
          imageAccept={AGENT_IMAGE_ACCEPT}
          largePasteCharacterThreshold={LARGE_PASTE_CHARACTER_THRESHOLD}
          maxFileSize={MAX_AGENT_FILE_BYTES}
          maxFileTotalSize={MAX_AGENT_FILE_TOTAL_BYTES}
          maxImageSize={MAX_AGENT_IMAGE_BYTES}
          maxImages={MAX_AGENT_IMAGES}
          maxImageTotalSize={MAX_AGENT_IMAGE_TOTAL_BYTES}
          multiple
          onAttachmentsChange={props.onAttachmentsChange}
          onError={(error) => {
            props.onViewError(new Error(error.message));
          }}
          onSubmit={props.onSubmit}
          pastedTextFileName={PASTED_TEXT_ATTACHMENT_NAME}
        >
          <ComposerAttachments />
          <PromptInputBody>
            <input name="message" type="hidden" value={props.promptSubmissionText} />
            <PromptSkillEditor
              aria-activedescendant={props.activeCommandItemId}
              aria-controls={
                props.commandMenuOpen || props.fileMenuOpen ? props.commandMenuId : undefined
              }
              aria-expanded={props.commandMenuOpen || props.fileMenuOpen}
              aria-haspopup="listbox"
              aria-label={t("composer.taskInput")}
              content={props.promptContent}
              disabled={props.draftInputDisabled}
              onChange={props.onPromptChange}
              onKeyDown={(event) => {
                if (isPromptInputComposing(event.nativeEvent)) {
                  return;
                }
                if (props.commandMenuOpen || props.fileMenuOpen) {
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault();
                    props.setActiveCommandIndex((currentIndex) =>
                      movePromptCommandSelection(
                        currentIndex,
                        event.key === "ArrowDown" ? 1 : -1,
                        props.menuItemCount,
                      ),
                    );
                    return;
                  }
                  if (event.key === "Enter" && !isPromptInputNewlineShortcut(event)) {
                    event.preventDefault();
                    props.onSelectActiveCommand();
                  }
                  return;
                }
                if (
                  (event.key === "ArrowDown" || event.key === "ArrowUp") &&
                  !(event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
                ) {
                  const selection = document.getSelection();
                  const direction = event.key === "ArrowUp" ? "previous" : "next";
                  const serializedText = event.currentTarget.dataset["serializedValue"] ?? "";
                  if (
                    selection?.isCollapsed === true &&
                    event.currentTarget.contains(selection.anchorNode) &&
                    shouldNavigatePromptHistory(
                      serializedText,
                      selectionOffset(event.currentTarget),
                      direction,
                    ) &&
                    props.onPromptHistoryNavigate(direction)
                  ) {
                    event.preventDefault();
                  }
                }
              }}
              placeholder={resolveComposerPlaceholder(props.taskId)}
              ref={props.skillEditorRef}
              skills={props.skills}
              scope={props.composerScope}
            />
            {props.waitingForAcknowledgement ? <ComposerWaitingForAcknowledgement /> : null}
            {props.mutationError === null ? null : (
              <p className="px-1 pb-1 text-label text-danger" role="alert">
                {t("composer.operationFailed")}
              </p>
            )}
            {props.commandNotice === undefined ? null : (
              <p className="px-1 pb-1 text-label text-muted-foreground" role="status">
                {props.commandNotice}
              </p>
            )}
          </PromptInputBody>
          <PromptInputFooter className="max-workbench:gap-0.5">
            <PromptInputTools className="max-workbench:shrink-0 max-workbench:gap-0.5">
              <PromptInputActionAddAttachments
                disabled={props.attachmentsDisabled}
                onSelectKind={props.onSelectAttachmentKind}
              />
              <PromptInputSelect
                aria-label={t("composer.approvalMode")}
                className="max-workbench:w-11 max-workbench:max-w-11 max-workbench:px-1 max-workbench:[field-sizing:fixed]"
                disabled={props.turnControlsDisabled}
                onChange={(event) => {
                  props.onSettingsChange(
                    applyApprovalMode(
                      props.activeSettings,
                      event.currentTarget.value as ApprovalMode,
                    ),
                    "approvalPolicy",
                  );
                }}
                value={deriveApprovalMode(props.activeSettings)}
              >
                <option value="untrusted">{t("settings:approval.untrusted")}</option>
                <option value="on-request">{t("settings:approval.onRequest")}</option>
                <option value="auto-review">{t("settings:approval.autoReview")}</option>
                <option value="never">{t("settings:approval.never")}</option>
              </PromptInputSelect>
              {props.sandboxModeSelectable ? (
                <PromptInputSelect
                  aria-label={t("composer.sandboxMode")}
                  className="max-workbench:w-11 max-workbench:max-w-11 max-workbench:px-1 max-workbench:[field-sizing:fixed]"
                  disabled={props.turnControlsDisabled}
                  onChange={(event) => {
                    props.onSettingsChange(
                      {
                        ...props.activeSettings,
                        sandboxMode: event.currentTarget.value as AgentSandboxMode,
                      },
                      "sandboxMode",
                    );
                  }}
                  value={props.activeSettings.sandboxMode}
                >
                  <option value="read-only">{t("settings:sandbox.readOnly")}</option>
                  <option value="workspace-write">{t("settings:sandbox.workspaceWrite")}</option>
                  <option value="danger-full-access">
                    {t("settings:sandbox.dangerFullAccess")}
                  </option>
                </PromptInputSelect>
              ) : null}
              {props.composerMode === undefined ? null : (
                <ComposerModeTag
                  disabled={props.turnControlsDisabled}
                  mode={props.composerMode}
                  onRemove={props.onComposerModeRemove}
                />
              )}
            </PromptInputTools>
            {/* 移动端压缩选择器的展示宽度，保持所有常用操作始终位于同一行。 */}
            <div className="flex min-w-0 items-center gap-1 max-workbench:shrink-0 max-workbench:gap-0.5">
              <ComposerModelSelector
                activeSettings={props.activeSettings}
                disabled={props.turnControlsDisabled}
                models={props.models}
                modelsPending={props.modelsPending}
                onSettingsChange={props.onSettingsChange}
                selectedModel={props.selectedModel}
                selectedReasoningEffort={props.selectedReasoningEffort}
              />
              <PromptInputSubmit
                aria-label={
                  props.submitAction === "queue"
                    ? t("composer.queueMessage")
                    : props.submitAction === "steer"
                      ? t("composer.sendSteer")
                      : props.submitAction === "interrupt"
                        ? t("composer.stop")
                        : t("composer.submit")
                }
                disabled={
                  props.waitingForAcknowledgement ||
                  props.turnControlsDisabled ||
                  props.submitAction === "blocked" ||
                  (props.submitAction === "start" &&
                    (!props.canSubmit ||
                      props.selectedModel === undefined ||
                      props.selectedReasoningEffort === undefined)) ||
                  (props.submitAction === "interrupt" &&
                    (!props.canInterrupt || props.activeTurnId === undefined))
                }
                onClick={props.submitAction === "interrupt" ? props.onInterrupt : undefined}
                status={
                  props.waitingForAcknowledgement
                    ? "submitting"
                    : props.state === "running" && props.hasComposerInput
                      ? "idle"
                      : props.state
                }
                type={props.submitAction === "interrupt" ? "button" : "submit"}
              />
            </div>
          </PromptInputFooter>
        </PromptInput>
      </div>
      {props.modelsError === null ? null : (
        <p className="mx-auto mt-1 w-full max-w-content px-1 text-caption text-danger" role="alert">
          {t("composer.modelListFailed")}
        </p>
      )}
      <div className="mx-auto mt-1.5 flex w-full max-w-content min-w-0 items-center gap-3 px-1 text-caption text-muted-foreground">
        {props.projectToolsEnabled ? (
          <>
            <div className="flex min-w-0 shrink items-center gap-0.5">
              <ComposerBranchSwitcher
                branchCreateError={props.branchCreateError}
                creatingBranch={props.creatingBranch}
                gitStatus={props.gitStatus}
                onBranchChange={props.onBranchChange}
                onBranchCreate={props.onBranchCreate}
                switchingBranch={props.switchingBranch}
              />
              <ComposerGitHistoryButton onOpen={props.onOpenGitHistory} />
            </div>
            <span
              aria-label={t("composer.projectPath")}
              className="inline-flex min-w-0 flex-1 items-center gap-1"
              title={props.projectPath}
            >
              <Folder className="size-3 shrink-0" aria-hidden="true" />
              <span className="truncate">{props.projectPath}</span>
            </span>
          </>
        ) : null}
        <Context
          className="ml-auto"
          maxTokens={props.contextUsage?.contextWindow}
          usedTokens={props.contextUsage?.usedTokens}
        >
          <ContextTrigger />
        </Context>
      </div>
      {props.branchSwitchError === undefined ? null : (
        <p className="mx-auto mt-1 w-full max-w-content px-1 text-caption text-danger" role="alert">
          {props.branchSwitchError}
        </p>
      )}
    </section>
  );
}
