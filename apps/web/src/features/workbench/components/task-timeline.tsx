import type {
  AgentItem,
  AgentItemStatus,
  AgentTurn,
  PendingRequest,
  Project,
} from "@code-agent/protocol";
import { buildTaskAttachmentUrl } from "@code-agent/client";
import {
  Check,
  Copy,
  FilePenLine,
  Files,
  GitFork,
  MessageSquareCode,
  RotateCcw,
  SquareTerminal,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";

import { getCurrentLanguage, i18n, useTranslation } from "../../../i18n/i18n.js";
import { createAsyncActionLock } from "../../../shared/utils/async-action-lock.js";

import type { RuntimeTaskSnapshot } from "../../conversation/runtime/task-runtime.js";
import {
  PENDING_COMMAND_LABEL,
  RETAINED_COMMAND_OUTPUT_MARKER,
  createTaskStore,
  type NormalizedAgentTurn,
  type TaskItemStore,
  type TaskStore,
} from "../../conversation/runtime/task-store.js";
import type { TaskRuntimeView } from "../../conversation/runtime/use-task-runtime.js";
import {
  countFileChangeLines,
  getFileName,
  summarizeFileChanges,
  type AgentFileChange,
} from "../../diff/file-change.js";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
  ConversationVirtualList,
} from "../../../shared/ai-elements/conversation.js";
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  MessageResponse,
  type MessageFileReference,
} from "../../../shared/ai-elements/message.js";
import {
  Plan,
  PlanContent,
  PlanDescription,
  PlanHeader,
  PlanTitle,
  PlanTrigger,
} from "../../../shared/ai-elements/plan.js";
import { Shimmer } from "../../../shared/ai-elements/shimmer.js";
import {
  Terminal,
  TerminalActions,
  TerminalContent,
  TerminalCopyButton,
  TerminalHeader,
  TerminalTitle,
} from "../../../shared/ai-elements/terminal.js";
import {
  Task,
  TaskContent,
  TaskItem,
  TaskTrigger,
  type TaskStatus,
} from "../../../shared/ai-elements/task.js";
import {
  Tool,
  ToolBody,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
  type ToolState,
} from "../../../shared/ai-elements/tool.js";
import { PendingRequestCard, type PendingRequestResolution } from "./pending-request.js";
import { SkillToken } from "./skill-token.js";
import {
  formatSubagentOperationSummary,
  getSubagentOperationTitle,
  parseSubagentOperation,
  resolveSubagentOperationStatus,
  type SubagentOperation,
} from "./subagent.js";

type ForkTaskAction = (idempotencyKey: string) => Promise<void>;

type TaskTimelineCommonProps = Readonly<{
  canRollbackTurns?: boolean;
  onForkTask?: ForkTaskAction;
  onOpenFileDiff?: (change: AgentFileChange) => void;
  onReviewFileChanges?: (changes: readonly AgentFileChange[]) => void;
  onRollbackTurn?: (turnId: string, idempotencyKey: string) => Promise<void>;
  onOpenSourceFile?: (reference: MessageFileReference) => void;
  onResolvePendingRequest?: (
    request: PendingRequest,
    resolution: PendingRequestResolution,
    idempotencyKey: string,
  ) => Promise<void>;
  runtime?: TaskRuntimeView;
  submissionStartedAt?: string;
  startingSnapshot?: RuntimeTaskSnapshot;
}>;

type TaskTimelineProps = TaskTimelineCommonProps &
  Readonly<
    | {
        onProjectChange: (projectId: string) => void;
        projectId: string;
        projects: readonly Project[];
        taskId?: undefined;
      }
    | {
        taskId: string;
        projectId: string;
      }
  >;

const ignoreFileChange = () => undefined;
const ignoreSourceFile = () => undefined;
const ignoreFileChanges = () => undefined;
const ignorePendingRequest = () => Promise.resolve();
const ignoreRollback = () => Promise.resolve();
const getTurnIdKey = (turnId: string) => turnId;

function EmptyTimeline({
  onProjectChange,
  projectId,
  projects,
}: Readonly<{
  onProjectChange: (projectId: string) => void;
  projectId: string;
  projects: readonly Project[];
}>) {
  return (
    <section
      className="grid min-h-0 flex-1 place-items-center px-6"
      aria-label={i18n.t("timeline.conversation", { ns: "conversation" })}
    >
      <div className="w-full max-w-xl text-center">
        <MessageSquareCode
          aria-hidden="true"
          className="mx-auto size-12 text-muted-foreground/55"
          strokeWidth={1.35}
        />
        <h2 className="mt-5 text-balance text-xl font-normal leading-tight text-foreground">
          {i18n.t("timeline.emptyBefore", { ns: "conversation" })}
          {/* 直接挂载原生选择器，确保首次点击就能打开项目列表。 */}
          <select
            aria-label={i18n.t("timeline.selectProject", { ns: "conversation" })}
            className="mx-1 max-w-full cursor-pointer appearance-none bg-transparent px-0 py-0 text-center font-sans font-normal text-foreground underline decoration-current/35 underline-offset-4 outline-none transition-colors hover:decoration-current focus-visible:rounded-control focus-visible:shadow-focus"
            onChange={(event) => {
              const nextProjectId = event.currentTarget.value;
              if (nextProjectId !== projectId) {
                onProjectChange(nextProjectId);
              }
            }}
            value={projectId}
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          {i18n.t("timeline.emptyAfter", { ns: "conversation" })}
        </h2>
      </div>
    </section>
  );
}

function TimelineState({
  message,
  role,
}: Readonly<{ message: string; role?: "alert" | "status" }>) {
  return (
    <section
      aria-label={i18n.t("timeline.conversation", { ns: "conversation" })}
      className="grid min-h-0 flex-1 place-items-center px-6 text-sm text-muted-foreground"
      role={role}
    >
      {message}
    </section>
  );
}

export function TaskTimeline(props: TaskTimelineProps) {
  useTranslation("conversation");
  if (props.taskId === undefined) {
    if (props.submissionStartedAt !== undefined) {
      return (
        <Conversation
          aria-label={i18n.t("timeline.conversation", { ns: "conversation" })}
          conversationId={`${props.projectId}:new-chat`}
        >
          <ConversationContent className="gap-6">
            <Message from="assistant">
              <TurnProcessingTime completedAt={null} startedAt={props.submissionStartedAt} />
              <RunningReplyStatus />
            </Message>
          </ConversationContent>
        </Conversation>
      );
    }
    return (
      <EmptyTimeline
        onProjectChange={props.onProjectChange}
        projectId={props.projectId}
        projects={props.projects}
      />
    );
  }
  const {
    canRollbackTurns = false,
    onForkTask,
    onOpenFileDiff,
    onOpenSourceFile,
    onReviewFileChanges,
    onResolvePendingRequest,
    onRollbackTurn,
    runtime,
    submissionStartedAt,
    startingSnapshot,
  } = props;
  if (runtime === undefined) {
    return (
      <TimelineState message={i18n.t("timeline.loading", { ns: "conversation" })} role="status" />
    );
  }
  return (
    <ActiveTaskTimeline
      onOpenFileDiff={onOpenFileDiff ?? ignoreFileChange}
      onOpenSourceFile={onOpenSourceFile ?? ignoreSourceFile}
      onReviewFileChanges={onReviewFileChanges ?? ignoreFileChanges}
      onResolvePendingRequest={onResolvePendingRequest ?? ignorePendingRequest}
      onRollbackTurn={onRollbackTurn ?? ignoreRollback}
      canRollbackTurns={canRollbackTurns}
      {...(onForkTask === undefined ? {} : { onForkTask })}
      runtime={runtime}
      submissionStartedAt={submissionStartedAt}
      startingSnapshot={startingSnapshot}
    />
  );
}

function ActiveTaskTimeline({
  canRollbackTurns,
  onForkTask,
  onOpenFileDiff,
  onOpenSourceFile,
  onReviewFileChanges,
  onResolvePendingRequest,
  onRollbackTurn,
  runtime,
  submissionStartedAt,
  startingSnapshot,
}: Readonly<{
  onResolvePendingRequest: (
    request: PendingRequest,
    resolution: PendingRequestResolution,
    idempotencyKey: string,
  ) => Promise<void>;
  onOpenFileDiff: (change: AgentFileChange) => void;
  onForkTask?: ForkTaskAction;
  onOpenSourceFile: (reference: MessageFileReference) => void;
  onReviewFileChanges: (changes: readonly AgentFileChange[]) => void;
  onRollbackTurn: (turnId: string, idempotencyKey: string) => Promise<void>;
  canRollbackTurns: boolean;
  runtime: TaskRuntimeView;
  submissionStartedAt: string | undefined;
  startingSnapshot: RuntimeTaskSnapshot | undefined;
}>) {
  if (runtime.error !== null) {
    return (
      <TimelineState message={i18n.t("timeline.loadError", { ns: "conversation" })} role="alert" />
    );
  }
  if (runtime.isPending || runtime.snapshot === undefined) {
    if (startingSnapshot !== undefined) {
      return <TaskSnapshotTimeline connected={false} snapshot={startingSnapshot} />;
    }
    return (
      <TimelineState message={i18n.t("timeline.loading", { ns: "conversation" })} role="status" />
    );
  }
  if (runtime.store === undefined) {
    return (
      <TimelineState message={i18n.t("timeline.loading", { ns: "conversation" })} role="status" />
    );
  }
  return (
    <>
      {runtime.connectionState === "reconnecting" ? (
        <div
          className="bg-control px-3 py-1.5 text-center text-label text-muted-foreground"
          role="status"
        >
          {i18n.t("timeline.reconnecting", { ns: "conversation" })}
        </div>
      ) : null}
      <TaskStoreTimeline
        canRollbackTurns={canRollbackTurns}
        connected={runtime.connectionState === "connected"}
        {...(onForkTask === undefined ? {} : { onForkTask })}
        onOpenFileDiff={onOpenFileDiff}
        onOpenSourceFile={onOpenSourceFile}
        onReviewFileChanges={onReviewFileChanges}
        onResolvePendingRequest={onResolvePendingRequest}
        onRollbackTurn={onRollbackTurn}
        store={runtime.store}
        {...(submissionStartedAt === undefined ? {} : { submissionStartedAt })}
      />
    </>
  );
}

function toToolState(status: AgentItemStatus): ToolState {
  // Protocol 状态在视图边界映射到官方 Tool 的完整执行状态，不引入 AI SDK Runtime 类型。
  if (status === "pending") {
    return "input-streaming";
  }
  if (status === "running") {
    return "input-available";
  }
  if (status === "declined") {
    return "output-denied";
  }
  if (status === "failed" || status === "interrupted") {
    return "output-error";
  }
  return "output-available";
}

function toTaskStatus(status: AgentItemStatus): TaskStatus {
  // Activity 使用 AI Elements 的四态模型，协议中的拒绝与中断都属于失败终态。
  if (status === "pending") {
    return "pending";
  }
  if (status === "running") {
    return "in_progress";
  }
  if (status === "failed" || status === "declined" || status === "interrupted") {
    return "error";
  }
  return "completed";
}

function formatStructuredValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value, null, 2);
}

function SubagentToolItem({
  item,
  operation,
}: Readonly<{
  item: Extract<AgentItem, { type: "tool" }>;
  operation: SubagentOperation;
}>) {
  const operationStatus = resolveSubagentOperationStatus(item.status, operation.agents);
  const summary = formatSubagentOperationSummary(item.status, operation.agents);

  return (
    <Task collapsible={false} status={operationStatus}>
      <TaskTrigger title={`${getSubagentOperationTitle(operation.name)} · ${summary}`} />
    </Task>
  );
}

const TURN_PROCESSING_TIMER_INTERVAL_MS = 1_000;

function formatTurnProcessingDuration(totalSeconds: number): Readonly<{
  dateTime: string;
  label: string;
}> {
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return {
    dateTime: `PT${hours > 0 ? `${String(hours)}H` : ""}${minutes > 0 ? `${String(minutes)}M` : ""}${String(seconds)}S`,
    label:
      hours > 0
        ? `${String(hours)}h ${String(minutes)}m ${String(seconds)}s`
        : minutes > 0
          ? `${String(minutes)}m ${String(seconds)}s`
          : `${String(seconds)}s`,
  };
}

function TurnProcessingTime({
  completedAt,
  startedAt,
}: Pick<AgentTurn, "completedAt" | "startedAt">) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (startedAt === null || completedAt !== null) {
      return;
    }

    // 只更新独立计时行，Turn 完成后立即清理并改用服务端终态时间。
    const intervalId = globalThis.setInterval(() => {
      setNow(Date.now());
    }, TURN_PROCESSING_TIMER_INTERVAL_MS);
    return () => {
      globalThis.clearInterval(intervalId);
    };
  }, [completedAt, startedAt]);

  if (startedAt === null) {
    return null;
  }
  const startedAtMs = Date.parse(startedAt);
  const endedAtMs = completedAt === null ? now : Date.parse(completedAt);
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(endedAtMs)) {
    return null;
  }
  const totalSeconds = Math.max(0, Math.floor((endedAtMs - startedAtMs) / 1_000));
  const duration = formatTurnProcessingDuration(totalSeconds);

  return (
    <div
      className="mb-4 flex w-full items-center border-b border-separator pb-2.5 text-label font-medium text-muted-foreground"
      data-turn-processing-time=""
    >
      <span>{i18n.t("timeline.processing", { ns: "conversation" })}&nbsp;</span>
      <time dateTime={duration.dateTime}>{duration.label}</time>
    </div>
  );
}

function getMessageTimestamp(
  role: "assistant" | "user",
  turn: Pick<AgentTurn, "completedAt" | "startedAt">,
  latestSnapshotTimestamp: string,
): string {
  // 协议尚未记录 Item 时间；用户消息使用 Turn 开始时间，AI 消息使用完成或最新事件时间。
  if (role === "user") {
    return turn.startedAt ?? latestSnapshotTimestamp;
  }
  return turn.completedAt ?? latestSnapshotTimestamp;
}

function MessageMetadata({
  modeLabel,
  onForkTask,
  text,
  timestamp,
}: Readonly<{
  modeLabel?: string;
  onForkTask?: ForkTaskAction;
  text: string;
  timestamp?: string;
}>) {
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [forkError, setForkError] = useState(false);
  const [forkPending, setForkPending] = useState(false);
  const forkIdempotencyKeyRef = useRef<string | null>(null);
  const messageActionLockRef = useRef(createAsyncActionLock());
  const copied = copiedText === text;
  const messageDate = timestamp === undefined ? undefined : new Date(timestamp);
  const locale = getCurrentLanguage();

  const copyMessage = () =>
    messageActionLockRef.current.run(async () => {
      try {
        // 只在明确点击时访问 Clipboard，避免渲染阶段触发浏览器权限请求。
        await navigator.clipboard.writeText(text);
        setCopiedText(text);
      } catch {
        setCopiedText(null);
      }
    });

  const forkTask = () =>
    messageActionLockRef.current.run(async () => {
      if (onForkTask === undefined) {
        return;
      }
      forkIdempotencyKeyRef.current ??= globalThis.crypto.randomUUID();
      setForkPending(true);
      setForkError(false);
      try {
        // 重试复用同一幂等键，避免响应丢失时重复创建任务。
        await onForkTask(forkIdempotencyKeyRef.current);
      } catch {
        setForkError(true);
      } finally {
        setForkPending(false);
      }
    });

  return (
    <MessageActions className="mt-2 text-label text-muted-foreground">
      <MessageAction
        label={
          copied
            ? i18n.t("timeline.copied", { ns: "conversation" })
            : i18n.t("timeline.copyMessage", { ns: "conversation" })
        }
        onClick={() => {
          void copyMessage();
        }}
        tooltip={
          copied
            ? i18n.t("timeline.copied", { ns: "conversation" })
            : i18n.t("timeline.copyMessage", { ns: "conversation" })
        }
      >
        {copied ? (
          <Check className="size-3.5" aria-hidden="true" />
        ) : (
          <Copy className="size-3.5" aria-hidden="true" />
        )}
      </MessageAction>
      {onForkTask === undefined ? null : (
        <MessageAction
          disabled={forkPending}
          label={
            forkError
              ? i18n.t("timeline.forkFailed", { ns: "conversation" })
              : forkPending
                ? i18n.t("timeline.forking", { ns: "conversation" })
                : i18n.t("timeline.fork", { ns: "conversation" })
          }
          onClick={() => {
            void forkTask();
          }}
          tooltip={
            forkError
              ? i18n.t("timeline.forkFailed", { ns: "conversation" })
              : i18n.t("timeline.fork", { ns: "conversation" })
          }
        >
          <GitFork className="size-3.5" aria-hidden="true" />
        </MessageAction>
      )}
      {modeLabel === undefined ? null : <span>{modeLabel}</span>}
      {timestamp === undefined || messageDate === undefined ? null : (
        <time
          dateTime={timestamp}
          title={new Intl.DateTimeFormat(locale, {
            dateStyle: "medium",
            timeStyle: "medium",
          }).format(messageDate)}
        >
          {new Intl.DateTimeFormat(locale, {
            hour: "2-digit",
            hour12: false,
            minute: "2-digit",
          }).format(messageDate)}
        </time>
      )}
    </MessageActions>
  );
}

function FileChangeButton({
  change,
  onOpen,
}: Readonly<{ change: AgentFileChange; onOpen: (change: AgentFileChange) => void }>) {
  const fileName = getFileName(change.path);
  const operationLabel = i18n.t(`timeline.fileOperation.${change.kind}`, {
    ns: "conversation",
  });
  const { additions, removals } = countFileChangeLines(change);

  return (
    <button
      aria-haspopup="dialog"
      aria-label={i18n.t("timeline.fileChange", {
        additions,
        name: fileName,
        ns: "conversation",
        operation: operationLabel,
        removals,
      })}
      className="flex min-h-9 w-full items-center gap-2 rounded-control bg-control px-2.5 text-left text-label text-foreground transition-colors hover:bg-control-hover"
      data-file-change={change.kind}
      onClick={() => {
        onOpen(change);
      }}
      type="button"
    >
      <FilePenLine className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="shrink-0 text-muted-foreground">{operationLabel}</span>
      <span className="min-w-0 truncate font-medium" title={change.path}>
        {fileName}
      </span>
      <span className="ml-auto shrink-0 text-diff-added">+{additions}</span>
      <span className="shrink-0 text-diff-removed">-{removals}</span>
    </button>
  );
}

function ChangedFilesCard({
  canRollback,
  changes,
  onOpenFileDiff,
  onReviewFileChanges,
  onRollback,
}: Readonly<{
  canRollback: boolean;
  changes: readonly AgentFileChange[];
  onOpenFileDiff: (change: AgentFileChange) => void;
  onReviewFileChanges: (changes: readonly AgentFileChange[]) => void;
  onRollback: (idempotencyKey: string) => Promise<void>;
}>) {
  const [expanded, setExpanded] = useState(false);
  const [rollbackError, setRollbackError] = useState<string | null>(null);
  const [rollbackPending, setRollbackPending] = useState(false);
  const [rollbackIdempotencyKey] = useState(() => globalThis.crypto.randomUUID());
  const rollbackLockRef = useRef(createAsyncActionLock());
  const summary = summarizeFileChanges(changes);
  const visibleChanges = expanded ? summary.changes : summary.changes.slice(0, 3);
  const hiddenChangeCount = summary.changes.length - visibleChanges.length;

  const rollback = () =>
    rollbackLockRef.current.run(async () => {
      setRollbackPending(true);
      setRollbackError(null);
      try {
        await onRollback(rollbackIdempotencyKey);
      } catch (error) {
        setRollbackError(
          error instanceof Error
            ? error.message
            : i18n.t("timeline.rollbackError", { ns: "conversation" }),
        );
      } finally {
        setRollbackPending(false);
      }
    });

  return (
    <section
      aria-label={i18n.t("timeline.changedFiles", {
        count: summary.changes.length,
        ns: "conversation",
      })}
      className="mt-4 w-full overflow-hidden rounded-surface border border-separator-strong bg-raised shadow-control"
    >
      <header className="flex min-h-16 items-center gap-3 px-3 py-2.5 shadow-toolbar">
        <span className="grid size-9 shrink-0 place-items-center rounded-control bg-control text-muted-foreground">
          <Files className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-body-small font-semibold">
            {i18n.t("timeline.editedFiles", {
              count: summary.changes.length,
              ns: "conversation",
            })}
          </h3>
          <p className="mt-0.5 text-label text-muted-foreground">
            <span className="text-diff-added">+{summary.additions}</span>{" "}
            <span className="text-diff-removed">-{summary.removals}</span>
          </p>
        </div>
        {canRollback ? (
          <button
            className="inline-flex h-8 items-center gap-1.5 rounded-control px-2.5 text-label font-medium text-foreground transition-colors hover:bg-control-hover disabled:cursor-wait disabled:opacity-55"
            disabled={rollbackPending}
            onClick={() => {
              void rollback();
            }}
            type="button"
          >
            <RotateCcw className="size-3.5" aria-hidden="true" />
            {rollbackPending
              ? i18n.t("timeline.rollingBack", { ns: "conversation" })
              : i18n.t("timeline.rollback", { ns: "conversation" })}
          </button>
        ) : null}
        <button
          aria-haspopup="dialog"
          className="h-8 rounded-control bg-control px-3 text-label font-semibold text-foreground transition-colors hover:bg-control-hover"
          onClick={() => {
            onReviewFileChanges(summary.changes);
          }}
          type="button"
        >
          {i18n.t("timeline.review", { ns: "conversation" })}
        </button>
      </header>
      <div className="space-y-1 p-2">
        {visibleChanges.map((change) => (
          <FileChangeButton change={change} key={change.path} onOpen={onOpenFileDiff} />
        ))}
        {hiddenChangeCount > 0 ? (
          <button
            className="h-8 w-full rounded-control px-2.5 text-left text-label font-medium text-muted-foreground transition-colors hover:bg-control-hover hover:text-foreground"
            onClick={() => {
              setExpanded(true);
            }}
            type="button"
          >
            {i18n.t("timeline.moreFiles", {
              count: hiddenChangeCount,
              ns: "conversation",
            })}
          </button>
        ) : null}
        {expanded && summary.changes.length > 3 ? (
          <button
            className="h-8 w-full rounded-control px-2.5 text-left text-label font-medium text-muted-foreground transition-colors hover:bg-control-hover hover:text-foreground"
            onClick={() => {
              setExpanded(false);
            }}
            type="button"
          >
            {i18n.t("timeline.collapseFiles", { ns: "conversation" })}
          </button>
        ) : null}
      </div>
      {rollbackError === null ? null : (
        <p className="px-3 pb-3 text-label text-danger" role="alert">
          {rollbackError}
        </p>
      )}
    </section>
  );
}

type IndexedAgentItem = Readonly<{
  item: AgentItem;
  itemIndex: number;
}>;

type RunningOperation = Readonly<{
  label: string;
  type: "command" | "operation";
}>;

function getCommandLabel(command: string): string {
  return command === PENDING_COMMAND_LABEL
    ? i18n.t("timeline.commandPending", { ns: "conversation" })
    : command;
}

function resolveRunningOperation(items: readonly IndexedAgentItem[]): RunningOperation | undefined {
  // 优先展示仍在运行的操作，避免并发 Item 的完成事件覆盖真实当前状态。
  const runningItem = items.findLast(({ item }) => {
    if (item.type === "command" || item.type === "tool") {
      return item.status === "pending" || item.status === "running";
    }
    if (item.type === "activity") {
      return item.status === "pending" || item.status === "running";
    }
    return false;
  })?.item;

  if (runningItem?.type === "command") {
    return { label: getCommandLabel(runningItem.command), type: "command" };
  }
  if (runningItem?.type === "tool") {
    return { label: runningItem.name, type: "operation" };
  }
  if (runningItem?.type === "activity") {
    return { label: runningItem.label, type: "operation" };
  }

  const latestItem = items.at(-1)?.item;
  if (latestItem?.type === "plan") {
    return {
      label: i18n.t("timeline.planGenerating", { ns: "conversation" }),
      type: "operation",
    };
  }

  // 快速操作可能在一次浏览器绘制前完成，Turn 运行期间继续附加最近原始操作。
  const recentItem = items.findLast(
    ({ item }) => item.type === "command" || item.type === "tool" || item.type === "activity",
  )?.item;
  if (recentItem?.type === "command") {
    return { label: getCommandLabel(recentItem.command), type: "command" };
  }
  if (recentItem?.type === "tool") {
    return { label: recentItem.name, type: "operation" };
  }
  if (recentItem?.type === "activity") {
    return { label: recentItem.label, type: "operation" };
  }
  return undefined;
}

function RunningReplyStatus({ operation }: Readonly<{ operation?: RunningOperation | undefined }>) {
  const statusText =
    operation === undefined
      ? i18n.t("timeline.running", { ns: "conversation" })
      : i18n.t("timeline.runningOperation", {
          ns: "conversation",
          operation: operation.label,
        });
  const accessibleLabel =
    operation === undefined
      ? i18n.t("timeline.aiRunning", { ns: "conversation" })
      : i18n.t("timeline.aiRunningOperation", {
          ns: "conversation",
          operation: operation.label,
        });

  return (
    <div className="flex min-w-0 items-center gap-2 text-muted-foreground" role="status">
      {operation?.type === "command" ? (
        <SquareTerminal aria-hidden="true" className="size-3.5 shrink-0" />
      ) : null}
      <Shimmer aria-label={accessibleLabel} as="span" className="min-w-0 truncate text-body-small">
        {statusText}
      </Shimmer>
    </div>
  );
}

function getReviewMessageText(item: Extract<AgentItem, { type: "review" }>): string {
  const target = item.target;
  if (target.type === "uncommitted_changes") {
    return i18n.t("timeline.reviewPrompt.uncommitted", { ns: "conversation" });
  }
  if (target.type === "base_branch") {
    return i18n.t("timeline.reviewPrompt.baseBranch", {
      branch: target.branch,
      ns: "conversation",
    });
  }
  if (target.type === "commit") {
    return target.title === undefined
      ? i18n.t("timeline.reviewPrompt.commit", { ns: "conversation", sha: target.sha })
      : i18n.t("timeline.reviewPrompt.commitWithTitle", {
          ns: "conversation",
          sha: target.sha,
          title: target.title,
        });
  }
  return i18n.t("timeline.reviewPrompt.custom", {
    instructions: target.instructions,
    ns: "conversation",
  });
}

export function resolveMessageResponseRendering({
  isLastTurnItem,
  role,
  turnStatus,
}: Readonly<{
  isLastTurnItem: boolean;
  role: Extract<AgentItem, { type: "message" }>["role"];
  turnStatus: AgentTurn["status"];
}>): Readonly<{ isAnimating: boolean; mode: "static" | "streaming" }> {
  const isActiveAssistantTail = role === "assistant" && isLastTurnItem && turnStatus === "running";
  return {
    isAnimating: isActiveAssistantTail,
    mode: isActiveAssistantTail ? "streaming" : "static",
  };
}

function TimelineItemContent({
  isLastTurnItem,
  item,
  onOpenSourceFile,
  projectId,
  taskId,
  turnStatus,
}: Readonly<{
  isLastTurnItem: boolean;
  item: AgentItem;
  onOpenSourceFile: (reference: MessageFileReference) => void;
  projectId: string;
  taskId: string;
  turnStatus: AgentTurn["status"];
}>) {
  switch (item.type) {
    case "message": {
      const attachments = item.role === "user" ? (item.attachments ?? []) : [];
      const skills = item.role === "user" ? (item.skills ?? []) : [];
      const responseRendering = resolveMessageResponseRendering({
        isLastTurnItem,
        role: item.role,
        turnStatus,
      });
      const hasTextContent = skills.length > 0 || item.text.length > 0;
      const messageBody = hasTextContent ? (
        <div>
          {skills.length === 0 ? null : (
            <span
              className="inline"
              aria-label={i18n.t("timeline.skillsUsed", { ns: "conversation" })}
            >
              {skills.map((skill) => (
                <SkillToken
                  className="relative top-1 me-1.5 bg-raised px-2 text-body leading-6"
                  data-message-skill={skill.name}
                  data-skill-token=""
                  key={skill.name}
                  name={skill.name}
                />
              ))}
            </span>
          )}
          {item.text.length === 0 ? null : (
            <MessageResponse
              className={skills.length === 0 ? "" : "inline [&>p:first-child]:inline"}
              {...responseRendering}
              onOpenFileReference={onOpenSourceFile}
            >
              {item.text}
            </MessageResponse>
          )}
        </div>
      ) : null;

      if (item.role === "assistant") {
        return <MessageContent className="w-full">{messageBody}</MessageContent>;
      }

      return (
        // 确定横向可用空间，避免用户气泡在嵌套收缩容器中提前换行或截断。
        <div className="flex w-full flex-col items-end gap-2">
          {attachments.length === 0 ? null : (
            <div
              className="flex max-w-full flex-wrap justify-end gap-2"
              aria-label={i18n.t("timeline.attachments", { ns: "conversation" })}
            >
              {attachments.map((attachment) => {
                const attachmentUrl = buildTaskAttachmentUrl("", projectId, taskId, attachment.id);
                return (
                  <a
                    aria-label={i18n.t("timeline.showImage", {
                      name: attachment.name,
                      ns: "conversation",
                    })}
                    className="block size-40 max-w-full overflow-hidden rounded-surface bg-control shadow-control transition-opacity hover:opacity-90 focus-visible:shadow-focus"
                    data-message-attachment="image"
                    href={attachmentUrl}
                    key={attachment.id}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {/* 附件与文本气泡分层；历史图片只在进入可视区时读取和解码。 */}
                    <img
                      alt={attachment.name}
                      className="size-full object-cover"
                      decoding="async"
                      height={160}
                      loading="lazy"
                      src={attachmentUrl}
                      width={160}
                    />
                  </a>
                );
              })}
            </div>
          )}
          {messageBody === null ? null : (
            <MessageContent data-message-text="true">{messageBody}</MessageContent>
          )}
        </div>
      );
    }
    case "review":
      return (
        <MessageContent>
          <p>{getReviewMessageText(item)}</p>
        </MessageContent>
      );
    case "reasoning":
      // 原生 Reasoning 仅用于运行时状态同步，避免在界面暴露模型思维链。
      return null;
    case "command": {
      const commandLabel = getCommandLabel(item.command);
      const commandOutput =
        item.output === RETAINED_COMMAND_OUTPUT_MARKER
          ? i18n.t("timeline.outputRetained", { ns: "conversation" })
          : (item.output ?? item.cwd);
      const isStreamingCommand = turnStatus === "running" && item.status === "running";
      return (
        <Tool>
          <ToolHeader state={toToolState(item.status)} title={commandLabel} />
          <ToolBody>
            <Terminal isStreaming={isStreamingCommand} output={commandOutput}>
              <TerminalHeader>
                <TerminalTitle>{i18n.t("timeline.output", { ns: "conversation" })}</TerminalTitle>
                <TerminalActions>
                  <TerminalCopyButton />
                </TerminalActions>
              </TerminalHeader>
              <TerminalContent>
                {item.outputTruncated ? (
                  <p className="mt-2 text-warning">
                    {i18n.t("timeline.outputTruncated", { ns: "conversation" })}
                  </p>
                ) : null}
              </TerminalContent>
            </Terminal>
          </ToolBody>
        </Tool>
      );
    }
    case "file_change":
      // 文件变更统一在回复末尾聚合，避免工具流中重复展示同一组文件。
      return null;
    case "tool": {
      const subagentOperation = parseSubagentOperation(item);
      if (subagentOperation !== null) {
        return <SubagentToolItem item={item} operation={subagentOperation} />;
      }
      const hasErrorOutput =
        item.status === "failed" || item.status === "declined" || item.status === "interrupted";
      const errorText =
        hasErrorOutput && item.output !== undefined
          ? formatStructuredValue(item.output)
          : undefined;

      return (
        <Tool>
          <ToolHeader state={toToolState(item.status)} title={item.name} />
          <ToolContent>
            {item.input === undefined ? null : <ToolInput input={item.input} />}
            <ToolOutput errorText={errorText} output={hasErrorOutput ? undefined : item.output} />
          </ToolContent>
        </Tool>
      );
    }
    case "plan": {
      // Plan Item 没有独立状态；运行中 Turn 的最后一个 Item 即当前流式计划。
      const isStreamingPlan = turnStatus === "running" && isLastTurnItem;
      return (
        <Plan defaultOpen isStreaming={isStreamingPlan}>
          <PlanHeader>
            <div className="min-w-0 flex-1">
              <PlanTitle>{i18n.t("timeline.plan", { ns: "conversation" })}</PlanTitle>
              <PlanDescription>
                {isStreamingPlan
                  ? i18n.t("timeline.planGenerating", { ns: "conversation" })
                  : i18n.t("timeline.planExecuting", { ns: "conversation" })}
              </PlanDescription>
            </div>
            <PlanTrigger />
          </PlanHeader>
          <PlanContent>
            <pre className="whitespace-pre-wrap">{item.text}</pre>
          </PlanContent>
        </Plan>
      );
    }
    case "activity":
      return (
        <Task
          collapsible={item.detail !== undefined}
          status={toTaskStatus(item.status ?? "completed")}
        >
          <TaskTrigger title={item.label} />
          {item.detail === undefined ? null : (
            <TaskContent>
              <TaskItem>{item.detail}</TaskItem>
            </TaskContent>
          )}
        </Task>
      );
  }
}

type StoredTurnTimelineGroup =
  | Readonly<{ itemId: string; type: "user" }>
  | Readonly<{ itemIds: readonly string[]; key: string; type: "assistant" }>;

function groupStoredTurnTimelineItems(
  itemIds: readonly string[],
  itemStoresById: ReadonlyMap<string, TaskItemStore>,
): StoredTurnTimelineGroup[] {
  const groups: StoredTurnTimelineGroup[] = [];
  let assistantItemIds: string[] = [];

  const flushAssistantItems = () => {
    const firstAssistantItemId = assistantItemIds[0];
    if (firstAssistantItemId === undefined) {
      return;
    }
    groups.push({ itemIds: assistantItemIds, key: firstAssistantItemId, type: "assistant" });
    assistantItemIds = [];
  };

  for (const itemId of itemIds) {
    const item = itemStoresById.get(itemId)?.peek();
    if (item?.type === "review" || (item?.type === "message" && item.role === "user")) {
      flushAssistantItems();
      groups.push({ itemId, type: "user" });
      continue;
    }
    assistantItemIds.push(itemId);
  }
  flushAssistantItems();
  return groups;
}

function useTaskItem(itemStore: TaskItemStore): AgentItem {
  useStore(itemStore, (state) => state.revision);
  return itemStore.read();
}

function StoredTimelineItemContentValue({
  isLastTurnItem,
  itemStore,
  onOpenSourceFile,
  projectId,
  taskId,
  turnStatus,
}: Readonly<{
  isLastTurnItem: boolean;
  itemStore: TaskItemStore;
  onOpenSourceFile: (reference: MessageFileReference) => void;
  projectId: string;
  taskId: string;
  turnStatus: AgentTurn["status"];
}>) {
  const item = useTaskItem(itemStore);
  return (
    <TimelineItemContent
      isLastTurnItem={isLastTurnItem}
      item={item}
      onOpenSourceFile={onOpenSourceFile}
      projectId={projectId}
      taskId={taskId}
      turnStatus={turnStatus}
    />
  );
}

function StoredTimelineItemContent({
  isLastTurnItem,
  itemId,
  onOpenSourceFile,
  projectId,
  store,
  taskId,
  turnStatus,
}: Readonly<{
  isLastTurnItem: boolean;
  itemId: string;
  onOpenSourceFile: (reference: MessageFileReference) => void;
  projectId: string;
  store: TaskStore;
  taskId: string;
  turnStatus: AgentTurn["status"];
}>) {
  const itemStore = useStore(store, (state) => state.itemStoresById.get(itemId));
  return itemStore === undefined ? null : (
    <StoredTimelineItemContentValue
      isLastTurnItem={isLastTurnItem}
      itemStore={itemStore}
      onOpenSourceFile={onOpenSourceFile}
      projectId={projectId}
      taskId={taskId}
      turnStatus={turnStatus}
    />
  );
}

function StoredUserMessageValue({
  itemStore,
  latestSnapshotTimestamp,
  onOpenSourceFile,
  projectId,
  taskId,
  turn,
}: Readonly<{
  itemStore: TaskItemStore;
  latestSnapshotTimestamp: string;
  onOpenSourceFile: (reference: MessageFileReference) => void;
  projectId: string;
  taskId: string;
  turn: NormalizedAgentTurn;
}>) {
  const item = useTaskItem(itemStore);
  if (item.type !== "review" && (item.type !== "message" || item.role !== "user")) {
    return null;
  }
  const copiedText =
    item.type === "review"
      ? getReviewMessageText(item)
      : [
          ...(item.skills ?? []).map((skill) => `$${skill.name}`),
          ...(item.attachments ?? []).map((attachment) =>
            i18n.t("timeline.imageCopyLabel", {
              name: attachment.name,
              ns: "conversation",
            }),
          ),
          item.text,
        ]
          .filter((part) => part.length > 0)
          .join("\n");

  return (
    <Message from="user">
      <TimelineItemContent
        isLastTurnItem={false}
        item={item}
        onOpenSourceFile={onOpenSourceFile}
        projectId={projectId}
        taskId={taskId}
        turnStatus={turn.status}
      />
      <MessageMetadata
        {...(item.type === "review"
          ? { modeLabel: i18n.t("timeline.reviewMode", { ns: "conversation" }) }
          : { timestamp: getMessageTimestamp("user", turn, latestSnapshotTimestamp) })}
        text={copiedText}
      />
    </Message>
  );
}

function StoredUserMessage({
  itemId,
  latestSnapshotTimestamp,
  onOpenSourceFile,
  projectId,
  store,
  taskId,
  turn,
}: Readonly<{
  itemId: string;
  latestSnapshotTimestamp: string;
  onOpenSourceFile: (reference: MessageFileReference) => void;
  projectId: string;
  store: TaskStore;
  taskId: string;
  turn: NormalizedAgentTurn;
}>) {
  const itemStore = useStore(store, (state) => state.itemStoresById.get(itemId));
  return itemStore === undefined ? null : (
    <StoredUserMessageValue
      itemStore={itemStore}
      latestSnapshotTimestamp={latestSnapshotTimestamp}
      onOpenSourceFile={onOpenSourceFile}
      projectId={projectId}
      taskId={taskId}
      turn={turn}
    />
  );
}

function StoredRunningReplyStatus({
  itemIds,
  store,
}: Readonly<{ itemIds: readonly string[]; store: TaskStore }>) {
  const operationKey = useStore(store, (state) => {
    const indexedItems = itemIds.flatMap((itemId, itemIndex) => {
      const item = state.itemStoresById.get(itemId)?.peek();
      return item === undefined ? [] : [{ item, itemIndex }];
    });
    const operation = resolveRunningOperation(indexedItems);
    return operation === undefined ? "" : `${operation.type}\u0000${operation.label}`;
  });
  const separatorIndex = operationKey.indexOf("\u0000");
  const operation: RunningOperation | undefined =
    separatorIndex < 0
      ? undefined
      : {
          label: operationKey.slice(separatorIndex + 1),
          type: operationKey.slice(0, separatorIndex) as RunningOperation["type"],
        };
  return <RunningReplyStatus operation={operation} />;
}

function StoredAssistantGroup({
  canRollback,
  itemIds,
  lastTurnItemId,
  latestSnapshotTimestamp,
  onOpenFileDiff,
  onForkTask,
  onOpenSourceFile,
  onReviewFileChanges,
  onRollbackTurn,
  projectId,
  showProcessingTime,
  showRunningShimmer,
  store,
  taskId,
  turn,
}: Readonly<{
  canRollback: boolean;
  itemIds: readonly string[];
  lastTurnItemId: string | undefined;
  latestSnapshotTimestamp: string;
  onOpenFileDiff: (change: AgentFileChange) => void;
  onForkTask?: ForkTaskAction;
  onOpenSourceFile: (reference: MessageFileReference) => void;
  onReviewFileChanges: (changes: readonly AgentFileChange[]) => void;
  onRollbackTurn: (turnId: string, idempotencyKey: string) => Promise<void>;
  projectId: string;
  showProcessingTime: boolean;
  showRunningShimmer: boolean;
  store: TaskStore;
  taskId: string;
  turn: NormalizedAgentTurn;
}>) {
  // 完成态聚合只在 Turn 终态或 Item 顺序变化时执行，不参与文本 Delta。
  const itemStoresById = store.getState().itemStoresById;
  const assistantTextParts: string[] = [];
  const responseFileChanges: AgentFileChange[] = [];
  if (turn.status !== "running") {
    for (const itemId of itemIds) {
      const item = itemStoresById.get(itemId)?.read();
      if (item?.type === "message" && item.role === "assistant") {
        assistantTextParts.push(item.text);
      } else if (item?.type === "file_change" && item.status === "completed") {
        responseFileChanges.push(...item.changes);
      }
    }
  }
  const assistantText = assistantTextParts.join("\n\n");

  return (
    <Message from="assistant">
      {showProcessingTime ? (
        <TurnProcessingTime completedAt={turn.completedAt} startedAt={turn.startedAt} />
      ) : null}
      <div className="w-full space-y-4">
        {itemIds.map((itemId) => (
          <StoredTimelineItemContent
            isLastTurnItem={itemId === lastTurnItemId}
            itemId={itemId}
            key={itemId}
            onOpenSourceFile={onOpenSourceFile}
            projectId={projectId}
            store={store}
            taskId={taskId}
            turnStatus={turn.status}
          />
        ))}
        {showRunningShimmer ? <StoredRunningReplyStatus itemIds={itemIds} store={store} /> : null}
      </div>
      {turn.status !== "running" && responseFileChanges.length > 0 ? (
        <ChangedFilesCard
          canRollback={canRollback}
          changes={responseFileChanges}
          onOpenFileDiff={onOpenFileDiff}
          onReviewFileChanges={onReviewFileChanges}
          onRollback={(idempotencyKey) => onRollbackTurn(turn.id, idempotencyKey)}
        />
      ) : null}
      {turn.status !== "running" && assistantText.trim().length > 0 ? (
        <MessageMetadata
          {...(onForkTask === undefined ? {} : { onForkTask })}
          text={assistantText}
          timestamp={getMessageTimestamp("assistant", turn, latestSnapshotTimestamp)}
        />
      ) : null}
    </Message>
  );
}

function StoreTurnTimelineSection({
  canRollback,
  onForkTask,
  onOpenFileDiff,
  onOpenSourceFile,
  onReviewFileChanges,
  onRollbackTurn,
  projectId,
  store,
  taskId,
  turnId,
  turnIndex,
}: Readonly<{
  canRollback: boolean;
  onForkTask?: ForkTaskAction;
  onOpenFileDiff: (change: AgentFileChange) => void;
  onOpenSourceFile: (reference: MessageFileReference) => void;
  onReviewFileChanges: (changes: readonly AgentFileChange[]) => void;
  onRollbackTurn: (turnId: string, idempotencyKey: string) => Promise<void>;
  projectId: string;
  store: TaskStore;
  taskId: string;
  turnId: string;
  turnIndex: number;
}>) {
  const turn = useStore(store, (state) => state.turnsById[turnId]);
  const itemIds = useStore(store, (state) => state.itemIdsByTurnId[turnId] ?? []);
  if (turn === undefined) {
    return null;
  }
  const latestSnapshotTimestamp = store.getState().snapshotMetadata?.updatedAt ?? "";
  const timelineGroups = groupStoredTurnTimelineItems(itemIds, store.getState().itemStoresById);
  const firstAssistantGroupIndex = timelineGroups.findIndex((group) => group.type === "assistant");
  const hasAssistantItems = firstAssistantGroupIndex >= 0;
  const latestAssistantGroupIndex = timelineGroups.findLastIndex(
    (group) => group.type === "assistant",
  );
  const lastTurnItemId = itemIds.at(-1);

  return (
    <section
      aria-label={`Turn ${String(turnIndex + 1)}`}
      className="space-y-4"
      data-status={turn.status}
    >
      {timelineGroups.map((group, groupIndex) =>
        group.type === "user" ? (
          <StoredUserMessage
            itemId={group.itemId}
            key={group.itemId}
            latestSnapshotTimestamp={latestSnapshotTimestamp}
            onOpenSourceFile={onOpenSourceFile}
            projectId={projectId}
            store={store}
            taskId={taskId}
            turn={turn}
          />
        ) : (
          <StoredAssistantGroup
            canRollback={canRollback && turn.status === "completed"}
            itemIds={group.itemIds}
            key={group.key}
            lastTurnItemId={lastTurnItemId}
            latestSnapshotTimestamp={latestSnapshotTimestamp}
            onOpenFileDiff={onOpenFileDiff}
            {...(turn.status === "completed" &&
            groupIndex === latestAssistantGroupIndex &&
            onForkTask !== undefined
              ? { onForkTask }
              : {})}
            onOpenSourceFile={onOpenSourceFile}
            onReviewFileChanges={onReviewFileChanges}
            onRollbackTurn={onRollbackTurn}
            projectId={projectId}
            showProcessingTime={groupIndex === firstAssistantGroupIndex}
            showRunningShimmer={
              turn.status === "running" && groupIndex === timelineGroups.length - 1
            }
            store={store}
            taskId={taskId}
            turn={turn}
          />
        ),
      )}
      {turn.status === "running" && !hasAssistantItems ? (
        <Message from="assistant">
          <TurnProcessingTime completedAt={turn.completedAt} startedAt={turn.startedAt} />
          <RunningReplyStatus />
        </Message>
      ) : null}
      {turn.error === null ? null : (
        <div
          className="rounded-surface bg-control px-3 py-2 text-label leading-5 text-danger"
          role="alert"
        >
          <p className="font-medium">{i18n.t("timeline.turnFailed", { ns: "conversation" })}</p>
          <p className="mt-1">{turn.error}</p>
        </div>
      )}
    </section>
  );
}

function StorePendingRequestList({
  connected,
  onResolvePendingRequest,
  store,
}: Readonly<{
  connected: boolean;
  onResolvePendingRequest: (
    request: PendingRequest,
    resolution: PendingRequestResolution,
    idempotencyKey: string,
  ) => Promise<void>;
  store: TaskStore;
}>) {
  const pendingRequestIds = useStore(store, (state) => state.pendingRequestIds);
  const pendingRequestsById = useStore(store, (state) => state.pendingRequestsById);
  const visiblePendingRequests = pendingRequestIds.flatMap((requestId) => {
    const request = pendingRequestsById[requestId];
    return request === undefined || request.status === "resolved" ? [] : [request];
  });
  const firstPendingIndex = visiblePendingRequests.findIndex(
    (request) => request.status === "pending",
  );

  return visiblePendingRequests.map((request, index) => (
    <PendingRequestCard
      interactive={connected && request.status === "pending" && index === firstPendingIndex}
      key={request.requestId}
      onResolve={onResolvePendingRequest}
      request={request}
    />
  ));
}

function TaskStoreTimeline({
  canRollbackTurns,
  connected,
  onForkTask,
  onOpenFileDiff,
  onOpenSourceFile,
  onReviewFileChanges,
  onResolvePendingRequest,
  onRollbackTurn,
  store,
  submissionStartedAt,
}: Readonly<{
  canRollbackTurns: boolean;
  connected: boolean;
  onForkTask?: ForkTaskAction;
  onOpenFileDiff: (change: AgentFileChange) => void;
  onOpenSourceFile: (reference: MessageFileReference) => void;
  onReviewFileChanges: (changes: readonly AgentFileChange[]) => void;
  onResolvePendingRequest: (
    request: PendingRequest,
    resolution: PendingRequestResolution,
    idempotencyKey: string,
  ) => Promise<void>;
  onRollbackTurn: (turnId: string, idempotencyKey: string) => Promise<void>;
  store: TaskStore;
  submissionStartedAt?: string;
}>) {
  const projectId = store.getState().projectId;
  const taskId = store.getState().taskId;
  const turnIds = useStore(store, (state) => state.turnIds);
  const pendingRequestIds = useStore(store, (state) => state.pendingRequestIds);
  const pendingRequestsById = useStore(store, (state) => state.pendingRequestsById);
  const hasVisiblePendingRequest = pendingRequestIds.some(
    (requestId) => pendingRequestsById[requestId]?.status !== "resolved",
  );
  const hasRunningTurn = useStore(store, (state) =>
    state.turnIds.some((turnId) => state.turnsById[turnId]?.status === "running"),
  );
  // HTTP 启动窗口只补一个临时尾部；实时 Turn 一到即由 Store 权威状态接管。
  const showPendingSubmission = submissionStartedAt !== undefined && !hasRunningTurn;
  if (turnIds.length === 0 && !hasVisiblePendingRequest && !showPendingSubmission) {
    return (
      <TimelineState message={i18n.t("timeline.noHistory", { ns: "conversation" })} role="status" />
    );
  }
  const latestTurnId = turnIds.at(-1);

  return (
    <Conversation
      aria-label={i18n.t("timeline.conversation", { ns: "conversation" })}
      conversationId={`${projectId}:${taskId}`}
    >
      <ConversationVirtualList
        {...(hasVisiblePendingRequest || showPendingSubmission
          ? {
              footer: (
                <>
                  {hasVisiblePendingRequest ? (
                    <StorePendingRequestList
                      connected={connected}
                      onResolvePendingRequest={onResolvePendingRequest}
                      store={store}
                    />
                  ) : null}
                  {showPendingSubmission ? (
                    <Message from="assistant">
                      <TurnProcessingTime completedAt={null} startedAt={submissionStartedAt} />
                      <RunningReplyStatus />
                    </Message>
                  ) : null}
                </>
              ),
            }
          : {})}
        getItemKey={getTurnIdKey}
        items={turnIds}
        renderItem={(turnId, turnIndex) => (
          <StoreTurnTimelineSection
            canRollback={connected && canRollbackTurns && turnId === latestTurnId}
            {...(connected && turnId === latestTurnId && onForkTask !== undefined
              ? { onForkTask }
              : {})}
            onOpenFileDiff={onOpenFileDiff}
            onOpenSourceFile={onOpenSourceFile}
            onReviewFileChanges={onReviewFileChanges}
            onRollbackTurn={onRollbackTurn}
            projectId={projectId}
            store={store}
            taskId={taskId}
            turnId={turnId}
            turnIndex={turnIndex}
          />
        )}
      />
      <ConversationScrollButton />
    </Conversation>
  );
}

export function TaskSnapshotTimeline({
  canRollbackTurns = false,
  connected = true,
  onForkTask,
  onOpenFileDiff = () => undefined,
  onOpenSourceFile = () => undefined,
  onReviewFileChanges = () => undefined,
  onResolvePendingRequest = () => Promise.resolve(),
  onRollbackTurn = () => Promise.resolve(),
  snapshot,
}: Readonly<{
  canRollbackTurns?: boolean;
  connected?: boolean;
  onForkTask?: ForkTaskAction;
  onOpenFileDiff?: (change: AgentFileChange) => void;
  onOpenSourceFile?: (reference: MessageFileReference) => void;
  onReviewFileChanges?: (changes: readonly AgentFileChange[]) => void;
  onResolvePendingRequest?: (
    request: PendingRequest,
    resolution: PendingRequestResolution,
    idempotencyKey: string,
  ) => Promise<void>;
  onRollbackTurn?: (turnId: string, idempotencyKey: string) => Promise<void>;
  snapshot: RuntimeTaskSnapshot;
}>) {
  useTranslation("conversation");
  const store = useMemo(
    // 启动快照也进入统一归一化边界，确保分组、容量限制和渲染行为与实时 Store 一致。
    () =>
      createTaskStore(
        { projectId: snapshot.projectId, taskId: snapshot.id },
        {
          checkpoint: { sequence: 0, sessionId: "starting-snapshot" },
          snapshot,
        },
      ),
    [snapshot],
  );
  return (
    <TaskStoreTimeline
      canRollbackTurns={canRollbackTurns}
      connected={connected}
      {...(onForkTask === undefined ? {} : { onForkTask })}
      onOpenFileDiff={onOpenFileDiff}
      onOpenSourceFile={onOpenSourceFile}
      onReviewFileChanges={onReviewFileChanges}
      onResolvePendingRequest={onResolvePendingRequest}
      onRollbackTurn={onRollbackTurn}
      store={store}
    />
  );
}
