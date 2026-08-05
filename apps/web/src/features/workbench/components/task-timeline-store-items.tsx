import type { AgentItem, AgentTurn } from "@code-agent/protocol";
import { useStore } from "zustand";

import { i18n } from "../../../i18n/i18n.js";

import { Message, type MessageFileReference } from "../../../shared/ai-elements/message.js";
import type {
  NormalizedAgentTurn,
  TaskItemStore,
  TaskStore,
} from "../../conversation/runtime/task-store.js";

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
  | Readonly<{ itemId: string; type: "user" }>
  | Readonly<{ itemIds: readonly string[]; key: string; type: "assistant" }>;

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

export function StoredTimelineItemContentValue({
  isLastTurnItem,
  itemStore,
  onBuildPlan,
  onOpenSourceFile,
  projectId,
  taskId,
  turnStatus,
}: Readonly<{
  isLastTurnItem: boolean;
  itemStore: TaskItemStore;
  onBuildPlan?: BuildPlanAction;
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
  onOpenSourceFile,
  projectId,
  store,
  taskId,
  turnStatus,
}: Readonly<{
  isLastTurnItem: boolean;
  itemId: string;
  onBuildPlan?: BuildPlanAction;
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

export function StoredUserMessage({
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
