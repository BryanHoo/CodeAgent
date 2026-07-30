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
  FolderGit2,
  GitFork,
  RotateCcw,
  SquareTerminal,
} from "lucide-react";
import { useRef, useState } from "react";
import { useStore } from "zustand";

import type { RuntimeTaskSnapshot } from "../../conversation/runtime/task-runtime.js";
import type { NormalizedAgentTurn, TaskStore } from "../../conversation/runtime/task-store.js";
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
  parseSubagentOperation,
  resolveSubagentOperationStatus,
  subagentOperationTitles,
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
  startingSnapshot?: RuntimeTaskSnapshot;
}>;

type TaskTimelineProps = TaskTimelineCommonProps &
  Readonly<
    | {
        onProjectChange: (projectId: string) => void;
        projectId: string;
        projects: readonly Project[];
        submissionPending?: boolean;
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
    <section className="grid min-h-0 flex-1 place-items-center px-6" aria-label="会话内容">
      <div className="max-w-sm text-center">
        <FolderGit2 className="mx-auto size-9 text-muted-foreground" strokeWidth={1.4} />
        <h2 className="mt-3 flex h-9 items-center justify-center">
          {/* 直接挂载原生选择器，确保首次点击就能打开项目列表。 */}
          <select
            aria-label="选择新聊天项目"
            className="h-8 max-w-full cursor-pointer appearance-none rounded-control bg-transparent px-2 py-0 text-center text-base font-semibold text-foreground underline decoration-current/35 underline-offset-4 outline-none transition-colors hover:bg-control-hover hover:decoration-current focus:bg-control focus:decoration-current focus:shadow-focus"
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
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">选择一个任务查看历史。</p>
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
      aria-label="会话内容"
      className="grid min-h-0 flex-1 place-items-center px-6 text-sm text-muted-foreground"
      role={role}
    >
      {message}
    </section>
  );
}

export function TaskTimeline(props: TaskTimelineProps) {
  if (props.taskId === undefined) {
    if (props.submissionPending === true) {
      return (
        <Conversation aria-label="会话内容" conversationId={`${props.projectId}:new-chat`}>
          <ConversationContent className="gap-6">
            <Message from="assistant">
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
    startingSnapshot,
  } = props;
  if (runtime === undefined) {
    return <TimelineState message="正在加载任务历史" role="status" />;
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
  startingSnapshot: RuntimeTaskSnapshot | undefined;
}>) {
  if (runtime.error !== null) {
    return <TimelineState message="无法加载任务历史" role="alert" />;
  }
  if (runtime.isPending || runtime.snapshot === undefined) {
    if (startingSnapshot !== undefined) {
      return <TaskSnapshotTimeline connected={false} snapshot={startingSnapshot} />;
    }
    return <TimelineState message="正在加载任务历史" role="status" />;
  }
  if (runtime.store === undefined) {
    return <TimelineState message="正在加载任务历史" role="status" />;
  }
  return (
    <>
      {runtime.connectionState === "reconnecting" ? (
        <div
          className="bg-control px-3 py-1.5 text-center text-label text-muted-foreground"
          role="status"
        >
          实时连接恢复中
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
      <TaskTrigger title={`${subagentOperationTitles[operation.name]} · ${summary}`} />
    </Task>
  );
}

const messageTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  hour12: false,
  minute: "2-digit",
});

const messageDateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "medium",
  timeStyle: "medium",
});

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
  const copied = copiedText === text;
  const messageDate = timestamp === undefined ? undefined : new Date(timestamp);

  const copyMessage = async () => {
    try {
      // 只在明确点击时访问 Clipboard，避免渲染阶段触发浏览器权限请求。
      await navigator.clipboard.writeText(text);
      setCopiedText(text);
    } catch {
      setCopiedText(null);
    }
  };

  const forkTask = async () => {
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
  };

  return (
    <MessageActions className="mt-2 text-label text-muted-foreground">
      <MessageAction
        label={copied ? "已复制" : "复制消息"}
        onClick={() => {
          void copyMessage();
        }}
        tooltip={copied ? "已复制" : "复制消息"}
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
          label={forkError ? "复制任务失败，请重试" : forkPending ? "正在复制任务" : "复制任务"}
          onClick={() => {
            void forkTask();
          }}
          tooltip={forkError ? "复制任务失败，请重试" : "复制任务"}
        >
          <GitFork className="size-3.5" aria-hidden="true" />
        </MessageAction>
      )}
      {modeLabel === undefined ? null : <span>{modeLabel}</span>}
      {timestamp === undefined || messageDate === undefined ? null : (
        <time dateTime={timestamp} title={messageDateTimeFormatter.format(messageDate)}>
          {messageTimeFormatter.format(messageDate)}
        </time>
      )}
    </MessageActions>
  );
}

const fileChangeOperationLabels: Readonly<Record<AgentFileChange["kind"], string>> = {
  create: "已创建",
  delete: "已删除",
  update: "已编辑",
};

function FileChangeButton({
  change,
  onOpen,
}: Readonly<{ change: AgentFileChange; onOpen: (change: AgentFileChange) => void }>) {
  const fileName = getFileName(change.path);
  const operationLabel = fileChangeOperationLabels[change.kind];
  const { additions, removals } = countFileChangeLines(change);

  return (
    <button
      aria-haspopup="dialog"
      aria-label={`${operationLabel} ${fileName}，新增 ${String(additions)} 行，删除 ${String(removals)} 行，打开 Diff`}
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
  const summary = summarizeFileChanges(changes);
  const visibleChanges = expanded ? summary.changes : summary.changes.slice(0, 3);
  const hiddenChangeCount = summary.changes.length - visibleChanges.length;

  const rollback = async () => {
    setRollbackPending(true);
    setRollbackError(null);
    try {
      await onRollback(rollbackIdempotencyKey);
    } catch (error) {
      setRollbackError(error instanceof Error ? error.message : "无法撤销本次更改");
    } finally {
      setRollbackPending(false);
    }
  };

  return (
    <section
      aria-label={`本次修改了 ${String(summary.changes.length)} 个文件`}
      className="mt-4 w-full overflow-hidden rounded-surface border border-separator-strong bg-raised shadow-control"
    >
      <header className="flex min-h-16 items-center gap-3 px-3 py-2.5 shadow-toolbar">
        <span className="grid size-9 shrink-0 place-items-center rounded-control bg-control text-muted-foreground">
          <Files className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-body-small font-semibold">已编辑 {summary.changes.length} 个文件</h3>
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
            {rollbackPending ? "撤销中" : "撤销"}
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
          审核
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
            再显示 {hiddenChangeCount} 个文件
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
            收起文件列表
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

type UserTimelineItem = Extract<AgentItem, { type: "message" | "review" }>;

type TurnTimelineGroup =
  | Readonly<{ item: UserTimelineItem; type: "user" }>
  | Readonly<{ items: readonly IndexedAgentItem[]; key: string; type: "assistant" }>;

type RunningOperation = Readonly<{
  label: string;
  type: "command" | "operation";
}>;

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
    return { label: runningItem.command, type: "command" };
  }
  if (runningItem?.type === "tool") {
    return { label: runningItem.name, type: "operation" };
  }
  if (runningItem?.type === "activity") {
    return { label: runningItem.label, type: "operation" };
  }

  const latestItem = items.at(-1)?.item;
  if (latestItem?.type === "plan") {
    return { label: "生成计划", type: "operation" };
  }

  // 快速操作可能在一次浏览器绘制前完成，Turn 运行期间继续附加最近原始操作。
  const recentItem = items.findLast(
    ({ item }) => item.type === "command" || item.type === "tool" || item.type === "activity",
  )?.item;
  if (recentItem?.type === "command") {
    return { label: recentItem.command, type: "command" };
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
  const statusText = operation === undefined ? "正在运行" : `正在运行 ${operation.label}`;
  const accessibleLabel =
    operation === undefined ? "AI 回复正在运行" : `AI 回复正在运行：${operation.label}`;

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

function groupTurnTimelineItems(items: readonly AgentItem[]): TurnTimelineGroup[] {
  const groups: TurnTimelineGroup[] = [];
  let assistantItems: IndexedAgentItem[] = [];

  const flushAssistantItems = () => {
    const firstAssistantItem = assistantItems[0];
    if (firstAssistantItem === undefined) {
      return;
    }
    groups.push({ items: assistantItems, key: firstAssistantItem.item.id, type: "assistant" });
    assistantItems = [];
  };

  items.forEach((item, itemIndex) => {
    if (item.type === "review" || (item.type === "message" && item.role === "user")) {
      // 用户消息切断回复分组，其余 Item 都属于当前 Turn 的一次 AI 回复。
      flushAssistantItems();
      groups.push({ item, type: "user" });
      return;
    }
    assistantItems.push({ item, itemIndex });
  });
  flushAssistantItems();

  return groups;
}

function getReviewMessageText(item: Extract<AgentItem, { type: "review" }>): string {
  const target = item.target;
  if (target.type === "uncommitted_changes") {
    return "请检查我未提交的更改";
  }
  if (target.type === "base_branch") {
    return `请检查我相对于 ${target.branch} 的更改`;
  }
  if (target.type === "commit") {
    return target.title === undefined
      ? `请检查提交 ${target.sha}`
      : `请检查提交 ${target.sha}：${target.title}`;
  }
  return `请按以下要求检查代码：${target.instructions}`;
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
      const hasTextContent = skills.length > 0 || item.text.length > 0;
      const messageBody = hasTextContent ? (
        <div>
          {skills.length === 0 ? null : (
            <span className="inline" aria-label="使用的 Skills">
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
        <div className="flex max-w-full flex-col items-end gap-2">
          {attachments.length === 0 ? null : (
            <div className="flex max-w-full flex-wrap justify-end gap-2" aria-label="消息附件">
              {attachments.map((attachment) => {
                const attachmentUrl = buildTaskAttachmentUrl("", projectId, taskId, attachment.id);
                return (
                  <a
                    aria-label={`查看图片 ${attachment.name}`}
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
      const commandOutput = item.output ?? item.cwd;
      const isStreamingCommand = turnStatus === "running" && item.status === "running";
      return (
        <Tool>
          <ToolHeader state={toToolState(item.status)} title={item.command} />
          <Terminal isStreaming={isStreamingCommand} output={commandOutput}>
            <TerminalHeader>
              <TerminalTitle>输出</TerminalTitle>
              <TerminalActions>
                <TerminalCopyButton />
              </TerminalActions>
            </TerminalHeader>
            <TerminalContent>
              {item.outputTruncated ? (
                <p className="mt-2 text-warning">输出已截断，仅显示最新内容。</p>
              ) : null}
            </TerminalContent>
          </Terminal>
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
              <PlanTitle>计划</PlanTitle>
              <PlanDescription>{isStreamingPlan ? "正在生成计划" : "执行计划"}</PlanDescription>
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

function TurnTimelineItems({
  canRollback,
  latestSnapshotTimestamp,
  onForkTask,
  onOpenFileDiff,
  onOpenSourceFile,
  onReviewFileChanges,
  onRollbackTurn,
  projectId,
  taskId,
  turn,
}: Readonly<{
  canRollback: boolean;
  latestSnapshotTimestamp: string;
  onForkTask?: ForkTaskAction;
  onOpenFileDiff: (change: AgentFileChange) => void;
  onOpenSourceFile: (reference: MessageFileReference) => void;
  onReviewFileChanges: (changes: readonly AgentFileChange[]) => void;
  onRollbackTurn: (turnId: string, idempotencyKey: string) => Promise<void>;
  projectId: string;
  taskId: string;
  turn: AgentTurn;
}>) {
  const timelineGroups = groupTurnTimelineItems(turn.items);
  const hasAssistantItems = timelineGroups.some((group) => group.type === "assistant");
  const latestAssistantGroupIndex = timelineGroups.findLastIndex(
    (group) => group.type === "assistant",
  );

  const renderedGroups = timelineGroups.map((group, groupIndex) => {
    if (group.type === "user") {
      const copiedText =
        group.item.type === "review"
          ? getReviewMessageText(group.item)
          : [
              ...(group.item.skills ?? []).map((skill) => `$${skill.name}`),
              ...(group.item.attachments ?? []).map((attachment) => `[图片] ${attachment.name}`),
              group.item.text,
            ]
              .filter((part) => part.length > 0)
              .join("\n");
      return (
        <Message from="user" key={group.item.id}>
          <TimelineItemContent
            isLastTurnItem={false}
            item={group.item}
            onOpenSourceFile={onOpenSourceFile}
            projectId={projectId}
            taskId={taskId}
            turnStatus={turn.status}
          />
          <MessageMetadata
            {...(group.item.type === "review"
              ? { modeLabel: "审查模式" }
              : {
                  timestamp: getMessageTimestamp("user", turn, latestSnapshotTimestamp),
                })}
            text={copiedText}
          />
        </Message>
      );
    }

    const assistantText = group.items
      .flatMap(({ item }) =>
        item.type === "message" && item.role === "assistant" ? [item.text] : [],
      )
      .join("\n\n");
    const responseFileChanges = group.items.flatMap(({ item }) =>
      item.type === "file_change" && item.status === "completed" ? item.changes : [],
    );
    const showCompletedFooter = turn.status !== "running" && assistantText.trim().length > 0;
    const showChangedFilesCard = turn.status !== "running" && responseFileChanges.length > 0;
    const showRunningShimmer =
      turn.status === "running" && groupIndex === timelineGroups.length - 1;
    const runningOperation = showRunningShimmer ? resolveRunningOperation(group.items) : undefined;
    return (
      <Message from="assistant" key={group.key}>
        <div className="w-full space-y-4">
          {group.items.map(({ item, itemIndex }) => {
            return (
              <TimelineItemContent
                isLastTurnItem={itemIndex === turn.items.length - 1}
                item={item}
                key={item.id}
                onOpenSourceFile={onOpenSourceFile}
                projectId={projectId}
                taskId={taskId}
                turnStatus={turn.status}
              />
            );
          })}
          {showRunningShimmer ? <RunningReplyStatus operation={runningOperation} /> : null}
        </div>
        {showChangedFilesCard ? (
          <ChangedFilesCard
            canRollback={canRollback}
            changes={responseFileChanges}
            onOpenFileDiff={onOpenFileDiff}
            onReviewFileChanges={onReviewFileChanges}
            onRollback={(idempotencyKey) => onRollbackTurn(turn.id, idempotencyKey)}
          />
        ) : null}
        {showCompletedFooter ? (
          <MessageMetadata
            {...(groupIndex === latestAssistantGroupIndex && onForkTask !== undefined
              ? { onForkTask }
              : {})}
            text={assistantText}
            timestamp={getMessageTimestamp("assistant", turn, latestSnapshotTimestamp)}
          />
        ) : null}
      </Message>
    );
  });

  return (
    <>
      {renderedGroups}
      {turn.status === "running" && !hasAssistantItems ? (
        <Message from="assistant">
          {/* 首个 Delta 到达前同样用回复尾行的 Shimmer 表达实时运行状态。 */}
          <RunningReplyStatus />
        </Message>
      ) : null}
    </>
  );
}

type StoredTurnTimelineGroup =
  | Readonly<{ itemId: string; type: "user" }>
  | Readonly<{ itemIds: readonly string[]; key: string; type: "assistant" }>;

function groupStoredTurnTimelineItems(
  itemIds: readonly string[],
  itemsById: Readonly<Record<string, AgentItem>>,
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
    const item = itemsById[itemId];
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
  const item = useStore(store, (state) => state.itemsById[itemId]);
  return item === undefined ? null : (
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
  const item = useStore(store, (state) => state.itemsById[itemId]);
  if (
    item === undefined ||
    (item.type !== "review" && (item.type !== "message" || item.role !== "user"))
  ) {
    return null;
  }
  const copiedText =
    item.type === "review"
      ? getReviewMessageText(item)
      : [
          ...(item.skills ?? []).map((skill) => `$${skill.name}`),
          ...(item.attachments ?? []).map((attachment) => `[图片] ${attachment.name}`),
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
          ? { modeLabel: "审查模式" }
          : { timestamp: getMessageTimestamp("user", turn, latestSnapshotTimestamp) })}
        text={copiedText}
      />
    </Message>
  );
}

function StoredRunningReplyStatus({
  itemIds,
  store,
}: Readonly<{ itemIds: readonly string[]; store: TaskStore }>) {
  const operationKey = useStore(store, (state) => {
    const indexedItems = itemIds.flatMap((itemId, itemIndex) => {
      const item = state.itemsById[itemId];
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
  showRunningShimmer: boolean;
  store: TaskStore;
  taskId: string;
  turn: NormalizedAgentTurn;
}>) {
  // 完成态聚合只在 Turn 终态或 Item 顺序变化时执行，不参与文本 Delta。
  const itemsById = store.getState().itemsById;
  const assistantTextParts: string[] = [];
  const responseFileChanges: AgentFileChange[] = [];
  if (turn.status !== "running") {
    for (const itemId of itemIds) {
      const item = itemsById[itemId];
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
  const timelineGroups = groupStoredTurnTimelineItems(itemIds, store.getState().itemsById);
  const hasAssistantItems = timelineGroups.some((group) => group.type === "assistant");
  const latestAssistantGroupIndex = timelineGroups.findLastIndex(
    (group) => group.type === "assistant",
  );
  const lastTurnItemId = itemIds.at(-1);

  return (
    <section
      aria-label={`Turn ${String(turnIndex + 1)}`}
      className="space-y-4 [contain-intrinsic-size:auto_300px] [content-visibility:auto]"
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
          <RunningReplyStatus />
        </Message>
      ) : null}
      {turn.error === null ? null : (
        <div
          className="rounded-surface bg-control px-3 py-2 text-label leading-5 text-danger"
          role="alert"
        >
          <p className="font-medium">Turn 执行失败</p>
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
}>) {
  const projectId = store.getState().projectId;
  const taskId = store.getState().taskId;
  const turnIds = useStore(store, (state) => state.turnIds);
  const pendingRequestIds = useStore(store, (state) => state.pendingRequestIds);
  const pendingRequestsById = useStore(store, (state) => state.pendingRequestsById);
  const hasVisiblePendingRequest = pendingRequestIds.some(
    (requestId) => pendingRequestsById[requestId]?.status !== "resolved",
  );
  if (turnIds.length === 0 && !hasVisiblePendingRequest) {
    return <TimelineState message="此任务暂无历史" role="status" />;
  }
  const latestTurnId = turnIds.at(-1);

  return (
    <Conversation aria-label="会话内容" conversationId={`${projectId}:${taskId}`}>
      <ConversationContent className="gap-6">
        {turnIds.map((turnId, turnIndex) => (
          <StoreTurnTimelineSection
            canRollback={connected && canRollbackTurns && turnId === latestTurnId}
            key={turnId}
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
        ))}
        <StorePendingRequestList
          connected={connected}
          onResolvePendingRequest={onResolvePendingRequest}
          store={store}
        />
      </ConversationContent>
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
  // 审批完成后仍保留实时快照记录，但已解决请求不再占用消息时间线。
  const visiblePendingRequests = snapshot.pendingRequests.filter(
    (request) => request.status !== "resolved",
  );
  if (snapshot.turns.length === 0 && visiblePendingRequests.length === 0) {
    return <TimelineState message="此任务暂无历史" role="status" />;
  }
  const firstPendingIndex = visiblePendingRequests.findIndex(
    (candidate) => candidate.status === "pending",
  );
  const latestTurnId = snapshot.turns.at(-1)?.id;

  return (
    <Conversation aria-label="会话内容" conversationId={`${snapshot.projectId}:${snapshot.id}`}>
      <ConversationContent className="gap-6">
        {snapshot.turns.map((turn, turnIndex) => (
          <section
            aria-label={`Turn ${String(turnIndex + 1)}`}
            className="space-y-4 [contain-intrinsic-size:auto_300px] [content-visibility:auto]"
            data-status={turn.status}
            key={turn.id}
          >
            <TurnTimelineItems
              canRollback={
                connected &&
                canRollbackTurns &&
                turn.status === "completed" &&
                turn.id === latestTurnId
              }
              latestSnapshotTimestamp={snapshot.updatedAt}
              {...(connected &&
              turn.status === "completed" &&
              turn.id === latestTurnId &&
              onForkTask !== undefined
                ? { onForkTask }
                : {})}
              onOpenFileDiff={onOpenFileDiff}
              onOpenSourceFile={onOpenSourceFile}
              onReviewFileChanges={onReviewFileChanges}
              onRollbackTurn={onRollbackTurn}
              projectId={snapshot.projectId}
              taskId={snapshot.id}
              turn={turn}
            />
            {turn.error === null ? null : (
              <div
                className="rounded-surface bg-control px-3 py-2 text-label leading-5 text-danger"
                role="alert"
              >
                <p className="font-medium">Turn 执行失败</p>
                <p className="mt-1">{turn.error}</p>
              </div>
            )}
          </section>
        ))}
        {visiblePendingRequests.map((request, index) => {
          // 只开放队首未解决请求，避免并发响应改变 Provider 的请求顺序。
          return (
            <PendingRequestCard
              interactive={connected && request.status === "pending" && index === firstPendingIndex}
              key={request.requestId}
              onResolve={onResolvePendingRequest}
              request={request}
            />
          );
        })}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
}
