import type {
  AgentApprovalPolicy,
  AgentAttachment,
  AgentCapabilities,
  AgentContextUsage,
  AgentModel,
  AgentPromptInput,
  AgentTask,
  AgentTaskSnapshot,
  AgentTurn,
  AgentTurnOptions,
} from "@code-agent/protocol";
import { Folder, Gauge, GitBranch } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import type { TaskRuntimeView } from "../../conversation/runtime/use-task-runtime.js";
import type { CodeAgentMutationClient } from "../../projects/project-queries.js";
import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
} from "../../../shared/ai-elements/attachments.js";
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputBody,
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

export function formatContextUsage(
  usage: AgentContextUsage | null,
): Readonly<{ label: string; title: string }> {
  const contextWindow = usage?.contextWindow;
  const usedTokens = usage?.usedTokens;
  if (contextWindow === null || contextWindow === undefined || usedTokens === undefined) {
    return {
      label: "上下文 --",
      title:
        usedTokens === undefined
          ? "等待模型返回上下文用量"
          : `已使用 ${new Intl.NumberFormat("en-US").format(usedTokens)} tokens`,
    };
  }
  const percentage = Math.min(100, Math.round((usedTokens / contextWindow) * 100));
  const numberFormat = new Intl.NumberFormat("en-US");
  return {
    label: `上下文 ${String(percentage)}%`,
    title: `已使用 ${numberFormat.format(usedTokens)} / ${numberFormat.format(contextWindow)} tokens`,
  };
}

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
  client: CodeAgentMutationClient,
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
  client: CodeAgentMutationClient,
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
  const [attachmentCount, setAttachmentCount] = useState(0);
  const [composerRevision, setComposerRevision] = useState(0);
  const [draft, setDraft] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mutationError, setMutationError] = useState<Error | null>(null);
  const [pendingTaskId, setPendingTaskId] = useState<string>();
  const [selectedModelId, setSelectedModelId] = useState("");
  const [selectedReasoningEffortId, setSelectedReasoningEffortId] = useState("");
  const [submittedTurnId, setSubmittedTurnId] = useState<string>();
  const startTaskAttempt = useRef<IdempotencyAttempt | undefined>(undefined);
  const startTurnAttempt = useRef<IdempotencyAttempt | undefined>(undefined);
  const interruptAttempt = useRef<IdempotencyAttempt | undefined>(undefined);
  const uploadedAttachments = useRef(new Map<string, AgentAttachment>());
  const uploadAttempts = useRef(new Map<string, string>());
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
  const contextUsage = formatContextUsage(runtime?.snapshot?.contextUsage ?? null);
  const unavailable = state === "reconnecting" || state === "submitting";
  const handleAttachmentsChange = useCallback((files: readonly PromptInputAttachment[]) => {
    setAttachmentCount(files.length);
  }, []);

  const submitPrompt = async (message: PromptInputMessage) => {
    const text = message.text.trim();
    if (
      !canSubmit ||
      (text === "" && message.files.length === 0) ||
      selectedModel === undefined ||
      selectedReasoningEffort === undefined ||
      unavailable ||
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

  const interruptTurn = async () => {
    if (!canInterrupt || activeTaskId === undefined || activeTurnId === undefined || unavailable) {
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

  return (
    <section className="shrink-0 bg-content px-3 pb-2 sm:px-5" aria-label="Composer">
      <PromptInput
        accept="image/gif,image/jpeg,image/png,image/webp"
        aria-busy={state === "submitting" || state === "reconnecting"}
        className="mx-auto w-full max-w-content"
        data-state={state}
        disabled={unavailable}
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
          void submitPrompt(message);
        }}
      >
        <ComposerAttachments />
        <PromptInputBody>
          <PromptInputTextarea
            aria-label="任务输入"
            disabled={unavailable}
            onChange={(event) => {
              setDraft(event.currentTarget.value);
            }}
            placeholder={taskId === undefined ? "描述一个新任务" : "继续这个任务"}
            value={draft}
          />
          {mutationError === null ? null : (
            <p className="px-1 pb-1 text-label text-danger" role="alert">
              操作失败，请重试
            </p>
          )}
        </PromptInputBody>
        <PromptInputFooter>
          <PromptInputTools>
            <PromptInputActionAddAttachments disabled={unavailable} label="添加图片" />
            <PromptInputSelect
              aria-label="批准模式"
              disabled={unavailable}
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
              disabled={unavailable || modelsPending || selectedModel === undefined}
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
              disabled={unavailable || modelsPending || selectedModel === undefined}
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
                  思考量 {reasoningEffortLabels[option.id] ?? option.id}
                </option>
              ))}
            </PromptInputSelect>
            <PromptInputSubmit
              aria-label={state === "running" ? "停止" : "提交"}
              disabled={
                unavailable ||
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
        <span
          aria-label="上下文用量"
          className="ml-auto inline-flex shrink-0 items-center gap-1 tabular-nums"
          title={contextUsage.title}
        >
          <Gauge className="size-3" aria-hidden="true" />
          {contextUsage.label}
        </span>
      </div>
    </section>
  );
}
