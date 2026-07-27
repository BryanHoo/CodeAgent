import type {
  AgentItem,
  AgentItemStatus,
  AgentTurn,
  PendingRequest,
  Project,
} from "@code-agent/protocol";
import {
  Check,
  ChevronDown,
  Copy,
  FilePenLine,
  Files,
  FolderGit2,
  RotateCcw,
  Sparkles,
  SquareTerminal,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { RuntimeTaskSnapshot } from "../../conversation/runtime/task-runtime.js";
import {
  useTaskRuntime,
  type TaskRuntimeView,
} from "../../conversation/runtime/use-task-runtime.js";
import type { CodeAgentRuntimeClient } from "../../projects/project-queries.js";
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

type TaskTimelineCommonProps = Readonly<{
  canRollbackTurns?: boolean;
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
        taskId?: undefined;
      }
    | {
        taskId: string;
        client: CodeAgentRuntimeClient;
        projectId: string;
      }
  >;

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
          <span className="relative inline-flex max-w-full items-center">
            <select
              aria-label="选择新聊天项目"
              className="h-8 max-w-full cursor-pointer appearance-none rounded-control bg-transparent py-0 pl-2 pr-7 text-base font-semibold text-foreground outline-none transition-colors hover:bg-control-hover focus:bg-control focus:shadow-focus"
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
            <ChevronDown
              className="pointer-events-none absolute right-2 size-3.5 text-muted-foreground"
              aria-hidden="true"
            />
          </span>
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
    client,
    onOpenFileDiff,
    onOpenSourceFile,
    onReviewFileChanges,
    onResolvePendingRequest,
    onRollbackTurn,
    runtime,
    projectId,
    startingSnapshot,
  } = props;
  if (runtime === undefined) {
    return <TimelineState message="正在加载任务历史" role="status" />;
  }
  return (
    <ActiveTaskTimeline
      client={client}
      onOpenFileDiff={onOpenFileDiff ?? (() => undefined)}
      onOpenSourceFile={onOpenSourceFile ?? (() => undefined)}
      onReviewFileChanges={onReviewFileChanges ?? (() => undefined)}
      onResolvePendingRequest={onResolvePendingRequest ?? (() => Promise.resolve())}
      onRollbackTurn={onRollbackTurn ?? (() => Promise.resolve())}
      canRollbackTurns={canRollbackTurns}
      runtime={runtime}
      projectId={projectId}
      startingSnapshot={startingSnapshot}
    />
  );
}

function ActiveTaskTimeline({
  canRollbackTurns,
  client,
  onOpenFileDiff,
  onOpenSourceFile,
  onReviewFileChanges,
  onResolvePendingRequest,
  onRollbackTurn,
  runtime,
  projectId,
  startingSnapshot,
}: Readonly<{
  onResolvePendingRequest: (
    request: PendingRequest,
    resolution: PendingRequestResolution,
    idempotencyKey: string,
  ) => Promise<void>;
  onOpenFileDiff: (change: AgentFileChange) => void;
  onOpenSourceFile: (reference: MessageFileReference) => void;
  onReviewFileChanges: (changes: readonly AgentFileChange[]) => void;
  onRollbackTurn: (turnId: string, idempotencyKey: string) => Promise<void>;
  canRollbackTurns: boolean;
  client: CodeAgentRuntimeClient;
  projectId: string;
  runtime: TaskRuntimeView;
  startingSnapshot: RuntimeTaskSnapshot | undefined;
}>) {
  const [selectedSubagent, setSelectedSubagent] = useState<SubagentSelection | null>(null);

  if (runtime.error !== null) {
    return <TimelineState message="无法加载任务历史" role="alert" />;
  }
  if (runtime.isPending || runtime.snapshot === undefined) {
    if (startingSnapshot !== undefined) {
      return <TaskSnapshotTimeline connected={false} snapshot={startingSnapshot} />;
    }
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
      <TaskSnapshotTimeline
        canRollbackTurns={canRollbackTurns}
        connected={runtime.connectionState === "connected"}
        onOpenFileDiff={onOpenFileDiff}
        onOpenSourceFile={onOpenSourceFile}
        onReviewFileChanges={onReviewFileChanges}
        onResolvePendingRequest={onResolvePendingRequest}
        onRollbackTurn={onRollbackTurn}
        onOpenSubagent={setSelectedSubagent}
        snapshot={runtime.snapshot}
      />
      {selectedSubagent === null ? null : (
        <SubagentTaskDialog
          client={client}
          onClose={() => {
            setSelectedSubagent(null);
          }}
          projectId={projectId}
          selection={selectedSubagent}
        />
      )}
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

type SubagentOperationName =
  "agent/close" | "agent/resume" | "agent/send_input" | "agent/spawn" | "agent/wait";

type SubagentOperation = Readonly<{
  agents: readonly Readonly<{
    message?: string;
    status: AgentItemStatus;
    taskId: string;
  }>[];
  model?: string;
  name: SubagentOperationName;
  prompt?: string;
  reasoningEffort?: string;
}>;

type SubagentSelection = Readonly<{
  status: AgentItemStatus;
  taskId: string;
}>;

const subagentOperationTitles: Readonly<Record<SubagentOperationName, string>> = {
  "agent/close": "关闭子代理",
  "agent/resume": "恢复子代理",
  "agent/send_input": "向子代理发送消息",
  "agent/spawn": "启动子代理",
  "agent/wait": "等待子代理",
};

function isStructuredRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAgentItemStatus(value: unknown): value is AgentItemStatus {
  return (
    value === "pending" ||
    value === "running" ||
    value === "completed" ||
    value === "failed" ||
    value === "declined" ||
    value === "interrupted"
  );
}

function parseSubagentOperation(
  item: Extract<AgentItem, { type: "tool" }>,
): SubagentOperation | null {
  if (!(item.name in subagentOperationTitles)) {
    return null;
  }
  const input = isStructuredRecord(item.input) ? item.input : {};
  const output = isStructuredRecord(item.output) ? item.output : {};
  const nativeAgents = Array.isArray(output["agents"]) ? output["agents"] : [];
  const agents = nativeAgents.flatMap((value) => {
    if (!isStructuredRecord(value)) {
      return [];
    }
    const taskId = value["taskId"];
    const status = value["status"];
    if (typeof taskId !== "string" || !isAgentItemStatus(status)) {
      return [];
    }
    const message = value["message"];
    return [
      {
        ...(typeof message === "string" ? { message } : {}),
        status,
        taskId,
      },
    ];
  });
  return {
    agents,
    ...(typeof input["model"] === "string" ? { model: input["model"] } : {}),
    name: item.name as SubagentOperationName,
    ...(typeof input["prompt"] === "string" ? { prompt: input["prompt"] } : {}),
    ...(typeof input["reasoningEffort"] === "string"
      ? { reasoningEffort: input["reasoningEffort"] }
      : {}),
  };
}

function formatSubagentModel(model: string): string {
  return model
    .split("-")
    .map((segment) =>
      segment === "gpt" ? "GPT" : `${segment.charAt(0).toUpperCase()}${segment.slice(1)}`,
    )
    .join("-");
}

function resolveSubagentTaskStatus(
  operationStatus: AgentItemStatus,
  agents: SubagentOperation["agents"],
): TaskStatus {
  if (agents.some((agent) => agent.status === "running" || agent.status === "pending")) {
    return "in_progress";
  }
  if (
    agents.some(
      (agent) =>
        agent.status === "failed" || agent.status === "declined" || agent.status === "interrupted",
    )
  ) {
    return "error";
  }
  return toTaskStatus(operationStatus);
}

function SubagentToolItem({
  item,
  onOpenSubagent,
  operation,
}: Readonly<{
  item: Extract<AgentItem, { type: "tool" }>;
  onOpenSubagent: (selection: SubagentSelection) => void;
  operation: SubagentOperation;
}>) {
  const parentStatus = resolveSubagentTaskStatus(item.status, operation.agents);
  const metadata = [
    operation.model === undefined ? undefined : formatSubagentModel(operation.model),
    operation.reasoningEffort,
  ].filter((value): value is string => value !== undefined);

  return (
    <Task defaultOpen status={parentStatus}>
      <TaskTrigger title={subagentOperationTitles[operation.name]} />
      <TaskContent className="space-y-1">
        {operation.prompt === undefined ? null : (
          <TaskItem>
            <span className="font-medium text-foreground">任务：</span>
            <MessageResponse>{operation.prompt}</MessageResponse>
          </TaskItem>
        )}
        {metadata.length === 0 ? null : <TaskItem>{metadata.join(" · ")}</TaskItem>}
        {operation.agents.map((agent) => (
          <button
            aria-haspopup="dialog"
            aria-label={`打开子代理 ${agent.taskId} 的实时输出`}
            className="block w-full rounded-control text-left transition-colors hover:bg-control-hover focus-visible:shadow-focus focus-visible:outline-none"
            key={agent.taskId}
            onClick={() => {
              onOpenSubagent({ status: agent.status, taskId: agent.taskId });
            }}
            type="button"
          >
            <Task collapsible={false} status={toTaskStatus(agent.status)}>
              <TaskTrigger title={`子代理 ${agent.taskId}`} />
            </Task>
          </button>
        ))}
      </TaskContent>
    </Task>
  );
}

function SubagentTaskDialog({
  client,
  onClose,
  projectId,
  selection,
}: Readonly<{
  client: CodeAgentRuntimeClient;
  onClose: () => void;
  projectId: string;
  selection: SubagentSelection;
}>) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const runtime = useTaskRuntime(projectId, selection.taskId, client);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog !== null && !dialog.open) {
      dialog.showModal();
    }
  }, []);

  const titleId = "subagent-output-dialog-title";
  let content;
  if (runtime.error !== null) {
    content = <TimelineState message="无法加载子代理输出" role="alert" />;
  } else if (runtime.isPending || runtime.snapshot === undefined) {
    content = <TimelineState message="正在加载子代理输出" role="status" />;
  } else {
    content = (
      <>
        {runtime.connectionState === "reconnecting" ? (
          <div
            className="bg-control px-3 py-1.5 text-center text-label text-muted-foreground"
            role="status"
          >
            子代理实时连接恢复中
          </div>
        ) : null}
        <TaskSnapshotTimeline
          connected={runtime.connectionState === "connected"}
          snapshot={runtime.snapshot}
        />
      </>
    );
  }

  return (
    <dialog
      aria-labelledby={titleId}
      className="m-auto h-[min(86vh,58rem)] w-[min(94vw,76rem)] max-w-none overflow-hidden rounded-surface bg-raised p-0 text-foreground shadow-panel backdrop:bg-scrim"
      data-subagent-output-dialog=""
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      ref={dialogRef}
    >
      <section className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-raised">
        <header className="flex min-h-toolbar items-center gap-3 px-3 shadow-toolbar sm:px-4">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-body-small font-semibold" id={titleId}>
              子代理实时输出
            </h2>
            <p className="truncate text-caption text-muted-foreground" title={selection.taskId}>
              {selection.taskId}
            </p>
          </div>
          <Task collapsible={false} status={toTaskStatus(selection.status)}>
            <TaskTrigger title={`子代理 ${selection.taskId}`} />
          </Task>
          <button
            aria-label="关闭子代理实时输出"
            className="grid size-8 shrink-0 place-items-center rounded-control text-muted-foreground transition-colors hover:bg-control-hover hover:text-foreground focus-visible:shadow-focus focus-visible:outline-none"
            onClick={onClose}
            type="button"
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </header>
        <div className="flex min-h-0 flex-col overflow-hidden bg-content">{content}</div>
      </section>
    </dialog>
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
  turn: RuntimeTaskSnapshot["turns"][number],
  latestSnapshotTimestamp: string,
): string {
  // 协议尚未记录 Item 时间；用户消息使用 Turn 开始时间，AI 消息使用完成或最新事件时间。
  if (role === "user") {
    return turn.startedAt ?? latestSnapshotTimestamp;
  }
  return turn.completedAt ?? latestSnapshotTimestamp;
}

function MessageMetadata({
  text,
  timestamp,
}: Readonly<{
  text: string;
  timestamp: string;
}>) {
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const copied = copiedText === text;
  const messageDate = new Date(timestamp);

  const copyMessage = async () => {
    try {
      // 只在明确点击时访问 Clipboard，避免渲染阶段触发浏览器权限请求。
      await navigator.clipboard.writeText(text);
      setCopiedText(text);
    } catch {
      setCopiedText(null);
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
      <time dateTime={timestamp} title={messageDateTimeFormatter.format(messageDate)}>
        {messageTimeFormatter.format(messageDate)}
      </time>
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
      className="w-full overflow-hidden rounded-surface border border-separator-strong bg-raised shadow-control"
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

type TurnTimelineGroup =
  | Readonly<{ item: Extract<AgentItem, { type: "message" }>; type: "user" }>
  | Readonly<{ items: readonly IndexedAgentItem[]; key: string; type: "assistant" }>;

type RunningOperation = Readonly<{
  label: string;
  type: "command" | "operation";
}>;

function resolveRunningOperation(items: readonly IndexedAgentItem[]): RunningOperation | undefined {
  // 从最新的结构化 Item 反推底部状态，避免继续显示没有上下文的“正在运行”。
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
    if (item.type === "message" && item.role === "user") {
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

function TimelineItemContent({
  isLastTurnItem,
  item,
  onOpenSubagent,
  onOpenSourceFile,
  turnStatus,
}: Readonly<{
  isLastTurnItem: boolean;
  item: AgentItem;
  onOpenSubagent: (selection: SubagentSelection) => void;
  onOpenSourceFile: (reference: MessageFileReference) => void;
  turnStatus: AgentTurn["status"];
}>) {
  switch (item.type) {
    case "message": {
      const skills = item.role === "user" ? (item.skills ?? []) : [];
      return (
        <MessageContent
          className={`${item.role === "assistant" ? "w-full" : ""} ${skills.length > 0 ? "space-y-2" : ""}`}
        >
          {skills.length === 0 ? null : (
            <div className="flex flex-wrap gap-1.5" aria-label="使用的 Skills">
              {skills.map((skill) => (
                <span
                  className="inline-flex max-w-full items-center gap-1 rounded-control bg-raised px-2 py-1 text-label font-medium text-skill"
                  data-message-skill={skill.name}
                  key={skill.name}
                >
                  <Sparkles aria-hidden="true" className="size-3.5 shrink-0" />
                  <span className="truncate">${skill.name}</span>
                </span>
              ))}
            </div>
          )}
          {item.text.length === 0 ? null : (
            <MessageResponse onOpenFileReference={onOpenSourceFile}>{item.text}</MessageResponse>
          )}
        </MessageContent>
      );
    }
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
        return (
          <SubagentToolItem
            item={item}
            onOpenSubagent={onOpenSubagent}
            operation={subagentOperation}
          />
        );
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
  onOpenFileDiff,
  onOpenSubagent,
  onOpenSourceFile,
  onReviewFileChanges,
  onRollbackTurn,
  turn,
}: Readonly<{
  canRollback: boolean;
  latestSnapshotTimestamp: string;
  onOpenFileDiff: (change: AgentFileChange) => void;
  onOpenSubagent: (selection: SubagentSelection) => void;
  onOpenSourceFile: (reference: MessageFileReference) => void;
  onReviewFileChanges: (changes: readonly AgentFileChange[]) => void;
  onRollbackTurn: (turnId: string, idempotencyKey: string) => Promise<void>;
  turn: AgentTurn;
}>) {
  const timelineGroups = groupTurnTimelineItems(turn.items);
  const hasAssistantItems = timelineGroups.some((group) => group.type === "assistant");

  const renderedGroups = timelineGroups.map((group, groupIndex) => {
    if (group.type === "user") {
      const copiedText = [
        ...(group.item.skills ?? []).map((skill) => `$${skill.name}`),
        group.item.text,
      ]
        .filter((part) => part.length > 0)
        .join("\n");
      return (
        <Message from="user" key={group.item.id}>
          <TimelineItemContent
            isLastTurnItem={false}
            item={group.item}
            onOpenSubagent={onOpenSubagent}
            onOpenSourceFile={onOpenSourceFile}
            turnStatus={turn.status}
          />
          <MessageMetadata
            text={copiedText}
            timestamp={getMessageTimestamp("user", turn, latestSnapshotTimestamp)}
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
                onOpenSubagent={onOpenSubagent}
                onOpenSourceFile={onOpenSourceFile}
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

export function TaskSnapshotTimeline({
  canRollbackTurns = false,
  connected = true,
  onOpenFileDiff = () => undefined,
  onOpenSubagent = () => undefined,
  onOpenSourceFile = () => undefined,
  onReviewFileChanges = () => undefined,
  onResolvePendingRequest = () => Promise.resolve(),
  onRollbackTurn = () => Promise.resolve(),
  snapshot,
}: Readonly<{
  canRollbackTurns?: boolean;
  connected?: boolean;
  onOpenFileDiff?: (change: AgentFileChange) => void;
  onOpenSubagent?: (selection: SubagentSelection) => void;
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
    <Conversation aria-label="会话内容">
      <ConversationContent className="gap-6">
        {snapshot.turns.map((turn, turnIndex) => (
          <section
            aria-label={`Turn ${String(turnIndex + 1)}`}
            className="space-y-4"
            data-status={turn.status}
            key={turn.id}
          >
            {turn.error === null ? null : (
              <div
                className="rounded-surface bg-control px-3 py-2 text-label leading-5 text-danger"
                role="alert"
              >
                <p className="font-medium">Turn 执行失败</p>
                <p className="mt-1">{turn.error}</p>
              </div>
            )}
            <TurnTimelineItems
              canRollback={
                connected &&
                canRollbackTurns &&
                turn.status === "completed" &&
                turn.id === latestTurnId
              }
              latestSnapshotTimestamp={snapshot.updatedAt}
              onOpenFileDiff={onOpenFileDiff}
              onOpenSubagent={onOpenSubagent}
              onOpenSourceFile={onOpenSourceFile}
              onReviewFileChanges={onReviewFileChanges}
              onRollbackTurn={onRollbackTurn}
              turn={turn}
            />
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
