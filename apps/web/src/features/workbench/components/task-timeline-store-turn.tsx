import type { AgentItem } from "@code-agent/protocol";
import { useMemo, useState } from "react";
import { useStore } from "zustand";

import { i18n } from "../../../i18n/i18n.js";
import { Message, type MessageFileReference } from "../../../shared/components/agent/message.js";
import type { NormalizedAgentTurn, TaskStore } from "../../conversation/runtime/task-store.js";
import type { AgentFileChange } from "../../diff/file-change.js";
import type { BuildPlanAction, ForkTaskAction } from "./task-timeline-contracts.js";
import { ChangedFilesCard } from "./task-timeline-file-changes.js";
import { resolveCompletedTurnProcess, type CompletedTurnProcess } from "./task-timeline-process.js";
import { RunningReplyStatus } from "./task-timeline-running.js";
import {
  StoredLiveFileChanges as LiveFileChanges,
  StoredRunningReplyStatus,
  StoredTimelineItemContent,
  StoredUserMessage,
  groupStoredTurnTimelineItems,
} from "./task-timeline-store-items.js";
import {
  MessageMetadata,
  TurnProcessingTime,
  getMessageTimestamp,
} from "./task-timeline-status.js";

function formatProcessCount(value: number): string {
  return value.toLocaleString(i18n.resolvedLanguage ?? "zh-CN");
}

function formatCompletedTurnProcessSummary(process: CompletedTurnProcess): string | undefined {
  const parts: string[] = [];
  if (process.completedOperationCount > 0) {
    parts.push(
      i18n.t("timeline.completedOperations", {
        count: formatProcessCount(process.completedOperationCount),
        ns: "conversation",
      }),
    );
  }
  if (process.failedOperationCount > 0) {
    parts.push(
      i18n.t("timeline.failedOperations", {
        count: formatProcessCount(process.failedOperationCount),
        ns: "conversation",
      }),
    );
  }
  if (process.fileCount > 0) {
    parts.push(
      i18n.t("timeline.processFiles", {
        count: formatProcessCount(process.fileCount),
        ns: "conversation",
      }),
    );
  }
  return parts.length === 0 ? undefined : parts.join(" · ");
}

function StoredAssistantGroup({
  itemIds,
  lastTurnItemId,
  latestSnapshotTimestamp,
  liveFileChangesDiff,
  onOpenFileDiff,
  onForkTask,
  onBuildPlan,
  onOpenSourceFile,
  onReviewFileChanges,
  onToggleProcess,
  processExpanded,
  processHiddenItemIds,
  processRecentOperationItemIds,
  processSummary,
  processToggleAvailable,
  projectId,
  showProcessingTime,
  showRunningShimmer,
  store,
  taskId,
  turn,
}: Readonly<{
  itemIds: readonly string[];
  lastTurnItemId: string | undefined;
  latestSnapshotTimestamp: string;
  liveFileChangesDiff?: string;
  onOpenFileDiff: (change: AgentFileChange) => void;
  onForkTask?: ForkTaskAction;
  onBuildPlan?: BuildPlanAction;
  onOpenSourceFile: (reference: MessageFileReference) => void;
  onReviewFileChanges: (changes: readonly AgentFileChange[]) => void;
  onToggleProcess: () => void;
  processExpanded: boolean;
  processHiddenItemIds: ReadonlySet<string>;
  processRecentOperationItemIds: ReadonlySet<string>;
  processSummary: string | undefined;
  processToggleAvailable: boolean;
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
  const visibleItemIds =
    turn.status === "running" || processExpanded
      ? itemIds
      : itemIds.filter(
          (itemId) =>
            !processHiddenItemIds.has(itemId) || processRecentOperationItemIds.has(itemId),
        );
  if (turn.status !== "running") {
    // 复制文本与文件汇总继续消费完整 Store 数据，不受当前折叠展示影响。
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
        <TurnProcessingTime
          completedAt={turn.completedAt}
          startedAt={turn.startedAt}
          {...(processToggleAvailable
            ? { expanded: processExpanded, onToggle: onToggleProcess }
            : {})}
          summary={processSummary}
        />
      ) : null}
      {visibleItemIds.length > 0 || liveFileChangesDiff !== undefined || showRunningShimmer ? (
        <div className="w-full space-y-4">
          {visibleItemIds.map((itemId) => (
            <StoredTimelineItemContent
              isLastTurnItem={itemId === lastTurnItemId}
              itemId={itemId}
              key={itemId}
              {...(onBuildPlan === undefined ? {} : { onBuildPlan })}
              onOpenFileDiff={onOpenFileDiff}
              onOpenSourceFile={onOpenSourceFile}
              projectId={projectId}
              store={store}
              taskId={taskId}
              turnStatus={turn.status}
            />
          ))}
          {/* Turn 级 Diff 必须先于持续运行状态，确保 Shimmer 始终是回复最后一行。 */}
          {liveFileChangesDiff === undefined ? null : (
            <LiveFileChanges diff={liveFileChangesDiff} itemIds={itemIds} store={store} />
          )}
          {showRunningShimmer ? <StoredRunningReplyStatus itemIds={itemIds} store={store} /> : null}
        </div>
      ) : null}
      {turn.status !== "running" && responseFileChanges.length > 0 ? (
        <ChangedFilesCard
          changes={responseFileChanges}
          onOpenFileDiff={onOpenFileDiff}
          onReviewFileChanges={onReviewFileChanges}
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

export function StoreTurnTimelineSection({
  onBuildPlan,
  onForkTask,
  onOpenFileDiff,
  onOpenSourceFile,
  onReviewFileChanges,
  projectId,
  store,
  taskId,
  turnId,
  turnIndex,
  suppressEmptyRunningStatus,
}: Readonly<{
  onBuildPlan?: BuildPlanAction;
  onForkTask?: ForkTaskAction;
  onOpenFileDiff: (change: AgentFileChange) => void;
  onOpenSourceFile: (reference: MessageFileReference) => void;
  onReviewFileChanges: (changes: readonly AgentFileChange[]) => void;
  projectId: string;
  store: TaskStore;
  taskId: string;
  turnId: string;
  turnIndex: number;
  suppressEmptyRunningStatus: boolean;
}>) {
  const turn = useStore(store, (state) => state.turnsById[turnId]);
  const itemIds = useStore(store, (state) => state.itemIdsByTurnId[turnId] ?? []);
  const turnDiff = useStore(store, (state) => state.turnDiffsById[turnId]);
  const itemStoresById = store.getState().itemStoresById;
  const [processExpanded, setProcessExpanded] = useState(false);

  const process = useMemo(() => {
    if (turn === undefined || turn.status === "running") {
      return resolveCompletedTurnProcess([], "running");
    }
    const items: AgentItem[] = [];
    for (const itemId of itemIds) {
      const item = store.getState().itemStoresById.get(itemId)?.peek();
      if (item !== undefined) items.push(item);
    }
    return resolveCompletedTurnProcess(items, turn.status);
  }, [itemIds, store, turn]);
  const processHiddenItemIds = useMemo(
    () => new Set(process.hiddenItemIds),
    [process.hiddenItemIds],
  );
  const processRecentOperationItemIds = useMemo(
    () => new Set(process.recentOperationItemIds),
    [process.recentOperationItemIds],
  );
  if (turn === undefined) return null;

  const latestSnapshotTimestamp = store.getState().snapshotMetadata?.updatedAt ?? "";
  const timelineGroups = groupStoredTurnTimelineItems(itemIds, itemStoresById);
  const processSummary = formatCompletedTurnProcessSummary(process);
  const processToggleAvailable = process.hiddenItemIds.length > 0;
  const firstAssistantGroupIndex = timelineGroups.findIndex((group) => group.type === "assistant");
  const hasAssistantItems = firstAssistantGroupIndex >= 0;
  const latestAssistantGroupIndex = timelineGroups.findLastIndex(
    (group) => group.type === "assistant",
  );
  const lastTurnItemId = itemIds.at(-1);
  const liveDiff = turn.status === "running" && turnDiff?.trim() ? turnDiff : undefined;

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
            onOpenFileDiff={onOpenFileDiff}
            onOpenSourceFile={onOpenSourceFile}
            projectId={projectId}
            store={store}
            taskId={taskId}
            turn={turn}
          />
        ) : (
          <StoredAssistantGroup
            itemIds={group.itemIds}
            key={group.key}
            lastTurnItemId={lastTurnItemId}
            latestSnapshotTimestamp={latestSnapshotTimestamp}
            {...(groupIndex === latestAssistantGroupIndex && liveDiff !== undefined
              ? { liveFileChangesDiff: liveDiff }
              : {})}
            {...(turn.status === "completed" && onBuildPlan !== undefined ? { onBuildPlan } : {})}
            onOpenFileDiff={onOpenFileDiff}
            onToggleProcess={() => {
              setProcessExpanded((expanded) => !expanded);
            }}
            {...(turn.status === "completed" &&
            groupIndex === latestAssistantGroupIndex &&
            onForkTask !== undefined
              ? { onForkTask }
              : {})}
            onOpenSourceFile={onOpenSourceFile}
            onReviewFileChanges={onReviewFileChanges}
            processExpanded={processExpanded}
            processHiddenItemIds={processHiddenItemIds}
            processRecentOperationItemIds={processRecentOperationItemIds}
            processSummary={processSummary}
            processToggleAvailable={processToggleAvailable}
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
      {turn.status === "running" && !hasAssistantItems && !suppressEmptyRunningStatus ? (
        <Message from="assistant">
          <TurnProcessingTime completedAt={turn.completedAt} startedAt={turn.startedAt} />
          <div className="w-full space-y-4">
            {liveDiff === undefined ? null : (
              <LiveFileChanges diff={liveDiff} itemIds={itemIds} store={store} />
            )}
            <RunningReplyStatus />
          </div>
        </Message>
      ) : null}
      {!hasAssistantItems && suppressEmptyRunningStatus && liveDiff !== undefined ? (
        <LiveFileChanges diff={liveDiff} itemIds={itemIds} store={store} />
      ) : null}
      {turn.error === null ? null : (
        <div
          className="rounded-surface bg-control px-3 py-2 text-label leading-5 text-danger"
          role="alert"
        >
          <p>{turn.error}</p>
        </div>
      )}
    </section>
  );
}
