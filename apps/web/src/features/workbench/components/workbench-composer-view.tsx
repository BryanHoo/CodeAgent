import {
  AGENT_FILE_ACCEPT,
  AGENT_IMAGE_ACCEPT,
  MAX_AGENT_FILE_BYTES,
  MAX_AGENT_FILE_TOTAL_BYTES,
  MAX_AGENT_IMAGES,
  MAX_AGENT_IMAGE_BYTES,
  MAX_AGENT_IMAGE_TOTAL_BYTES,
  type ProjectGitStatus,
  type AgentSandboxMode,
} from "@code-agent/protocol";
import {
  ChevronsUpDown,
  Folder,
  GitBranch,
  History,
  LoaderCircle,
  SendHorizontal,
  X,
} from "lucide-react";

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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "../../../shared/components/core/dropdown-menu.js";
import { Tooltip } from "../../../shared/components/core/tooltip.js";
import { TooltipContent } from "../../../shared/components/core/tooltip.js";
import { TooltipTrigger } from "../../../shared/components/core/tooltip.js";
import {
  LARGE_PASTE_CHARACTER_THRESHOLD,
  PASTED_TEXT_ATTACHMENT_NAME,
  applyApprovalMode,
  deriveApprovalMode,
  resolveComposerPlaceholder,
  resolveReasoningEffort,
  type ApprovalMode,
} from "../composer-state.js";
import { movePromptCommandSelection } from "./prompt-command.js";
import { PromptSkillEditor } from "./prompt-skill-editor.js";
import { ComposerCommandMenu } from "./workbench-composer-command-menu.js";
import { ComposerAttachments, ComposerModeTag } from "./workbench-composer-toolbar.js";
import {
  resolveQueuedPromptSummary,
  type WorkbenchComposerViewProps,
} from "./workbench-composer-view-contracts.js";
export { ComposerModeTag } from "./workbench-composer-toolbar.js";
export * from "./workbench-composer-view-contracts.js";
type ComposerBranchSwitcherProps = Readonly<{
  gitStatus: ProjectGitStatus | undefined;
  onBranchChange: (branch: string) => void;
  switchingBranch: string | undefined;
}>;

export function ComposerBranchSwitcher({
  gitStatus,
  onBranchChange,
  switchingBranch,
}: ComposerBranchSwitcherProps) {
  const { t } = useTranslation("workbench");
  const currentBranch = gitStatus?.branch;
  const switchable =
    gitStatus?.repositoryMode === "root" &&
    currentBranch !== null &&
    currentBranch !== undefined &&
    gitStatus.branches.length > 1;
  const label = currentBranch ?? t("composer.gitBranchMissing");

  if (!switchable) {
    return (
      <span className="inline-flex min-w-0 shrink items-center gap-1">
        <GitBranch aria-hidden="true" className="size-3 shrink-0" />
        <span className="truncate">{label}</span>
      </span>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={t("composer.branchSwitcherLabel", { branch: currentBranch })}
          className="inline-flex h-6 max-w-28 min-w-0 items-center gap-1 rounded-control px-1 text-caption text-muted-foreground hover:bg-control-hover hover:text-foreground sm:max-w-40"
          disabled={switchingBranch !== undefined}
          type="button"
          variant="ghost"
        >
          {switchingBranch === undefined ? (
            <GitBranch aria-hidden="true" className="size-3 shrink-0" data-icon="inline-start" />
          ) : (
            <LoaderCircle
              aria-hidden="true"
              className="size-3 shrink-0 animate-spin"
              data-icon="inline-start"
            />
          )}
          <span className="truncate">{label}</span>
          <ChevronsUpDown aria-hidden="true" className="size-3 shrink-0" data-icon="inline-end" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 w-56 overflow-y-auto" side="top">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("composer.branchSwitcherMenu")}</DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuRadioGroup
          onValueChange={(branch) => {
            if (branch !== currentBranch) {
              onBranchChange(branch);
            }
          }}
          value={currentBranch}
        >
          {gitStatus.branches.map((branch) => (
            <DropdownMenuRadioItem
              disabled={branch === currentBranch || switchingBranch !== undefined}
              key={branch}
              title={branch}
              value={branch}
            >
              <span className="truncate">{branch}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

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
        {props.queuedPrompts.length === 0 ? null : (
          <div aria-label={t("composer.queuedMessages")} className="mb-2 space-y-1.5" role="list">
            {props.queuedPrompts.map((queuedPrompt) => {
              const summary = resolveQueuedPromptSummary(
                queuedPrompt,
                t("composer.attachmentCount", { count: queuedPrompt.files.length }),
              );
              return (
                <div
                  className="flex min-w-0 items-center gap-2 rounded-control border border-separator bg-control px-2 py-1.5"
                  key={queuedPrompt.id}
                  role="listitem"
                >
                  <span className="min-w-0 flex-1 truncate text-label text-foreground">
                    {summary}
                  </span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        aria-label={t("composer.steerNow", { summary })}
                        className="hover:text-brand"
                        disabled={
                          !props.canSteer || props.activeTurnId === undefined || props.isSubmitting
                        }
                        onClick={() => {
                          props.steerQueuedPrompt(queuedPrompt);
                        }}
                        size="icon-sm"
                        type="button"
                        variant="ghost"
                      >
                        <SendHorizontal aria-hidden="true" className="size-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t("composer.steerNowTooltip")}</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        aria-label={t("composer.cancelQueued", { summary })}
                        className="hover:text-danger"
                        disabled={props.isSubmitting}
                        onClick={() => {
                          props.removeQueuedPrompt(queuedPrompt.id);
                        }}
                        size="icon-sm"
                        type="button"
                        variant="ghost"
                      >
                        <X aria-hidden="true" className="size-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t("composer.cancelQueuedTooltip")}</TooltipContent>
                  </Tooltip>
                </div>
              );
            })}
          </div>
        )}
        <PromptInput
          attachments={props.attachments}
          aria-busy={props.state === "submitting" || props.state === "reconnecting"}
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
              aria-controls={props.commandMenuOpen ? props.commandMenuId : undefined}
              aria-expanded={props.commandMenuOpen}
              aria-haspopup="listbox"
              aria-label={t("composer.taskInput")}
              content={props.promptContent}
              disabled={props.draftInputDisabled}
              onChange={props.onPromptChange}
              onKeyDown={(event) => {
                if (!props.commandMenuOpen || isPromptInputComposing(event.nativeEvent)) {
                  return;
                }
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
              }}
              placeholder={resolveComposerPlaceholder(props.taskId)}
              ref={props.skillEditorRef}
              scope={props.composerScope}
            />
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
              <PromptInputSelect
                aria-label={t("composer.modelSelect")}
                className="max-workbench:w-16 max-workbench:max-w-16 max-workbench:px-1 max-workbench:[field-sizing:fixed]"
                disabled={
                  props.turnControlsDisabled ||
                  props.modelsPending ||
                  props.selectedModel === undefined
                }
                onChange={(event) => {
                  const nextModel = props.models.find(
                    (model) => model.id === event.currentTarget.value,
                  );
                  const nextReasoningEffort = resolveReasoningEffort(
                    nextModel,
                    props.activeSettings.reasoningEffort,
                  );
                  if (nextModel !== undefined && nextReasoningEffort !== undefined) {
                    props.onSettingsChange(
                      {
                        ...props.activeSettings,
                        model: nextModel.id,
                        reasoningEffort: nextReasoningEffort,
                      },
                      "model",
                    );
                  }
                }}
                value={props.selectedModel?.id ?? ""}
              >
                {props.models.length === 0 ? (
                  <option value="">
                    {props.modelsPending ? t("composer.modelLoading") : t("composer.noModels")}
                  </option>
                ) : (
                  props.models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.displayName}
                    </option>
                  ))
                )}
              </PromptInputSelect>
              <PromptInputSelect
                aria-label={t("composer.reasonEffortSelect")}
                className="max-workbench:w-8 max-workbench:max-w-8 max-workbench:px-1 max-workbench:[field-sizing:fixed]"
                disabled={
                  props.turnControlsDisabled ||
                  props.modelsPending ||
                  props.selectedModel === undefined
                }
                onChange={(event) => {
                  props.onSettingsChange(
                    { ...props.activeSettings, reasoningEffort: event.currentTarget.value },
                    "reasoningEffort",
                  );
                }}
                title={
                  props.selectedModel?.supportedReasoningEfforts.find(
                    (option) => option.id === props.selectedReasoningEffort,
                  )?.description
                }
                value={props.selectedReasoningEffort ?? ""}
              >
                {props.selectedModel?.supportedReasoningEfforts.map((option) => (
                  <option key={option.id} value={option.id}>
                    {t(`settings:effort.${option.id}`, { defaultValue: option.id })}
                  </option>
                ))}
              </PromptInputSelect>
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
                status={props.state === "running" && props.hasComposerInput ? "idle" : props.state}
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
                gitStatus={props.gitStatus}
                onBranchChange={props.onBranchChange}
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
