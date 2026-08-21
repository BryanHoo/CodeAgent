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
  type RunningOperation,
} from "./task-timeline-running.js";
import { MessageMetadata, getMessageTimestamp } from "./task-timeline-status.js";

export type StoredTurnTimelineGroup =
  | Readonly<{ itemKey: string; type: "user" }>
  | Readonly<{ itemKeys: readonly string[]; key: string; type: "assistant" }>;

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
  itemKeys,
  store,
}: Readonly<{ diff: string; itemKeys: readonly string[]; store: TaskStore }>) {
  const latestFileChangeStore = useStore(store, (state) => {
    // 实时事件会原位更新 Item Store；选择最新文件操作并单独订阅，避免整段 Timeline 重渲染。
    for (let index = itemKeys.length - 1; index >= 0; index -= 1) {
      const itemStore = state.itemStoresByKey.get(itemKeys[index] ?? "");
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
  itemKeys: readonly string[],
  itemStoresByKey: ReadonlyMap<string, TaskItemStore>,
): StoredTurnTimelineGroup[] {
  const groups: StoredTurnTimelineGroup[] = [];
  let assistantItemKeys: string[] = [];

  const flushAssistantItems = () => {
    const firstAssistantItemKey = assistantItemKeys[0];
    if (firstAssistantItemKey === undefined) {
      return;
    }
    groups.push({ itemKeys: assistantItemKeys, key: firstAssistantItemKey, type: "assistant" });
    assistantItemKeys = [];
  };

  for (const itemKey of itemKeys) {
    const item = itemStoresByKey.get(itemKey)?.peek();
    if (item?.type === "review" || (item?.type === "message" && item.role === "user")) {
      flushAssistantItems();
      groups.push({ itemKey, type: "user" });
      continue;
    }
    assistantItemKeys.push(itemKey);
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
  useStore(itemStore, (state) => state.revision);
  const baseItem = itemStore.peek();
  const item = baseItem.type === "command" ? baseItem : itemStore.read();
  const commandOutput = baseItem.type === "command" ? itemStore.readCommandOutput() : undefined;
  return (
    <TimelineItemContent
      {...(commandOutput === undefined ? {} : { commandOutput })}
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
  itemKey,
  onBuildPlan,
  onOpenFileDiff,
  onOpenSourceFile,
  projectId,
  store,
  taskId,
  turnStatus,
}: Readonly<{
  isLastTurnItem: boolean;
  itemKey: string;
  onBuildPlan?: BuildPlanAction;
  onOpenFileDiff: (change: AgentFileChange) => void;
  onOpenSourceFile: (reference: MessageFileReference) => void;
  projectId: string;
  store: TaskStore;
  taskId: string;
  turnStatus: AgentTurn["status"];
}>) {
  const itemStore = useStore(store, (state) => state.itemStoresByKey.get(itemKey));
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
  itemKey,
  latestSnapshotTimestamp,
  onOpenFileDiff,
  onOpenSourceFile,
  projectId,
  store,
  taskId,
  turn,
}: Readonly<{
  itemKey: string;
  latestSnapshotTimestamp: string;
  onOpenFileDiff: (change: AgentFileChange) => void;
  onOpenSourceFile: (reference: MessageFileReference) => void;
  projectId: string;
  store: TaskStore;
  taskId: string;
  turn: NormalizedAgentTurn;
}>) {
  const itemStore = useStore(store, (state) => state.itemStoresByKey.get(itemKey));
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
  itemKeys,
  store,
}: Readonly<{ itemKeys: readonly string[]; store: TaskStore }>) {
  const operationKey = useStore(store, (state) => {
    const indexedItems = itemKeys.flatMap((itemKey, itemIndex) => {
      const item = state.itemStoresByKey.get(itemKey)?.peek();
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
