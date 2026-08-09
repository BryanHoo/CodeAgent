import type { AgentItem, AgentTurn, PendingRequest } from "@code-agent/protocol";
import { AlertTriangle, Info } from "lucide-react";
import { useState } from "react";
import { useStore } from "zustand";

import { i18n } from "../../../i18n/i18n.js";

import {
  Conversation,
  ConversationScrollButton,
  ConversationVirtualList,
} from "../../../shared/components/agent/conversation.js";
import { Message, type MessageFileReference } from "../../../shared/components/agent/message.js";
import type {
  NormalizedAgentTurn,
  TaskNotice,
  TaskStore,
} from "../../conversation/runtime/task-store.js";
import type { AgentFileChange } from "../../diff/file-change.js";
import { PendingRequestCard, type PendingRequestResolution } from "./pending-request.js";

import type { BuildPlanAction, ForkTaskAction } from "./task-timeline-contracts.js";
import { ChangedFilesCard } from "./task-timeline-file-changes.js";
import { RunningReplyStatus } from "./task-timeline-running.js";
import {
  LiveFileChanges,
  StoredRunningReplyStatus,
  StoredTimelineItemContent,
  StoredUserMessage,
  groupStoredTurnTimelineItems,
} from "./task-timeline-store-items.js";
import {
  MessageMetadata,
  TimelineState,
  TurnProcessingTime,
  getMessageTimestamp,
} from "./task-timeline-status.js";

const getTurnIdKey = (turnId: string) => turnId;

export function resolveCompletedTurnProcessItemIds(
  items: readonly AgentItem[],
  turnStatus: AgentTurn["status"],
): string[] {
  if (turnStatus === "running") {
    return [];
  }
  const finalAnswerIndex = items.findLastIndex(
    (item) => item.type === "message" && item.role === "assistant" && item.phase === "final_answer",
  );
  if (finalAnswerIndex < 0) {
    return [];
  }

  return items.slice(0, finalAnswerIndex).flatMap((item) => {
    if (item.type === "message") {
      return item.role === "assistant" && item.phase === "commentary" ? [item.id] : [];
    }
    // Reasoning 摘要与运行操作都属于可折叠过程；File Change 继续由最终摘要统一展示。
    return item.type === "file_change" || item.type === "review" ? [] : [item.id];
  });
}

export function StoredAssistantGroup({
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
  processItemIds,
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
  processItemIds: ReadonlySet<string>;
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
      : itemIds.filter((itemId) => !processItemIds.has(itemId));
  if (turn.status !== "running") {
    for (const itemId of visibleItemIds) {
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
            <LiveFileChanges diff={liveFileChangesDiff} />
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
  const [processExpanded, setProcessExpanded] = useState(false);
  if (turn === undefined) {
    return null;
  }
  const latestSnapshotTimestamp = store.getState().snapshotMetadata?.updatedAt ?? "";
  const itemStoresById = store.getState().itemStoresById;
  const timelineGroups = groupStoredTurnTimelineItems(itemIds, itemStoresById);
  const processItemIds = new Set(
    resolveCompletedTurnProcessItemIds(
      itemIds.flatMap((itemId) => {
        const item = itemStoresById.get(itemId)?.peek();
        return item === undefined ? [] : [item];
      }),
      turn.status,
    ),
  );
  const processToggleAvailable = processItemIds.size > 0;
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
            projectId={projectId}
            processExpanded={processExpanded}
            processItemIds={processItemIds}
            processToggleAvailable={processToggleAvailable}
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
            {liveDiff === undefined ? null : <LiveFileChanges diff={liveDiff} />}
            <RunningReplyStatus />
          </div>
        </Message>
      ) : null}
      {!hasAssistantItems && suppressEmptyRunningStatus && liveDiff !== undefined ? (
        <LiveFileChanges diff={liveDiff} />
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

function TaskNoticeRow({ notice }: Readonly<{ notice: TaskNotice }>) {
  const isWarning = notice.payload.level === "warning";
  const message =
    notice.payload.code === "model_verification"
      ? i18n.t("timeline.notice.modelVerification", { ns: "conversation" })
      : notice.payload.message;
  const title = i18n.t(`timeline.notice.${notice.payload.code}`, { ns: "conversation" });

  return (
    <div
      className={`flex items-start gap-2 border-l-2 px-3 py-2 text-label leading-5 ${
        isWarning ? "border-warning text-warning" : "border-separator-strong text-muted-foreground"
      }`}
      role={isWarning ? "alert" : "status"}
    >
      {isWarning ? (
        <AlertTriangle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      ) : (
        <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      )}
      <div className="min-w-0">
        <p className="font-medium text-foreground">{title}</p>
        <p className="break-words">{message}</p>
      </div>
    </div>
  );
}

export function StoreTaskNoticeList({ store }: Readonly<{ store: TaskStore }>) {
  const notices = useStore(store, (state) => state.notices);
  return notices.map((notice) => (
    <TaskNoticeRow key={`${notice.sessionId}:${String(notice.sequence)}`} notice={notice} />
  ));
}

export function StorePendingRequestList({
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

export function TaskStoreTimeline({
  connected,
  onBuildPlan,
  onForkTask,
  onOpenFileDiff,
  onOpenSourceFile,
  onReviewFileChanges,
  onResolvePendingRequest,
  scrollToBottomSignal,
  store,
  submissionStartedAt,
  submissionTurnId,
}: Readonly<{
  connected: boolean;
  onBuildPlan?: BuildPlanAction;
  onForkTask?: ForkTaskAction;
  onOpenFileDiff: (change: AgentFileChange) => void;
  onOpenSourceFile: (reference: MessageFileReference) => void;
  onReviewFileChanges: (changes: readonly AgentFileChange[]) => void;
  onResolvePendingRequest: (
    request: PendingRequest,
    resolution: PendingRequestResolution,
    idempotencyKey: string,
  ) => Promise<void>;
  scrollToBottomSignal?: number;
  store: TaskStore;
  submissionStartedAt?: string;
  submissionTurnId?: string;
}>) {
  const projectId = store.getState().projectId;
  const taskId = store.getState().taskId;
  const turnIds = useStore(store, (state) => state.turnIds);
  const pendingRequestIds = useStore(store, (state) => state.pendingRequestIds);
  const pendingRequestsById = useStore(store, (state) => state.pendingRequestsById);
  const notices = useStore(store, (state) => state.notices);
  const hasVisiblePendingRequest = pendingRequestIds.some(
    (requestId) => pendingRequestsById[requestId]?.status !== "resolved",
  );
  const submissionHandoffState = useStore(store, (state) => {
    if (submissionTurnId === undefined) {
      return "awaiting-turn";
    }
    const turn = state.turnsById[submissionTurnId];
    if (turn === undefined) {
      return "awaiting-turn";
    }
    const groups = groupStoredTurnTimelineItems(
      state.itemIdsByTurnId[submissionTurnId] ?? [],
      state.itemStoresById,
    );
    if (groups.some((group) => group.type === "assistant")) {
      return "assistant-started";
    }
    // completed Snapshot 可能先于 Assistant Item 落盘，只有失败或中断才能提前结束本地提交态。
    return turn.status === "failed" || turn.status === "interrupted"
      ? "finished"
      : "awaiting-assistant";
  });
  // HTTP 返回不代表回复已经可见；首个 Assistant Item 到达前由稳定尾部持续承载运行态。
  const showPendingSubmission =
    submissionStartedAt !== undefined &&
    (submissionHandoffState === "awaiting-turn" || submissionHandoffState === "awaiting-assistant");
  const hasNotices = notices.length > 0;
  if (turnIds.length === 0 && !hasVisiblePendingRequest && !showPendingSubmission && !hasNotices) {
    return (
      <TimelineState message={i18n.t("timeline.noHistory", { ns: "conversation" })} role="status" />
    );
  }
  const latestTurnId = turnIds.at(-1);

  return (
    <Conversation
      aria-label={i18n.t("timeline.conversation", { ns: "conversation" })}
      conversationId={`${projectId}:${taskId}`}
      {...(scrollToBottomSignal === undefined ? {} : { scrollToBottomSignal })}
    >
      <ConversationVirtualList
        {...(hasVisiblePendingRequest || showPendingSubmission || hasNotices
          ? {
              footer: (
                <>
                  {hasNotices ? <StoreTaskNoticeList store={store} /> : null}
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
            {...(connected && turnId === latestTurnId && onBuildPlan !== undefined
              ? { onBuildPlan }
              : {})}
            {...(connected && turnId === latestTurnId && onForkTask !== undefined
              ? { onForkTask }
              : {})}
            onOpenFileDiff={onOpenFileDiff}
            onOpenSourceFile={onOpenSourceFile}
            onReviewFileChanges={onReviewFileChanges}
            projectId={projectId}
            store={store}
            taskId={taskId}
            turnId={turnId}
            turnIndex={turnIndex}
            suppressEmptyRunningStatus={showPendingSubmission && turnId === submissionTurnId}
          />
        )}
      />
      <ConversationScrollButton />
    </Conversation>
  );
}
