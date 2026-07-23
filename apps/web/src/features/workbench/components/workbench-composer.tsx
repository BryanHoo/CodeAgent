import type {
  AgentCapabilities,
  AgentInput,
  AgentTask,
  AgentTaskSnapshot,
  AgentTurn,
} from "@code-agent/protocol";
import { Folder, GitBranch, Paperclip } from "lucide-react";
import { useRef, useState } from "react";

import type { TaskRuntimeView } from "../../conversation/runtime/use-task-runtime.js";
import type { CodeAgentMutationClient } from "../../projects/project-queries.js";
import {
  PromptInput,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputSelect,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
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
  snapshot: AgentTaskSnapshot | undefined,
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
  input: AgentInput;
  onTaskCreated?: (task: AgentTask) => void;
  projectId: string;
  taskId?: string;
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
  const response = await client.startTurn(taskId, options.input, {
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
  onTaskStarted: (taskId: string) => void;
  projectId: string;
  projectPath: string;
  runtime?: TaskRuntimeView;
  taskId?: string;
}>;

export function WorkbenchComposer({
  capabilities,
  client,
  onTaskStarted,
  projectId,
  projectPath,
  runtime,
  taskId,
}: WorkbenchComposerProps) {
  const [draft, setDraft] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mutationError, setMutationError] = useState<Error | null>(null);
  const [pendingTaskId, setPendingTaskId] = useState<string>();
  const [submittedTurnId, setSubmittedTurnId] = useState<string>();
  const startTaskAttempt = useRef<IdempotencyAttempt | undefined>(undefined);
  const startTurnAttempt = useRef<IdempotencyAttempt | undefined>(undefined);
  const interruptAttempt = useRef<IdempotencyAttempt | undefined>(undefined);
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
  const unavailable = state === "reconnecting" || state === "submitting";

  const submitPrompt = async () => {
    if (!canSubmit || trimmedDraft === "" || unavailable || state === "running") {
      return;
    }
    setIsSubmitting(true);
    setMutationError(null);
    const input = { text: trimmedDraft, type: "text" } as const;
    const turnAttempt = resolveIdempotencyAttempt(startTurnAttempt.current, JSON.stringify(input));
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
      });
      setDraft("");
      setSubmittedTurnId(result.turn.id);
      startTurnAttempt.current = undefined;
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
        aria-busy={state === "submitting" || state === "reconnecting"}
        className="mx-auto w-full max-w-content"
        data-state={state}
        onSubmit={(event) => {
          event.preventDefault();
          void submitPrompt();
        }}
      >
        <PromptInputBody>
          <PromptInputTextarea
            aria-label="任务输入"
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
            <PromptInputButton aria-label="添加附件" disabled title="添加附件">
              <Paperclip className="size-3.5" aria-hidden="true" />
            </PromptInputButton>
            <PromptInputSelect aria-label="批准模式" defaultValue="on-request" disabled>
              <option value="on-request">请求批准</option>
            </PromptInputSelect>
          </PromptInputTools>
          <div className="flex min-w-0 items-center gap-1">
            <PromptInputSelect aria-label="选择模型" defaultValue="gpt-5.6-sol" disabled>
              <option value="gpt-5.6-sol">GPT-5.6 Sol</option>
            </PromptInputSelect>
            <PromptInputSubmit
              aria-label={state === "running" ? "停止" : "提交"}
              disabled={
                unavailable ||
                (state !== "running" && (!canSubmit || trimmedDraft === "")) ||
                (state === "running" && (!canInterrupt || activeTurnId === undefined))
              }
              onClick={state === "running" ? () => void interruptTurn() : undefined}
              status={state}
              type={state === "running" ? "button" : "submit"}
            />
          </div>
        </PromptInputFooter>
      </PromptInput>
      <div className="mx-auto mt-1.5 flex w-full max-w-content min-w-0 items-center gap-3 px-1 text-caption text-muted-foreground">
        <span className="inline-flex shrink-0 items-center gap-1">
          <GitBranch className="size-3" aria-hidden="true" /> main
        </span>
        <span
          aria-label="项目路径"
          className="inline-flex min-w-0 items-center gap-1"
          title={projectPath}
        >
          <Folder className="size-3 shrink-0" aria-hidden="true" />
          <span className="truncate">{projectPath}</span>
        </span>
      </div>
    </section>
  );
}
