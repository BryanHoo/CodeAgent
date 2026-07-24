import type { AgentItem, AgentItemStatus, AgentTurn, PendingRequest } from "@code-agent/protocol";
import { Check, Copy, FilePenLine, FolderGit2 } from "lucide-react";
import { useState } from "react";

import type { RuntimeTaskSnapshot } from "../../conversation/runtime/task-runtime.js";
import type { TaskRuntimeView } from "../../conversation/runtime/use-task-runtime.js";
import { countFileChangeLines, getFileName, type AgentFileChange } from "../../diff/file-change.js";
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
  onOpenFileDiff?: (change: AgentFileChange) => void;
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
  onOpenFileDiff,
  onOpenSourceFile,
  onResolvePendingRequest,
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
      onResolvePendingRequest={onResolvePendingRequest ?? (() => Promise.resolve())}
      runtime={runtime}
    />
  );
}

function ActiveTaskTimeline({
  onOpenFileDiff,
  onOpenSourceFile,
  onResolvePendingRequest,
  runtime,
}: Readonly<{
  onResolvePendingRequest: (
    request: PendingRequest,
    resolution: PendingRequestResolution,
    idempotencyKey: string,
  ) => Promise<void>;
  onOpenFileDiff: (change: AgentFileChange) => void;
  onOpenSourceFile: (reference: MessageFileReference) => void;
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
        connected={runtime.connectionState === "connected"}
        onOpenFileDiff={onOpenFileDiff}
        onOpenSourceFile={onOpenSourceFile}
        onResolvePendingRequest={onResolvePendingRequest}
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
  onOpenFileDiff,
  onOpenSourceFile,
  turnStatus,
}: Readonly<{
  isLastTurnItem: boolean;
  item: AgentItem;
  onOpenFileDiff: (change: AgentFileChange) => void;
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
      return (
        <div className="space-y-1" data-status={item.status}>
          {item.changes.map((change, changeIndex) => (
            <FileChangeButton
              change={change}
              key={`${change.path}:${String(changeIndex)}`}
              onOpen={onOpenFileDiff}
            />
          ))}
        </div>
      );
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
  latestSnapshotTimestamp,
  onOpenFileDiff,
  onOpenSourceFile,
  turn,
}: Readonly<{
  latestSnapshotTimestamp: string;
  onOpenFileDiff: (change: AgentFileChange) => void;
  onOpenSourceFile: (reference: MessageFileReference) => void;
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
            onOpenFileDiff={onOpenFileDiff}
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
    const showCompletedFooter = turn.status !== "running" && assistantText.trim().length > 0;

    return (
      <Message from="assistant" key={group.key}>
        <div className="w-full space-y-4">
          {group.items.map(({ item, itemIndex }) => (
            <TimelineItemContent
              isLastTurnItem={itemIndex === turn.items.length - 1}
              item={item}
              key={item.id}
              onOpenFileDiff={onOpenFileDiff}
              onOpenSourceFile={onOpenSourceFile}
              turnStatus={turn.status}
            />
          ))}
        </div>
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
  connected = true,
  onOpenFileDiff = () => undefined,
  onOpenSourceFile = () => undefined,
  onResolvePendingRequest = () => Promise.resolve(),
  snapshot,
}: Readonly<{
  connected?: boolean;
  onOpenFileDiff?: (change: AgentFileChange) => void;
  onOpenSourceFile?: (reference: MessageFileReference) => void;
  onResolvePendingRequest?: (
    request: PendingRequest,
    resolution: PendingRequestResolution,
    idempotencyKey: string,
  ) => Promise<void>;
  snapshot: RuntimeTaskSnapshot;
}>) {
  if (snapshot.turns.length === 0 && snapshot.pendingRequests.length === 0) {
    return <TimelineState message="此任务暂无历史" role="status" />;
  }
  const firstPendingIndex = snapshot.pendingRequests.findIndex(
    (candidate) => candidate.status === "pending",
  );

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
              latestSnapshotTimestamp={snapshot.updatedAt}
              onOpenFileDiff={onOpenFileDiff}
              onOpenSourceFile={onOpenSourceFile}
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
