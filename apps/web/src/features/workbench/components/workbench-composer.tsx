import type {
  AgentApprovalPolicy,
  AgentAttachment,
  AgentCapabilities,
  AgentModel,
  AgentPromptInput,
  AgentTask,
  AgentTaskSnapshot,
  AgentTurn,
  AgentTurnOptions,
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
  X,
} from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import type { TaskRuntimeView } from "../../conversation/runtime/use-task-runtime.js";
import type { CodeAgentMutationClient } from "../../projects/project-queries.js";
import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
} from "../../../shared/ai-elements/attachments.js";
import { Context, ContextTrigger } from "../../../shared/ai-elements/context.js";
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
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
  type PromptInputAttachment,
  type PromptInputMessage,
} from "../../../shared/ai-elements/prompt-input.js";
import {
  filterPromptCommandItems,
  getPromptCommandAvailability,
  movePromptCommandSelection,
  promptCommandItems,
  resolvePromptSlashCommand,
  type PromptCommandAction,
  type PromptCommandItem,
} from "./prompt-command.js";

export type ComposerState = "failed" | "idle" | "reconnecting" | "running" | "submitting";

export type IdempotencyAttempt = Readonly<{
  fingerprint: string;
  key: string;
}>;

export function resolveIdempotencyAttempt(
  previous: IdempotencyAttempt | undefined,
  fingerprint: string,
  createKey: () => string = () => globalThis.crypto.randomUUID(),
): IdempotencyAttempt {
  return previous?.fingerprint === fingerprint ? previous : { fingerprint, key: createKey() };
}

export function resolveReasoningEffort(
  model:
    | Readonly<{
        defaultReasoningEffort: string;
        supportedReasoningEfforts: readonly Readonly<{ id: string }>[];
      }>
    | undefined,
  requestedEffort: string,
): string | undefined {
  if (model === undefined) {
    return undefined;
  }
  return model.supportedReasoningEfforts.some((option) => option.id === requestedEffort)
    ? requestedEffort
    : model.defaultReasoningEffort;
}

const reasoningEffortLabels: Readonly<Record<string, string>> = {
  high: "高",
  low: "低",
  max: "最大",
  medium: "中",
  minimal: "最低",
  ultra: "超高",
  xhigh: "极高",
};

type CommandDraftMode = "feedback" | "subtask";

export function deriveComposerActions(
  capabilities: AgentCapabilities | undefined,
  hasTask: boolean,
): Readonly<{ canInterrupt: boolean; canSubmit: boolean }> {
  return {
    canInterrupt: capabilities?.turns.interrupt ?? false,
    canSubmit:
      capabilities !== undefined &&
      capabilities.turns.start &&
      (hasTask || capabilities.tasks.start),
  };
}

export function deriveComposerState(
  input: Readonly<{
    activeTurnId: string | undefined;
    connectionState: TaskRuntimeView["connectionState"];
    isSubmitting?: boolean;
    mutationFailed?: boolean;
  }>,
): ComposerState {
  if (input.isSubmitting === true) {
    return "submitting";
  }
  if (
    input.connectionState === "closed" ||
    input.connectionState === "connecting" ||
    input.connectionState === "reconnecting"
  ) {
    return "reconnecting";
  }
  if (input.activeTurnId !== undefined) {
    return "running";
  }
  return input.mutationFailed === true ? "failed" : "idle";
}

export function deriveComposerInputAvailability(
  state: ComposerState,
): Readonly<{ attachmentsDisabled: boolean; turnControlsDisabled: boolean }> {
  return {
    // 附件选择是本地操作，实时连接恢复期间仍允许选择、粘贴和拖放文件。
    attachmentsDisabled: state === "submitting",
    turnControlsDisabled: state === "reconnecting" || state === "submitting",
  };
}

export function resolveActiveTurnId(
  snapshot:
    (Pick<AgentTaskSnapshot, "turns"> & Partial<Pick<AgentTaskSnapshot, "status">>) | undefined,
  submittedTurnId: string | undefined,
): string | undefined {
  const runningTurn = snapshot?.turns.findLast((turn) => turn.status === "running");
  if (runningTurn !== undefined) {
    return runningTurn.id;
  }
  const submittedTurn = snapshot?.turns.find((turn) => turn.id === submittedTurnId);
  return submittedTurn === undefined || submittedTurn.status === "running"
    ? submittedTurnId
    : undefined;
}

type StartPromptTurnOptions = Readonly<{
  idempotencyKeys: Readonly<{ startTask?: string; startTurn: string }>;
  input: AgentPromptInput;
  onTaskCreated?: (task: AgentTask) => void;
  projectId: string;
  taskId?: string;
  turnOptions: AgentTurnOptions;
}>;

export async function startPromptTurn(
  client: Pick<CodeAgentMutationClient, "startTask" | "startTurn">,
  options: StartPromptTurnOptions,
): Promise<Readonly<{ createdTask?: AgentTask; taskId: string; turn: AgentTurn }>> {
  let taskId = options.taskId;
  let createdTask: AgentTask | undefined;
  if (taskId === undefined) {
    const startTaskKey = options.idempotencyKeys.startTask;
    if (startTaskKey === undefined) {
      throw new Error("Task creation requires an idempotency key");
    }
    const response = await client.startTask(options.projectId, {
      idempotencyKey: startTaskKey,
    });
    createdTask = response.task;
    taskId = response.task.id;
    options.onTaskCreated?.(response.task);
  }
  const response = await client.startTurn(taskId, options.input, options.turnOptions, {
    idempotencyKey: options.idempotencyKeys.startTurn,
  });
  return {
    ...(createdTask === undefined ? {} : { createdTask }),
    taskId,
    turn: response.turn,
  };
}

export function interruptPromptTurn(
  client: Pick<CodeAgentMutationClient, "interruptTurn">,
  taskId: string,
  turnId: string,
  idempotencyKey: string,
) {
  return client.interruptTurn(taskId, turnId, { idempotencyKey });
}

type WorkbenchComposerProps = Readonly<{
  capabilities: AgentCapabilities | undefined;
  client: CodeAgentMutationClient;
  models: readonly AgentModel[];
  modelsError: Error | null;
  modelsPending: boolean;
  onTaskStarted: (taskId: string) => void;
  projectId: string;
  projectPath: string;
  runtime?: TaskRuntimeView;
  taskId?: string;
}>;

function PromptCommandIcon({ action }: Readonly<{ action: PromptCommandAction }>) {
  const className = "size-4 shrink-0 text-accent";
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
  const attachments = usePromptInputAttachments();
  if (attachments.files.length === 0) {
    return null;
  }
  return (
    <PromptInputHeader>
      <Attachments aria-label="已添加附件">
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

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("error", () => {
      reject(reader.error ?? new Error("附件读取失败"));
    });
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("附件读取失败"));
      }
    });
    reader.readAsDataURL(file);
  });
}

export function WorkbenchComposer({
  capabilities,
  client,
  models,
  modelsError,
  modelsPending,
  onTaskStarted,
  projectId,
  projectPath,
  runtime,
  taskId,
}: WorkbenchComposerProps) {
  const [approvalPolicy, setApprovalPolicy] = useState<AgentApprovalPolicy>("on-request");
  const [activeCommandIndex, setActiveCommandIndex] = useState(0);
  const [attachmentCount, setAttachmentCount] = useState(0);
  const [commandDraftMode, setCommandDraftMode] = useState<CommandDraftMode | null>(null);
  const [commandMenuOpen, setCommandMenuOpen] = useState(false);
  const [commandNotice, setCommandNotice] = useState<string>();
  const [commandQuery, setCommandQuery] = useState("");
  const [composerRevision, setComposerRevision] = useState(0);
  const [draft, setDraft] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mutationError, setMutationError] = useState<Error | null>(null);
  const [pendingTaskId, setPendingTaskId] = useState<string>();
  const [selectedModelId, setSelectedModelId] = useState("");
  const [selectedReasoningEffortId, setSelectedReasoningEffortId] = useState("");
  const [submittedTurnId, setSubmittedTurnId] = useState<string>();
  const commandMenuId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const startTaskAttempt = useRef<IdempotencyAttempt | undefined>(undefined);
  const startTurnAttempt = useRef<IdempotencyAttempt | undefined>(undefined);
  const interruptAttempt = useRef<IdempotencyAttempt | undefined>(undefined);
  const uploadedAttachments = useRef(new Map<string, AgentAttachment>());
  const uploadAttempts = useRef(new Map<string, string>());
  const commandAttempts = useRef(new Map<PromptCommandAction, IdempotencyAttempt>());
  const activeTurnId = resolveActiveTurnId(runtime?.snapshot, submittedTurnId);
  const activeTaskId = taskId ?? pendingTaskId;
  const { canInterrupt, canSubmit } = deriveComposerActions(
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
  const trimmedDraft = draft.trim();
  const selectedModel =
    models.find((model) => model.id === selectedModelId) ??
    models.find((model) => model.isDefault) ??
    models[0];
  const selectedReasoningEffort = resolveReasoningEffort(selectedModel, selectedReasoningEffortId);
  const contextUsage = runtime?.snapshot?.contextUsage;
  const { attachmentsDisabled, turnControlsDisabled } = deriveComposerInputAvailability(state);
  const filteredCommands = filterPromptCommandItems(promptCommandItems, commandQuery);
  const activeCommandItemId =
    !commandMenuOpen || filteredCommands.length === 0
      ? undefined
      : `${commandMenuId}-item-${String(activeCommandIndex)}`;
  const handleAttachmentsChange = useCallback((files: readonly PromptInputAttachment[]) => {
    setAttachmentCount(files.length);
  }, []);

  useEffect(() => {
    if (turnControlsDisabled) {
      setCommandMenuOpen(false);
    }
  }, [turnControlsDisabled]);

  const focusTextarea = () => {
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
  };

  const submitPrompt = async (message: PromptInputMessage) => {
    const text = message.text.trim();
    if (
      !canSubmit ||
      (text === "" && message.files.length === 0) ||
      selectedModel === undefined ||
      selectedReasoningEffort === undefined ||
      turnControlsDisabled ||
      state === "running"
    ) {
      return;
    }
    setIsSubmitting(true);
    setMutationError(null);
    let input: AgentPromptInput;
    try {
      const attachments = await Promise.all(
        message.files.map(async (attachment) => {
          const uploaded = uploadedAttachments.current.get(attachment.id);
          if (uploaded !== undefined) {
            return { id: uploaded.id };
          }
          const idempotencyKey =
            uploadAttempts.current.get(attachment.id) ?? globalThis.crypto.randomUUID();
          uploadAttempts.current.set(attachment.id, idempotencyKey);
          const response = await client.uploadAttachment(
            { dataUrl: await readFileAsDataUrl(attachment.file), name: attachment.name },
            { idempotencyKey },
          );
          uploadedAttachments.current.set(attachment.id, response.attachment);
          return { id: response.attachment.id };
        }),
      );
      input = { attachments, text, type: "prompt" };
    } catch (error) {
      setMutationError(error instanceof Error ? error : new Error("附件上传失败"));
      setIsSubmitting(false);
      return;
    }

    const turnOptions = {
      approvalPolicy,
      model: selectedModel.id,
      reasoningEffort: selectedReasoningEffort,
    } as const;
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
          setPendingTaskId(task.id);
          startTaskAttempt.current = undefined;
        },
        projectId,
        ...(activeTaskId === undefined ? {} : { taskId: activeTaskId }),
        turnOptions,
      });
      setDraft("");
      setCommandDraftMode(null);
      setAttachmentCount(0);
      setComposerRevision((revision) => revision + 1);
      setSubmittedTurnId(result.turn.id);
      startTurnAttempt.current = undefined;
      uploadedAttachments.current.clear();
      uploadAttempts.current.clear();
      if (taskId === undefined) {
        onTaskStarted(result.taskId);
      }
    } catch (error) {
      setMutationError(error instanceof Error ? error : new Error("Prompt submission failed"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const getCommandAvailability = (command: PromptCommandItem) => {
    const availability = getPromptCommandAvailability(
      command,
      capabilities,
      activeTaskId !== undefined,
    );
    if (availability.available && state === "running") {
      return { available: false, reason: "任务运行中" } as const;
    }
    return availability;
  };

  const beginCommandDraft = (mode: CommandDraftMode) => {
    setCommandDraftMode(mode);
    setCommandMenuOpen(false);
    setCommandQuery("");
    setCommandNotice(undefined);
    setDraft("");
    setAttachmentCount(0);
    setComposerRevision((revision) => revision + 1);
    focusTextarea();
  };

  const submitFeedback = async (reason: string) => {
    const normalizedReason = reason.trim();
    if (
      activeTaskId === undefined ||
      normalizedReason === "" ||
      !capabilities?.feedback.upload ||
      turnControlsDisabled
    ) {
      return;
    }
    setIsSubmitting(true);
    setMutationError(null);
    const input = { classification: "other", includeLogs: true, reason: normalizedReason };
    const attempt = resolveIdempotencyAttempt(
      commandAttempts.current.get("feedback"),
      JSON.stringify({ input, taskId: activeTaskId }),
    );
    commandAttempts.current.set("feedback", attempt);
    try {
      await client.uploadFeedback(activeTaskId, input, { idempotencyKey: attempt.key });
      commandAttempts.current.delete("feedback");
      setCommandDraftMode(null);
      setCommandNotice("反馈已发送");
      setDraft("");
    } catch (error) {
      setMutationError(error instanceof Error ? error : new Error("Feedback submission failed"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const executePromptCommand = async (command: PromptCommandItem) => {
    if (!getCommandAvailability(command).available) {
      return;
    }
    setCommandMenuOpen(false);
    setCommandQuery("");
    setCommandNotice(undefined);
    setDraft("");

    if (command.action === "feedback" || command.action === "subtask") {
      beginCommandDraft(command.action);
      return;
    }
    if (command.action === "initialize") {
      await submitPrompt({
        files: [],
        text: "请检查当前项目，并在项目根目录创建或完善 AGENTS.md，写入适用于 Codex 的项目说明、常用命令和验证要求。",
      });
      return;
    }
    if (activeTaskId === undefined) {
      return;
    }

    setIsSubmitting(true);
    setMutationError(null);
    const attempt = resolveIdempotencyAttempt(
      commandAttempts.current.get(command.action),
      `${command.action}:${activeTaskId}`,
    );
    commandAttempts.current.set(command.action, attempt);
    try {
      if (command.action === "review") {
        const response = await client.startReview(
          activeTaskId,
          { target: { type: "uncommitted_changes" } },
          { idempotencyKey: attempt.key },
        );
        setSubmittedTurnId(response.turn.id);
        setCommandNotice("代码审查已开始");
      } else if (command.action === "compact") {
        await client.compactTask(activeTaskId, { idempotencyKey: attempt.key });
        setCommandNotice("正在压缩上下文");
      } else {
        const response = await client.forkTask(activeTaskId, { idempotencyKey: attempt.key });
        onTaskStarted(response.task.id);
      }
      commandAttempts.current.delete(command.action);
    } catch (error) {
      setMutationError(error instanceof Error ? error : new Error("Task command failed"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectActiveCommandItem = () => {
    const command = filteredCommands[activeCommandIndex];
    if (command !== undefined) {
      void executePromptCommand(command);
    }
  };

  const interruptTurn = async () => {
    if (
      !canInterrupt ||
      activeTaskId === undefined ||
      activeTurnId === undefined ||
      turnControlsDisabled
    ) {
      return;
    }
    setIsSubmitting(true);
    setMutationError(null);
    const attempt = resolveIdempotencyAttempt(
      interruptAttempt.current,
      `${activeTaskId}:${activeTurnId}`,
    );
    interruptAttempt.current = attempt;
    try {
      // `202` 仅确认请求已接收；同一 Turn 到达终态前继续复用当前 Key。
      await interruptPromptTurn(client, activeTaskId, activeTurnId, attempt.key);
    } catch (error) {
      setMutationError(error instanceof Error ? error : new Error("Turn interruption failed"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const commandMenu =
    !commandMenuOpen || turnControlsDisabled ? null : (
      <PromptInputCommand
        aria-label="输入命令"
        className="absolute inset-x-0 bottom-full z-20 mb-2"
        id={commandMenuId}
      >
        <PromptInputCommandList>
          <PromptInputCommandGroup label="命令">
            {filteredCommands.map((command, index) => {
              const availability = getCommandAvailability(command);
              return (
                <PromptInputCommandItem
                  active={index === activeCommandIndex}
                  aria-description={availability.reason}
                  disabled={!availability.available}
                  id={`${commandMenuId}-item-${String(index)}`}
                  key={command.id}
                  onClick={() => {
                    void executePromptCommand(command);
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
          {filteredCommands.length === 0 ? (
            <PromptInputCommandEmpty>没有匹配的命令</PromptInputCommandEmpty>
          ) : null}
        </PromptInputCommandList>
      </PromptInputCommand>
    );

  return (
    <section className="shrink-0 bg-content px-3 pb-2 sm:px-5" aria-label="Composer">
      <div className="relative mx-auto w-full max-w-content">
        {commandMenu}
        <PromptInput
          accept="image/gif,image/jpeg,image/png,image/webp"
          aria-busy={state === "submitting" || state === "reconnecting"}
          className="w-full"
          data-state={state}
          disabled={attachmentsDisabled}
          globalDrop
          key={composerRevision}
          maxFiles={4}
          maxFileSize={2 * 1024 * 1024}
          multiple
          onAttachmentsChange={handleAttachmentsChange}
          onError={(error) => {
            setMutationError(new Error(error.message));
          }}
          onSubmit={(message) => {
            if (commandDraftMode === "feedback") {
              void submitFeedback(message.text);
              return;
            }
            if (commandDraftMode === "subtask") {
              void submitPrompt({
                ...message,
                text: `请使用子代理独立处理以下副任务，并在完成后汇总结果：\n\n${message.text}`,
              });
              return;
            }
            void submitPrompt(message);
          }}
        >
          {commandDraftMode === null ? null : (
            <PromptInputHeader className="flex items-center">
              <PromptInputButton
                aria-label={`取消${commandDraftMode === "feedback" ? "反馈" : "副任务"}`}
                className="max-w-full border border-separator-strong bg-control text-foreground"
                onClick={() => {
                  setCommandDraftMode(null);
                  setDraft("");
                  focusTextarea();
                }}
              >
                {commandDraftMode === "feedback" ? (
                  <MessageSquareText className="size-3.5 shrink-0 text-accent" aria-hidden="true" />
                ) : (
                  <MessageCirclePlus className="size-3.5 shrink-0 text-accent" aria-hidden="true" />
                )}
                <span>{commandDraftMode === "feedback" ? "任务反馈" : "副任务"}</span>
                <X className="size-3.5 shrink-0" aria-hidden="true" />
              </PromptInputButton>
            </PromptInputHeader>
          )}
          <ComposerAttachments />
          <PromptInputBody>
            <PromptInputTextarea
              aria-activedescendant={activeCommandItemId}
              aria-controls={commandMenuOpen ? commandMenuId : undefined}
              aria-expanded={commandMenuOpen}
              aria-haspopup="listbox"
              aria-label="任务输入"
              disabled={turnControlsDisabled}
              onChange={(event) => {
                const nextDraft = event.currentTarget.value;
                setDraft(nextDraft);
                setCommandNotice(undefined);
                if (commandDraftMode !== null) {
                  return;
                }
                const slashCommand = resolvePromptSlashCommand(
                  nextDraft,
                  event.currentTarget.selectionStart,
                );
                if (slashCommand === null) {
                  setCommandMenuOpen(false);
                  setCommandQuery("");
                  return;
                }
                // 输入框起始 `/` 片段驱动命令过滤，普通正文不会打开菜单。
                setActiveCommandIndex(0);
                setCommandMenuOpen(true);
                setCommandQuery(slashCommand.query);
              }}
              onKeyDown={(event) => {
                if (!commandMenuOpen || event.nativeEvent.isComposing) {
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setCommandMenuOpen(false);
                  return;
                }
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  setActiveCommandIndex((currentIndex) =>
                    movePromptCommandSelection(
                      currentIndex,
                      event.key === "ArrowDown" ? 1 : -1,
                      filteredCommands.length,
                    ),
                  );
                  return;
                }
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  selectActiveCommandItem();
                }
              }}
              placeholder={
                commandDraftMode === "feedback"
                  ? "输入关于此任务的反馈"
                  : commandDraftMode === "subtask"
                    ? "描述需要交给子代理的任务"
                    : taskId === undefined
                      ? "描述一个新任务"
                      : "继续这个任务"
              }
              ref={textareaRef}
              value={draft}
            />
            {mutationError === null ? null : (
              <p className="px-1 pb-1 text-label text-danger" role="alert">
                操作失败，请重试
              </p>
            )}
            {commandNotice === undefined ? null : (
              <p className="px-1 pb-1 text-label text-muted-foreground" role="status">
                {commandNotice}
              </p>
            )}
          </PromptInputBody>
          <PromptInputFooter>
            <PromptInputTools>
              <PromptInputActionAddAttachments
                disabled={attachmentsDisabled || commandDraftMode === "feedback"}
                label="添加图片"
              />
              <PromptInputSelect
                aria-label="批准模式"
                disabled={turnControlsDisabled}
                onChange={(event) => {
                  setApprovalPolicy(event.currentTarget.value as AgentApprovalPolicy);
                }}
                value={approvalPolicy}
              >
                <option value="untrusted">仅不受信任操作</option>
                <option value="on-request">按需审批</option>
                <option value="never">永不询问</option>
              </PromptInputSelect>
            </PromptInputTools>
            <div className="flex min-w-0 items-center gap-1">
              <PromptInputSelect
                aria-label="选择模型"
                disabled={turnControlsDisabled || modelsPending || selectedModel === undefined}
                onChange={(event) => {
                  setSelectedModelId(event.currentTarget.value);
                }}
                value={selectedModel?.id ?? ""}
              >
                {models.length === 0 ? (
                  <option value="">{modelsPending ? "模型加载中" : "暂无可用模型"}</option>
                ) : (
                  models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.displayName}
                    </option>
                  ))
                )}
              </PromptInputSelect>
              <PromptInputSelect
                aria-label="选择思考量"
                disabled={turnControlsDisabled || modelsPending || selectedModel === undefined}
                onChange={(event) => {
                  setSelectedReasoningEffortId(event.currentTarget.value);
                }}
                title={
                  selectedModel?.supportedReasoningEfforts.find(
                    (option) => option.id === selectedReasoningEffort,
                  )?.description
                }
                value={selectedReasoningEffort ?? ""}
              >
                {selectedModel?.supportedReasoningEfforts.map((option) => (
                  <option key={option.id} value={option.id}>
                    {reasoningEffortLabels[option.id] ?? option.id}
                  </option>
                ))}
              </PromptInputSelect>
              <PromptInputSubmit
                aria-label={state === "running" ? "停止" : "提交"}
                disabled={
                  turnControlsDisabled ||
                  (state !== "running" &&
                    (!canSubmit ||
                      selectedModel === undefined ||
                      selectedReasoningEffort === undefined ||
                      (trimmedDraft === "" && attachmentCount === 0))) ||
                  (state === "running" && (!canInterrupt || activeTurnId === undefined))
                }
                onClick={state === "running" ? () => void interruptTurn() : undefined}
                status={state}
                type={state === "running" ? "button" : "submit"}
              />
            </div>
          </PromptInputFooter>
        </PromptInput>
      </div>
      {modelsError === null ? null : (
        <p className="mx-auto mt-1 w-full max-w-content px-1 text-caption text-danger" role="alert">
          模型列表加载失败
        </p>
      )}
      <div className="mx-auto mt-1.5 flex w-full max-w-content min-w-0 items-center gap-3 px-1 text-caption text-muted-foreground">
        <span className="inline-flex shrink-0 items-center gap-1">
          <GitBranch className="size-3" aria-hidden="true" /> main
        </span>
        <span
          aria-label="项目路径"
          className="inline-flex min-w-0 flex-1 items-center gap-1"
          title={projectPath}
        >
          <Folder className="size-3 shrink-0" aria-hidden="true" />
          <span className="truncate">{projectPath}</span>
        </span>
        <Context
          className="ml-auto"
          maxTokens={contextUsage?.contextWindow}
          usedTokens={contextUsage?.usedTokens}
        >
          <ContextTrigger />
        </Context>
      </div>
    </section>
  );
}
