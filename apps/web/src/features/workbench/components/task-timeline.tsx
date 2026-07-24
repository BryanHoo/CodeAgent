import type { AgentItem, AgentItemStatus, AgentTurn, PendingRequest } from "@code-agent/protocol";
import { Check, Copy, FilePenLine, Files, FolderGit2, RotateCcw } from "lucide-react";
import { useState } from "react";

import type { RuntimeTaskSnapshot } from "../../conversation/runtime/task-runtime.js";
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
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "../../../shared/ai-elements/reasoning.js";
import {
  Tool,
  ToolContent,
  ToolHeader,
  type ToolStatus,
} from "../../../shared/ai-elements/tool.js";
import { PendingRequestCard, type PendingRequestResolution } from "./pending-request.js";

type TaskTimelineProps = Readonly<{
  canRollbackTurns?: boolean;
  onOpenFileDiff?: (change: AgentFileChange) => void;
  onReviewFileChanges?: (changes: readonly AgentFileChange[]) => void;
  onRollbackTurn?: (turnId: string, idempotencyKey: string) => Promise<void>;
  onOpenSourceFile?: (reference: MessageFileReference) => void;
  projectName: string;
  onResolvePendingRequest?: (
    request: PendingRequest,
    resolution: PendingRequestResolution,
    idempotencyKey: string,
  ) => Promise<void>;
  runtime?: TaskRuntimeView;
  taskId?: string;
}>;

function EmptyTimeline({ projectName }: Readonly<{ projectName: string }>) {
  return (
    <section className="grid min-h-0 flex-1 place-items-center px-6" aria-label="会话内容">
      <div className="max-w-sm text-center">
        <FolderGit2 className="mx-auto size-9 text-muted-foreground" strokeWidth={1.4} />
        <h2 className="mt-4 text-base font-semibold text-foreground">{projectName}</h2>
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

export function TaskTimeline({
  canRollbackTurns = false,
  onOpenFileDiff,
  onOpenSourceFile,
  onReviewFileChanges,
  onResolvePendingRequest,
  onRollbackTurn,
  projectName,
  runtime,
  taskId,
}: TaskTimelineProps) {
  if (taskId === undefined) {
    return <EmptyTimeline projectName={projectName} />;
  }
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
}>) {
  if (runtime.error !== null) {
    return <TimelineState message="无法加载任务历史" role="alert" />;
  }
  if (runtime.isPending || runtime.snapshot === undefined) {
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

function toToolStatus(status: AgentItemStatus): ToolStatus {
  if (status === "pending" || status === "running") {
    return "running";
  }
  if (status === "failed" || status === "declined" || status === "interrupted") {
    return "failed";
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
      const reasoningSteps = extractReasoningSteps(item.summary);
      const reasoningTitle = reasoningSteps.at(-1) ?? "推理";
      const trimmedReasoningContent = item.content.trim();
      const contentRepeatsSummary =
        trimmedReasoningContent.length > 0 &&
        extractReasoningSteps(trimmedReasoningContent).join("\n") === reasoningSteps.join("\n");
      const reasoningContent =
        trimmedReasoningContent.length > 0 && !contentRepeatsSummary
          ? trimmedReasoningContent
          : reasoningSteps.length > 1
            ? item.summary
            : "";
      const isStreamingReasoning = turnStatus === "running" && isLastTurnItem;
      const hasReasoningContent = reasoningContent.length > 0;

      return (
        <Reasoning collapsible={hasReasoningContent} isStreaming={isStreamingReasoning}>
          <ReasoningTrigger expandable={hasReasoningContent}>{reasoningTitle}</ReasoningTrigger>
          <ReasoningContent>{reasoningContent}</ReasoningContent>
        </Reasoning>
      );
    }
    case "command":
      return (
        <Tool>
          <ToolHeader status={toToolStatus(item.status)}>{item.command}</ToolHeader>
          <ToolContent>
            <pre className="whitespace-pre-wrap">{item.output ?? item.cwd}</pre>
            {item.outputTruncated ? (
              <p className="mt-2 text-warning">输出已截断，仅显示最新内容。</p>
            ) : null}
          </ToolContent>
        </Tool>
      );
    case "file_change":
      // 文件变更统一在回复末尾聚合，避免工具流中重复展示同一组文件。
      return null;
    case "tool":
      return (
        <Tool>
          <ToolHeader status={toToolStatus(item.status)}>{item.name}</ToolHeader>
          <ToolContent>
            <pre className="whitespace-pre-wrap">
              {[item.input, item.output]
                .filter((value) => value !== undefined)
                .map(formatStructuredValue)
                .join("\n")}
            </pre>
          </ToolContent>
        </Tool>
      );
    case "plan":
      return (
        <Tool defaultOpen>
          <ToolHeader status="completed">计划</ToolHeader>
          <ToolContent>
            <pre className="whitespace-pre-wrap">{item.text}</pre>
          </ToolContent>
        </Tool>
      );
    case "activity":
      return (
        <Tool>
          <ToolHeader status={toToolStatus(item.status ?? "completed")}>{item.label}</ToolHeader>
          {item.detail === undefined ? null : <ToolContent>{item.detail}</ToolContent>}
        </Tool>
      );
  }
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

  return timelineGroups.map((group) => {
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

    return (
      <Message from="assistant" key={group.key}>
        <div className="w-full space-y-4">
          {group.items.map(({ item, itemIndex }) => (
            <TimelineItemContent
              isLastTurnItem={itemIndex === turn.items.length - 1}
              item={item}
              key={item.id}
              onOpenSourceFile={onOpenSourceFile}
              turnStatus={turn.status}
            />
          ))}
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
