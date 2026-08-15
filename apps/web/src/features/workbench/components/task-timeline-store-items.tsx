import type { AgentItem, AgentTurn } from "@code-agent/protocol";
import { useStore } from "zustand";

import { i18n } from "../../../i18n/i18n.js";

import { Message, type MessageFileReference } from "../../../shared/components/agent/message.js";
import { Task, TaskContent, TaskItem, TaskTrigger } from "../../../shared/components/agent/task.js";
import type {
  NormalizedAgentTurn,
  TaskItemStore,
  TaskStore,
} from "../../conversation/runtime/task-store.js";
import {
  countFileChangeLines,
  getFileName,
  summarizeFileChanges,
  type AgentFileChange,
} from "../../diff/file-change.js";

import { TimelineItemContent } from "./task-timeline-items.js";
import type { BuildPlanAction } from "./task-timeline-contracts.js";
import {
  RunningReplyStatus,
  getReviewMessageText,
  resolveRunningOperation,
  shouldRenderTimelineItem,
  type RunningOperation,
} from "./task-timeline-running.js";
import { MessageMetadata, getMessageTimestamp } from "./task-timeline-status.js";

export type StoredTurnTimelineGroup =
  | Readonly<{ itemId: string; type: "user" }>
  | Readonly<{ itemIds: readonly string[]; key: string; type: "assistant" }>;

export function LiveFileChanges({
  changes,
  diff,
}: Readonly<{ changes: readonly AgentFileChange[]; diff: string }>) {
  const currentChange = summarizeFileChanges(changes).changes.at(-1);
  const statistics = currentChange === undefined ? undefined : countFileChangeLines(currentChange);
  const title =
    currentChange === undefined
      ? i18n.t("timeline.liveDiff", { ns: "conversation" })
      : getFileName(currentChange.path);
  const accessibleLabel =
    statistics === undefined
      ? title
      : i18n.t("timeline.liveFileChange", {
          additions: statistics.additions,
          name: title,
          ns: "conversation",
          removals: statistics.removals,
        });

  return (
    <Task defaultOpen={false} status="in_progress">
      <TaskTrigger
        aria-label={accessibleLabel}
        suffix={
          statistics === undefined ? null : (
            <span className="flex shrink-0 items-center gap-2" aria-hidden="true">
              <span className="text-diff-added">+{statistics.additions}</span>
              <span className="text-diff-removed">-{statistics.removals}</span>
            </span>
          )
        }
        title={title}
      />
      <TaskContent>
        <TaskItem className="max-h-64 overflow-auto whitespace-pre font-mono">{diff}</TaskItem>
      </TaskContent>
    </Task>
  );
}

function StoredLiveFileChangesValue({
  diff,
  itemStore,
}: Readonly<{ diff: string; itemStore: TaskItemStore }>) {
  const item = useTaskItem(itemStore);
  if (item.type !== "file_change" || (item.status !== "pending" && item.status !== "running")) {
    return null;
  }
  return <LiveFileChanges changes={item.changes} diff={diff} />;
}

export function StoredLiveFileChanges({
  diff,
  itemIds,
  store,
}: Readonly<{ diff: string; itemIds: readonly string[]; store: TaskStore }>) {
  const latestFileChangeStore = useStore(store, (state) => {
    // 实时事件会原位更新 Item Store；选择最新文件操作并单独订阅，避免整段 Timeline 重渲染。
    for (let index = itemIds.length - 1; index >= 0; index -= 1) {
      const itemStore = state.itemStoresById.get(itemIds[index] ?? "");
      if (itemStore?.peek().type === "file_change") {
        return itemStore;
      }
    }
    return undefined;
  });

  return latestFileChangeStore === undefined ? (
    <LiveFileChanges changes={[]} diff={diff} />
  ) : (
    <StoredLiveFileChangesValue diff={diff} itemStore={latestFileChangeStore} />
  );
}

export function groupStoredTurnTimelineItems(
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
    if (item !== undefined && !shouldRenderTimelineItem(item)) {
      continue;
    }
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

export function useTaskItem(itemStore: TaskItemStore): AgentItem {
  useStore(itemStore, (state) => state.revision);
  return itemStore.read();
}

export function getUserMessageCopyText(item: Extract<AgentItem, { type: "message" }>): string {
  // 附件只用于消息展示，复制时仅保留可编辑的 Skill 引用与用户正文。
  return [...(item.skills ?? []).map((skill) => `$${skill.name}`), item.text]
    .filter((part) => part.length > 0)
    .join("\n");
}

export function StoredTimelineItemContentValue({
  isLastTurnItem,
  itemStore,
  onBuildPlan,
  onOpenFileDiff,
  onOpenSourceFile,
  projectId,
  taskId,
  turnStatus,
}: Readonly<{
  isLastTurnItem: boolean;
  itemStore: TaskItemStore;
  onBuildPlan?: BuildPlanAction;
  onOpenFileDiff: (change: AgentFileChange) => void;
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
      {...(onBuildPlan === undefined ? {} : { onBuildPlan })}
      onOpenFileDiff={onOpenFileDiff}
      onOpenSourceFile={onOpenSourceFile}
      projectId={projectId}
      taskId={taskId}
      turnStatus={turnStatus}
    />
  );
}

export function StoredTimelineItemContent({
  isLastTurnItem,
  itemId,
  onBuildPlan,
  onOpenFileDiff,
  onOpenSourceFile,
  projectId,
  store,
  taskId,
  turnStatus,
}: Readonly<{
  isLastTurnItem: boolean;
  itemId: string;
  onBuildPlan?: BuildPlanAction;
  onOpenFileDiff: (change: AgentFileChange) => void;
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
      {...(onBuildPlan === undefined ? {} : { onBuildPlan })}
      onOpenFileDiff={onOpenFileDiff}
      onOpenSourceFile={onOpenSourceFile}
      projectId={projectId}
      taskId={taskId}
      turnStatus={turnStatus}
    />
  );
}

export function StoredUserMessageValue({
  itemStore,
  latestSnapshotTimestamp,
  onOpenFileDiff,
  onOpenSourceFile,
  projectId,
  taskId,
  turn,
}: Readonly<{
  itemStore: TaskItemStore;
  latestSnapshotTimestamp: string;
  onOpenFileDiff: (change: AgentFileChange) => void;
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
    item.type === "review" ? getReviewMessageText(item) : getUserMessageCopyText(item);

  return (
    <Message from="user">
      <TimelineItemContent
        isLastTurnItem={false}
        item={item}
        onOpenFileDiff={onOpenFileDiff}
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

export function StoredUserMessage({
  itemId,
  latestSnapshotTimestamp,
  onOpenFileDiff,
  onOpenSourceFile,
  projectId,
  store,
  taskId,
  turn,
}: Readonly<{
  itemId: string;
  latestSnapshotTimestamp: string;
  onOpenFileDiff: (change: AgentFileChange) => void;
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
      onOpenFileDiff={onOpenFileDiff}
      onOpenSourceFile={onOpenSourceFile}
      projectId={projectId}
      taskId={taskId}
      turn={turn}
    />
  );
}

export function StoredRunningReplyStatus({
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
