import type {
  AgentItem,
  AgentItemStatus,
  AgentTurn,
  PendingRequest,
  Project,
} from "@code-agent/protocol";
import { Check, ChevronDown, Copy, FilePenLine, Files, FolderGit2, RotateCcw } from "lucide-react";
import { Fragment, useState } from "react";

import type { RuntimeTaskSnapshot } from "../../conversation/runtime/task-runtime.js";
import type { TaskRuntimeView } from "../../conversation/runtime/use-task-runtime.js";
import {
  countFileChangeLines,
  getFileName,
  summarizeFileChanges,
  type AgentFileChange,
} from "../../diff/file-change.js";
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
  ChainOfThoughtStep,
} from "../../../shared/ai-elements/chain-of-thought.js";
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
      onOpenFileDiff={onOpenFileDiff ?? (() => undefined)}
      onOpenSourceFile={onOpenSourceFile ?? (() => undefined)}
      onReviewFileChanges={onReviewFileChanges ?? (() => undefined)}
      onResolvePendingRequest={onResolvePendingRequest ?? (() => Promise.resolve())}
      onRollbackTurn={onRollbackTurn ?? (() => Promise.resolve())}
      canRollbackTurns={canRollbackTurns}
      runtime={runtime}
      startingSnapshot={startingSnapshot}
    />
  );
}

function ActiveTaskTimeline({
  canRollbackTurns,
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
        snapshot={runtime.snapshot}
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

function extractReasoningSteps(summary: string): string[] {
  const emphasizedSteps = [...summary.matchAll(/\*\*([^*\n]+)\*\*/g)]
    .map((match) => match[1]?.trim() ?? "")
    .filter((step) => step.length > 0);

  if (emphasizedSteps.length > 0) {
    return emphasizedSteps;
  }

  return summary
    .split(/\n+/)
    .map((step) =>
      step
        .trim()
        .replace(/^#{1,6}\s+/, "")
        .replace(/^[-*+]\s+/, ""),
    )
    .filter((step) => step.length > 0);
}

type ReasoningPresentation = Readonly<{
  content: string;
  steps: readonly string[];
}>;

function getReasoningPresentation(
  item: Extract<AgentItem, { type: "reasoning" }>,
): ReasoningPresentation | null {
  const trimmedSummary = item.summary.trim();
  const trimmedContent = item.content.trim();
  if (trimmedSummary.length === 0 && trimmedContent.length === 0) {
    return null;
  }
  const steps = extractReasoningSteps(trimmedSummary.length > 0 ? trimmedSummary : trimmedContent);
  const contentRepeatsSummary =
    trimmedContent.length > 0 &&
    extractReasoningSteps(trimmedContent).join("\n") === steps.join("\n");
  const content =
    trimmedSummary.length > 0 && trimmedContent.length > 0 && !contentRepeatsSummary
      ? trimmedContent
      : "";
  return { content, steps };
}

function renderReasoningSteps(
  itemId: string,
  presentation: ReasoningPresentation,
  isActive: boolean,
) {
  return presentation.steps.map((step, stepIndex) => {
    const isLastStep = stepIndex === presentation.steps.length - 1;
    return (
      <ChainOfThoughtStep
        {...(isLastStep && presentation.content.length > 0
          ? { description: presentation.content }
          : {})}
        key={`${itemId}:${String(stepIndex)}`}
        label={step}
        status={isActive && isLastStep ? "active" : "complete"}
      />
    );
  });
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

type ThoughtAgentItem = Extract<AgentItem, { type: "command" | "reasoning" | "tool" }>;

type AssistantTimelineSegment =
  | Readonly<{ item: IndexedAgentItem; type: "item" }>
  | Readonly<{ items: readonly IndexedAgentItem[]; key: string; type: "thought" }>;

type TurnTimelineGroup =
  | Readonly<{ item: Extract<AgentItem, { type: "message" }>; type: "user" }>
  | Readonly<{ items: readonly IndexedAgentItem[]; key: string; type: "assistant" }>;

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

function isThoughtAgentItem(item: AgentItem): item is ThoughtAgentItem {
  return item.type === "reasoning" || item.type === "command" || item.type === "tool";
}

function groupAssistantTimelineItems(
  items: readonly IndexedAgentItem[],
): AssistantTimelineSegment[] {
  const segments: AssistantTimelineSegment[] = [];
  let thoughtItems: IndexedAgentItem[] = [];

  const flushThoughtItems = () => {
    const firstItem = thoughtItems[0];
    if (firstItem === undefined) {
      return;
    }
    const hasVisibleReasoning = thoughtItems.some(
      ({ item }) => item.type === "reasoning" && getReasoningPresentation(item) !== null,
    );
    if (hasVisibleReasoning) {
      segments.push({ items: thoughtItems, key: firstItem.item.id, type: "thought" });
    } else {
      segments.push(...thoughtItems.map((item) => ({ item, type: "item" }) as const));
    }
    thoughtItems = [];
  };

  items.forEach((indexedItem) => {
    if (isThoughtAgentItem(indexedItem.item)) {
      thoughtItems.push(indexedItem);
      return;
    }
    // 普通消息等可见内容会切断思考；后续 reasoning 从新的思考块开始。
    flushThoughtItems();
    segments.push({ item: indexedItem, type: "item" });
  });
  flushThoughtItems();

  return segments;
}

function TimelineItemContent({
  isLastTurnItem,
  item,
  onOpenSourceFile,
  turnStatus,
}: Readonly<{
  isLastTurnItem: boolean;
  item: AgentItem;
  onOpenSourceFile: (reference: MessageFileReference) => void;
  turnStatus: AgentTurn["status"];
}>) {
  switch (item.type) {
    case "message":
      return (
        <MessageContent className={item.role === "assistant" ? "w-full" : ""}>
          <MessageResponse onOpenFileReference={onOpenSourceFile}>{item.text}</MessageResponse>
        </MessageContent>
      );
    case "reasoning": {
      const presentation = getReasoningPresentation(item);
      if (presentation === null) {
        // 部分模型会发出空 reasoning 占位，不向用户展示无内容的思考组件。
        return null;
      }
      const isStreamingReasoning = turnStatus === "running" && isLastTurnItem;

      return (
        <ChainOfThought defaultOpen={isStreamingReasoning}>
          <ChainOfThoughtHeader>
            {isStreamingReasoning ? "正在思考" : "思考过程"}
          </ChainOfThoughtHeader>
          <ChainOfThoughtContent>
            {renderReasoningSteps(item.id, presentation, isStreamingReasoning)}
          </ChainOfThoughtContent>
        </ChainOfThought>
      );
    }
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

function ThoughtTimelineSegment({
  isActive,
  items,
  onOpenSourceFile,
  turn,
}: Readonly<{
  isActive: boolean;
  items: readonly IndexedAgentItem[];
  onOpenSourceFile: (reference: MessageFileReference) => void;
  turn: AgentTurn;
}>) {
  let lastReasoningItemId: string | null = null;
  for (const { item } of items) {
    if (item.type === "reasoning" && getReasoningPresentation(item) !== null) {
      lastReasoningItemId = item.id;
    }
  }

  return (
    <ChainOfThought defaultOpen={isActive}>
      <ChainOfThoughtHeader>{isActive ? "正在思考" : "思考过程"}</ChainOfThoughtHeader>
      <ChainOfThoughtContent>
        {items.map(({ item, itemIndex }) => {
          if (item.type !== "reasoning") {
            return (
              <TimelineItemContent
                isLastTurnItem={itemIndex === turn.items.length - 1}
                item={item}
                key={item.id}
                onOpenSourceFile={onOpenSourceFile}
                turnStatus={turn.status}
              />
            );
          }
          const presentation = getReasoningPresentation(item);
          if (presentation === null) {
            return null;
          }
          return (
            <Fragment key={item.id}>
              {renderReasoningSteps(
                item.id,
                presentation,
                isActive && item.id === lastReasoningItemId,
              )}
            </Fragment>
          );
        })}
      </ChainOfThoughtContent>
    </ChainOfThought>
  );
}

function TurnTimelineItems({
  canRollback,
  latestSnapshotTimestamp,
  onOpenFileDiff,
  onOpenSourceFile,
  onReviewFileChanges,
  onRollbackTurn,
  turn,
}: Readonly<{
  canRollback: boolean;
  latestSnapshotTimestamp: string;
  onOpenFileDiff: (change: AgentFileChange) => void;
  onOpenSourceFile: (reference: MessageFileReference) => void;
  onReviewFileChanges: (changes: readonly AgentFileChange[]) => void;
  onRollbackTurn: (turnId: string, idempotencyKey: string) => Promise<void>;
  turn: AgentTurn;
}>) {
  const timelineGroups = groupTurnTimelineItems(turn.items);
  const hasAssistantItems = timelineGroups.some((group) => group.type === "assistant");

  const renderedGroups = timelineGroups.map((group, groupIndex) => {
    if (group.type === "user") {
      return (
        <Message from="user" key={group.item.id}>
          <TimelineItemContent
            isLastTurnItem={false}
            item={group.item}
            onOpenSourceFile={onOpenSourceFile}
            turnStatus={turn.status}
          />
          <MessageMetadata
            text={group.item.text}
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
    const assistantSegments = groupAssistantTimelineItems(group.items);
    const lastVisibleItem = group.items.findLast(
      ({ item }) =>
        item.type !== "file_change" &&
        (item.type !== "reasoning" || getReasoningPresentation(item) !== null),
    );

    return (
      <Message from="assistant" key={group.key}>
        <div className="w-full space-y-4">
          {assistantSegments.map((segment) => {
            if (segment.type === "thought") {
              return (
                <ThoughtTimelineSegment
                  isActive={
                    turn.status === "running" &&
                    segment.items.some(({ item }) => item.id === lastVisibleItem?.item.id)
                  }
                  items={segment.items}
                  key={segment.key}
                  onOpenSourceFile={onOpenSourceFile}
                  turn={turn}
                />
              );
            }
            const { item, itemIndex } = segment.item;
            return (
              <TimelineItemContent
                isLastTurnItem={itemIndex === turn.items.length - 1}
                item={item}
                key={item.id}
                onOpenSourceFile={onOpenSourceFile}
                turnStatus={turn.status}
              />
            );
          })}
          {showRunningShimmer ? (
            <Shimmer aria-label="AI 回复正在运行" as="p" className="text-body-small" role="status">
              正在运行
            </Shimmer>
          ) : null}
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
          <Shimmer aria-label="AI 回复正在运行" as="p" className="text-body-small" role="status">
            正在运行
          </Shimmer>
        </Message>
      ) : null}
    </>
  );
}

export function TaskSnapshotTimeline({
  canRollbackTurns = false,
  connected = true,
  onOpenFileDiff = () => undefined,
  onOpenSourceFile = () => undefined,
  onReviewFileChanges = () => undefined,
  onResolvePendingRequest = () => Promise.resolve(),
  onRollbackTurn = () => Promise.resolve(),
  snapshot,
}: Readonly<{
  canRollbackTurns?: boolean;
  connected?: boolean;
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
  if (snapshot.turns.length === 0 && snapshot.pendingRequests.length === 0) {
    return <TimelineState message="此任务暂无历史" role="status" />;
  }
  const firstPendingIndex = snapshot.pendingRequests.findIndex(
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
              onOpenSourceFile={onOpenSourceFile}
              onReviewFileChanges={onReviewFileChanges}
              onRollbackTurn={onRollbackTurn}
              turn={turn}
            />
          </section>
        ))}
        {snapshot.pendingRequests.map((request, index) => {
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
