import type { AgentEvent, AgentTaskSnapshot, PendingRequest } from "@code-agent/protocol";

export type TaskActivity = Readonly<{
  isAwaitingApproval: boolean;
  isRunning: boolean;
}>;

type TaskActivityRecord = Readonly<{
  isRunning: boolean;
  pendingApprovalRequestIds: ReadonlySet<string>;
}>;

export type TaskActivityMap = ReadonlyMap<string, TaskActivityRecord>;

const inactiveTaskActivity: TaskActivity = {
  isAwaitingApproval: false,
  isRunning: false,
};

function createTaskActivityKey(projectId: string, taskId: string): string {
  return `${projectId}\u0000${taskId}`;
}

function isApprovalRequest(request: PendingRequest): boolean {
  return request.type === "command_approval" || request.type === "file_change_approval";
}

function collectPendingApprovalRequestIds(
  requests: readonly PendingRequest[],
): ReadonlySet<string> {
  return new Set(
    requests
      .filter((request) => request.status === "pending" && isApprovalRequest(request))
      .map((request) => request.requestId),
  );
}

function setsAreEqual(first: ReadonlySet<string>, second: ReadonlySet<string>): boolean {
  if (first.size !== second.size) {
    return false;
  }
  for (const value of first) {
    if (!second.has(value)) {
      return false;
    }
  }
  return true;
}

function replaceTaskActivity(
  activity: TaskActivityMap,
  projectId: string,
  taskId: string,
  nextRecord: TaskActivityRecord,
): TaskActivityMap {
  const key = createTaskActivityKey(projectId, taskId);
  const currentRecord = activity.get(key);
  if (
    currentRecord?.isRunning === nextRecord.isRunning &&
    setsAreEqual(currentRecord.pendingApprovalRequestIds, nextRecord.pendingApprovalRequestIds)
  ) {
    return activity;
  }
  const nextActivity = new Map(activity);
  nextActivity.set(key, nextRecord);
  return nextActivity;
}

export function recordRunningTaskActivity(
  activity: TaskActivityMap,
  projectId: string,
  taskId: string,
): TaskActivityMap {
  const currentRecord = activity.get(createTaskActivityKey(projectId, taskId));
  return replaceTaskActivity(activity, projectId, taskId, {
    isRunning: true,
    pendingApprovalRequestIds: currentRecord?.pendingApprovalRequestIds ?? new Set(),
  });
}

export function getTaskActivity(
  activity: TaskActivityMap,
  projectId: string,
  taskId: string,
): TaskActivity {
  const record = activity.get(createTaskActivityKey(projectId, taskId));
  return record === undefined
    ? inactiveTaskActivity
    : {
        isAwaitingApproval: record.pendingApprovalRequestIds.size > 0,
        isRunning: record.isRunning,
      };
}

export function removeTaskActivity(
  activity: TaskActivityMap,
  projectId: string,
  taskId: string,
): TaskActivityMap {
  const key = createTaskActivityKey(projectId, taskId);
  if (!activity.has(key)) {
    return activity;
  }
  const nextActivity = new Map(activity);
  nextActivity.delete(key);
  return nextActivity;
}

export function recordTaskActivitySnapshot(
  activity: TaskActivityMap,
  snapshot: AgentTaskSnapshot,
): TaskActivityMap {
  return replaceTaskActivity(activity, snapshot.projectId, snapshot.id, {
    isRunning: snapshot.status === "running",
    pendingApprovalRequestIds: collectPendingApprovalRequestIds(snapshot.pendingRequests),
  });
}

export function reduceTaskActivityEvent(
  activity: TaskActivityMap,
  projectId: string,
  event: AgentEvent,
): TaskActivityMap {
  const key = createTaskActivityKey(projectId, event.taskId);
  const currentRecord = activity.get(key) ?? {
    isRunning: false,
    pendingApprovalRequestIds: new Set<string>(),
  };
  let isRunning = currentRecord.isRunning;
  let pendingApprovalRequestIds = currentRecord.pendingApprovalRequestIds;

  switch (event.type) {
    case "turn.started":
      isRunning = true;
      break;
    case "turn.completed":
      isRunning = false;
      pendingApprovalRequestIds = new Set();
      break;
    case "provider.error":
      if (!event.payload.willRetry) {
        isRunning = false;
        pendingApprovalRequestIds = new Set();
      }
      break;
    case "pending_request.created":
      if (isApprovalRequest(event.payload.request)) {
        pendingApprovalRequestIds = new Set(pendingApprovalRequestIds).add(
          event.payload.request.requestId,
        );
      }
      break;
    case "pending_request.resolved":
    case "pending_request.expired":
      if (pendingApprovalRequestIds.has(event.payload.request.requestId)) {
        const remainingApprovalRequestIds = new Set(pendingApprovalRequestIds);
        remainingApprovalRequestIds.delete(event.payload.request.requestId);
        pendingApprovalRequestIds = remainingApprovalRequestIds;
      }
      break;
    default:
      return activity;
  }

  return replaceTaskActivity(activity, projectId, event.taskId, {
    isRunning,
    pendingApprovalRequestIds,
  });
}
