import {
  AGENT_FILE_ACCEPT,
  AGENT_IMAGE_ACCEPT,
  MAX_AGENT_FILE_BYTES,
  MAX_AGENT_FILE_TOTAL_BYTES,
  MAX_AGENT_IMAGE_BYTES,
  MAX_AGENT_IMAGES,
  MAX_AGENT_IMAGE_TOTAL_BYTES,
  type AgentContextUsage,
  type AgentModel,
  type AgentReviewTarget,
  type AgentSandboxMode,
  type AgentSkill,
  type AgentTaskSettings,
  type ProjectGitStatus,
} from "@code-agent/protocol";
import {
  Bug,
  CircleGauge,
  FilePlus2,
  Folder,
  GitBranch,
  GitFork,
  MessageCirclePlus,
  MessageSquareText,
  SendHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import type { Dispatch, RefObject, SetStateAction } from "react";

import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
} from "../../../shared/ai-elements/attachments.js";
import { Context, ContextTrigger } from "../../../shared/ai-elements/context.js";
import { Button } from "../../../shared/ui/button.js";
import { Input } from "../../../shared/ui/input.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../shared/ui/tooltip.js";
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputBody,
  PromptInputButton,
  PromptInputCommand,
  PromptInputCommandEmpty,
  PromptInputCommandGroup,
  PromptInputCommandItem,
  PromptInputCommandList,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputSelect,
  PromptInputSubmit,
  PromptInputTools,
  isPromptInputComposing,
  isPromptInputNewlineShortcut,
  usePromptInputAttachments,
  type PromptInputAttachment,
  type PromptInputAttachmentKind,
  type PromptInputMessage,
} from "../../../shared/ai-elements/prompt-input.js";
import { useTranslation } from "../../../i18n/i18n.js";
import type { ComposerCommandDraftMode, QueuedComposerPrompt } from "../composer-draft-context.js";
import {
  LARGE_PASTE_CHARACTER_THRESHOLD,
  PASTED_TEXT_ATTACHMENT_NAME,
  applyApprovalMode,
  deriveApprovalMode,
  resolveComposerPlaceholder,
  resolveReasoningEffort,
  type ApprovalMode,
  type ComposerState,
  type ComposerSubmitAction,
} from "../composer-state.js";
import {
  movePromptCommandSelection,
  type PromptCommandAction,
  type PromptCommandItem,
} from "./prompt-command.js";
import {
  PromptSkillEditor,
  type PromptSkillContent,
  type PromptSkillEditorHandle,
} from "./prompt-skill-editor.js";

function PromptCommandIcon({ action }: Readonly<{ action: PromptCommandAction }>) {
  const className = "size-4 shrink-0 text-primary";
  switch (action) {
    case "review":
      return <Bug aria-hidden="true" className={className} />;
    case "initialize":
      return <FilePlus2 aria-hidden="true" className={className} />;
    case "subtask":
      return <MessageCirclePlus aria-hidden="true" className={className} />;
    case "compact":
      return <CircleGauge aria-hidden="true" className={className} />;
    case "feedback":
      return <MessageSquareText aria-hidden="true" className={className} />;
    case "fork":
      return <GitFork aria-hidden="true" className={className} />;
  }
}

function ComposerAttachments() {
  const { t } = useTranslation("workbench");
  const attachments = usePromptInputAttachments();
  if (attachments.files.length === 0) {
    return null;
  }
  return (
    <PromptInputHeader>
      <Attachments aria-label={t("composer.addedAttachments")}>
        {attachments.files.map((attachment) => (
          <Attachment
            data={attachment}
            key={attachment.id}
            onRemove={() => {
              attachments.remove(attachment.id);
            }}
          >
            <AttachmentPreview />
            <AttachmentInfo />
            <AttachmentRemove disabled={attachments.disabled} />
          </Attachment>
        ))}
      </Attachments>
    </PromptInputHeader>
  );
}

type CommandAvailability = Readonly<{ available: boolean; reason?: string }>;

export type WorkbenchComposerViewProps = Readonly<{
  activeCommandIndex: number;
  activeCommandItemId: string | undefined;
  activeSettings: AgentTaskSettings;
  activeTurnId: string | undefined;
  attachments: readonly PromptInputAttachment[];
  attachmentsDisabled: boolean;
  baseBranches: readonly string[];
  canInterrupt: boolean;
  canSteer: boolean;
  canSubmit: boolean;
  commandDraftMode: ComposerCommandDraftMode | null;
  commandMenuId: string;
  commandMenuOpen: boolean;
  commandNotice: string | undefined;
  commandSurfaceRef: RefObject<HTMLDivElement | null>;
  composerScope: string;
  contextUsage: AgentContextUsage | null | undefined;
  draftInputDisabled: boolean;
  filteredCommands: readonly PromptCommandItem[];
  filteredSkills: readonly AgentSkill[];
  getCommandAvailability: (command: PromptCommandItem) => CommandAvailability;
  gitStatus: ProjectGitStatus | undefined;
  hasComposerInput: boolean;
  isSubmitting: boolean;
  menuItemCount: number;
  models: readonly AgentModel[];
  modelsError: Error | null;
  modelsPending: boolean;
  mutationError: Error | null;
  onAttachmentsChange: (files: readonly PromptInputAttachment[]) => void;
  onCancelCommandDraft: () => void;
  onExecuteCommand: (command: PromptCommandItem) => void;
  onExecuteReview: (target: AgentReviewTarget) => void;
  onInterrupt: () => void;
  onOpenReviewBranches: () => void;
  onPromptChange: (
    content: PromptSkillContent,
    serializedText: string,
    cursorOffset: number,
  ) => void;
  onSelectActiveCommand: () => void;
  onSelectAttachmentKind: (kind: PromptInputAttachmentKind) => void;
  onSelectSkill: (skill: AgentSkill) => void;
  onSettingsChange: (settings: AgentTaskSettings, field: keyof AgentTaskSettings) => void;
  onSubmit: (message: PromptInputMessage) => void;
  onViewError: (error: Error) => void;
  projectPath: string;
  promptContent: PromptSkillContent;
  promptSubmissionText: string;
  queuedPrompts: readonly QueuedComposerPrompt[];
  removeQueuedPrompt: (queuedPromptId: string) => void;
  reviewMenuMode: "branches" | "scopes" | null;
  selectedModel: AgentModel | undefined;
  selectedReasoningEffort: string | undefined;
  setActiveCommandIndex: Dispatch<SetStateAction<number>>;
  skillEditorRef: RefObject<PromptSkillEditorHandle | null>;
  state: ComposerState;
  steerQueuedPrompt: (queuedPrompt: QueuedComposerPrompt) => void;
  submitAction: ComposerSubmitAction;
  taskId: string | undefined;
  turnControlsDisabled: boolean;
}>;

export function resolveQueuedPromptSummary(
  queuedPrompt: QueuedComposerPrompt,
  attachmentSummary: string,
): string {
  return (
    queuedPrompt.text ||
    queuedPrompt.skills.map((skill) => `$${skill.name}`).join(" ") ||
    attachmentSummary
  );
}

export function WorkbenchComposerView(props: WorkbenchComposerViewProps) {
  const { t } = useTranslation(["workbench", "settings"]);
  const commandMenu =
    !props.commandMenuOpen || props.turnControlsDisabled ? null : (
      <PromptInputCommand
        aria-label={t("composer.commandInput")}
        className="absolute inset-x-0 bottom-full z-20 mb-2"
        id={props.commandMenuId}
      >
        <PromptInputCommandList>
          {props.reviewMenuMode === "scopes" ? (
            <PromptInputCommandGroup label={t("composer.reviewScopeGroup")}>
              <PromptInputCommandItem
                active={props.activeCommandIndex === 0}
                id={`${props.commandMenuId}-item-0`}
                onClick={() => {
                  props.onExecuteReview({ type: "uncommitted_changes" });
                }}
              >
                <Bug aria-hidden="true" className="size-4 shrink-0 text-primary" />
                <span className="font-medium">{t("composer.reviewUncommitted")}</span>
              </PromptInputCommandItem>
              <PromptInputCommandItem
                active={props.activeCommandIndex === 1}
                aria-description={
                  props.baseBranches.length === 0
                    ? t("composer.noBaseBranch")
                    : props.baseBranches[0]
                }
                disabled={props.baseBranches.length === 0}
                id={`${props.commandMenuId}-item-1`}
                onClick={props.onOpenReviewBranches}
              >
                <GitBranch aria-hidden="true" className="size-4 shrink-0 text-primary" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-medium">{t("composer.baseBranchReview")}</span>
                  <span className="truncate text-caption text-muted-foreground">
                    {props.baseBranches[0] ?? t("composer.noBaseBranch")}
                  </span>
                </span>
              </PromptInputCommandItem>
            </PromptInputCommandGroup>
          ) : props.reviewMenuMode === "branches" ? (
            <PromptInputCommandGroup label={t("composer.reviewBaseBranchGroup")}>
              {props.baseBranches.map((branch, index) => (
                <PromptInputCommandItem
                  active={props.activeCommandIndex === index}
                  id={`${props.commandMenuId}-item-${String(index)}`}
                  key={branch}
                  onClick={() => {
                    props.onExecuteReview({ branch, type: "base_branch" });
                  }}
                >
                  <GitBranch aria-hidden="true" className="size-4 shrink-0 text-primary" />
                  <span className="truncate font-medium">{branch}</span>
                </PromptInputCommandItem>
              ))}
            </PromptInputCommandGroup>
          ) : (
            <>
              <PromptInputCommandGroup label={t("composer.commandGroup")}>
                {props.filteredCommands.map((command, index) => {
                  const availability = props.getCommandAvailability(command);
                  return (
                    <PromptInputCommandItem
                      active={index === props.activeCommandIndex}
                      aria-description={availability.reason}
                      disabled={!availability.available}
                      id={`${props.commandMenuId}-item-${String(index)}`}
                      key={command.id}
                      onClick={() => {
                        props.onExecuteCommand(command);
                      }}
                    >
                      <PromptCommandIcon action={command.action} />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="font-medium">{command.label}</span>
                        <span className="text-caption text-muted-foreground">
                          {availability.reason ?? command.description}
                        </span>
                      </span>
                    </PromptInputCommandItem>
                  );
                })}
              </PromptInputCommandGroup>
              {props.filteredSkills.length === 0 ? null : (
                <PromptInputCommandGroup label="Skills">
                  {props.filteredSkills.map((skill, index) => {
                    const menuIndex = props.filteredCommands.length + index;
                    return (
                      <PromptInputCommandItem
                        active={menuIndex === props.activeCommandIndex}
                        id={`${props.commandMenuId}-item-${String(menuIndex)}`}
                        key={skill.id}
                        onClick={() => {
                          props.onSelectSkill(skill);
                        }}
                      >
                        <Sparkles aria-hidden="true" className="size-4 shrink-0 text-primary" />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="font-medium text-primary">{skill.displayName}</span>
                          <span className="block max-w-full truncate text-caption text-muted-foreground">
                            /{skill.name} · {skill.description}
                          </span>
                        </span>
                      </PromptInputCommandItem>
                    );
                  })}
                </PromptInputCommandGroup>
              )}
              {props.menuItemCount === 0 ? (
                <PromptInputCommandEmpty>{t("composer.commandNoMatch")}</PromptInputCommandEmpty>
              ) : null}
            </>
          )}
        </PromptInputCommandList>
      </PromptInputCommand>
    );

  return (
    <section className="shrink-0 bg-content px-3 pb-2 sm:px-5" aria-label={t("composer.landmark")}>
      <div className="relative mx-auto w-full max-w-content" ref={props.commandSurfaceRef}>
        {commandMenu}
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
                        className="hover:text-primary"
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
          largePasteCharacterThreshold={
            props.commandDraftMode === "feedback"
              ? Number.POSITIVE_INFINITY
              : LARGE_PASTE_CHARACTER_THRESHOLD
          }
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
          {props.commandDraftMode === null ? null : (
            <PromptInputHeader className="flex items-center">
              <PromptInputButton
                aria-label={
                  props.commandDraftMode === "feedback"
                    ? t("composer.cancelFeedback")
                    : t("composer.cancelSubtask")
                }
                className="max-w-full border border-separator-strong bg-control text-foreground"
                onClick={props.onCancelCommandDraft}
              >
                {props.commandDraftMode === "feedback" ? (
                  <MessageSquareText
                    className="size-3.5 shrink-0 text-primary"
                    aria-hidden="true"
                  />
                ) : (
                  <MessageCirclePlus
                    className="size-3.5 shrink-0 text-primary"
                    aria-hidden="true"
                  />
                )}
                <span>
                  {props.commandDraftMode === "feedback"
                    ? t("composer.feedback")
                    : t("composer.subtask")}
                </span>
                <X className="size-3.5 shrink-0" aria-hidden="true" />
              </PromptInputButton>
            </PromptInputHeader>
          )}
          <ComposerAttachments />
          <PromptInputBody>
            <Input name="message" type="hidden" value={props.promptSubmissionText} />
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
              placeholder={resolveComposerPlaceholder(props.commandDraftMode, props.taskId)}
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
                disabled={props.attachmentsDisabled || props.commandDraftMode === "feedback"}
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
                <option value="danger-full-access">{t("settings:sandbox.dangerFullAccess")}</option>
              </PromptInputSelect>
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
        <span className="inline-flex shrink-0 items-center gap-1">
          <GitBranch className="size-3" aria-hidden="true" />{" "}
          {props.gitStatus?.branch ?? t("composer.gitBranchMissing")}
        </span>
        <span
          aria-label={t("composer.projectPath")}
          className="inline-flex min-w-0 flex-1 items-center gap-1"
          title={props.projectPath}
        >
          <Folder className="size-3 shrink-0" aria-hidden="true" />
          <span className="truncate">{props.projectPath}</span>
        </span>
        <Context
          className="ml-auto"
          maxTokens={props.contextUsage?.contextWindow}
          usedTokens={props.contextUsage?.usedTokens}
        >
          <ContextTrigger />
        </Context>
      </div>
    </section>
  );
}
