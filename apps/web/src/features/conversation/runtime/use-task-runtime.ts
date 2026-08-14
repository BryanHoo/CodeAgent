import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useStore } from "zustand";
import { showErrorToast } from "../../../shared/errors/error-toast.js";

import { taskSnapshotQueryOptions } from "../../projects/project-queries.js";
import type { ProjectRuntimeManager } from "./project-runtime.js";
import {
  createTaskStore,
  createTaskStoreRegistry,
  type ReconstructedTaskSnapshot,
  type TaskStore,
} from "./task-store.js";

const taskStoreRegistry = createTaskStoreRegistry({ maxRetainedStores: 20 });
const emptyTaskStore = createTaskStore({ projectId: "", taskId: "" });

export type TaskRuntimeView = Readonly<{
  connectionState: "closed" | "connected" | "connecting" | "reconnecting";
  error: Error | null;
  isPending: boolean;
  snapshot: ReconstructedTaskSnapshot | undefined;
  store: TaskStore | undefined;
}>;

export function useTaskRuntime(
  projectId: string,
  taskId: string | undefined,
  projectRuntime: ProjectRuntimeManager,
): TaskRuntimeView {
  const client = projectRuntime.client;
  const {
    data: taskData,
    error: taskQueryError,
    isPending: taskQueryPending,
    refetch: refetchTask,
  } = useQuery({
    ...taskSnapshotQueryOptions(projectId, taskId ?? "no-active-task", client),
    enabled: taskId !== undefined,
  });
  const [store, setStore] = useState<TaskStore>();
  const subscribedStore = store ?? emptyTaskStore;
  const connectionState = useStore(subscribedStore, (state) => state.connectionState);
  const runtimeError = useStore(subscribedStore, (state) => state.error);
  const taskStatus = useStore(subscribedStore, (state) => state.snapshotMetadata?.status);
  const taskTitle = useStore(subscribedStore, (state) => state.snapshotMetadata?.title);
  const taskSettings = useStore(subscribedStore, (state) => state.snapshotMetadata?.settings);
  const taskContextUsage = useStore(
    subscribedStore,
    (state) => state.snapshotMetadata?.contextUsage,
  );
  const taskPlan = useStore(subscribedStore, (state) => state.snapshotMetadata?.plan);
  const taskPinned = useStore(subscribedStore, (state) => state.snapshotMetadata?.pinned);
  const itemStructureRevision = useStore(subscribedStore, (state) => state.itemStructureRevision);

  useEffect(() => {
    if (taskId === undefined) {
      setStore(undefined);
      return;
    }
    const acquiredStore = taskStoreRegistry.acquire(projectId, taskId);
    setStore(acquiredStore);
    return () => {
      const becameInactive = taskStoreRegistry.release(projectId, taskId);
      if (becameInactive) {
        // 页面卸载不等待释放请求；Provider 会对运行 Turn、审批和后台终端做最终安全检查。
        void client.unsubscribeTask(projectId, taskId).catch(showErrorToast);
      }
    };
  }, [client, projectId, taskId]);

  useEffect(() => {
    if (taskData === undefined) {
      return;
    }
    if (store === undefined) {
      return;
    }
    const storeIdentity = store.getState();
    if (storeIdentity.projectId !== projectId || storeIdentity.taskId !== taskId) {
      return;
    }
    return projectRuntime.attachTaskStore(taskData, store, async () => {
      const result = await refetchTask();
      return result.isSuccess ? result.data : undefined;
    });
  }, [projectId, projectRuntime, refetchTask, store, taskData, taskId]);

  const activeRuntime =
    store === undefined ? undefined : selectActiveTaskStore(store, projectId, taskId);
  const hasHydratedSnapshot = activeRuntime?.getState().snapshotMetadata !== null;
  const error =
    activeRuntime === undefined || !hasHydratedSnapshot
      ? taskQueryError
      : connectionState === "closed"
        ? runtimeError
        : null;
  // 轮询等无关父级更新不得重建完整历史；只在结构或可见 Task 元数据变化时读取兼容快照。
  const snapshot = useMemo(() => {
    // Store 选择器值是快照重建的失效信号；读取它们可避免无关父级更新触发重建。
    void itemStructureRevision;
    void taskContextUsage;
    void taskPinned;
    void taskPlan;
    void taskSettings;
    void taskStatus;
    void taskTitle;
    return activeRuntime?.getState().reconstructSnapshot();
  }, [
    activeRuntime,
    itemStructureRevision,
    taskContextUsage,
    taskPinned,
    taskPlan,
    taskSettings,
    taskStatus,
    taskTitle,
  ]);
  const isRuntimePending =
    error === null && (taskQueryPending || activeRuntime === undefined || !hasHydratedSnapshot);

  return useMemo(
    () => ({
      connectionState: activeRuntime === undefined ? "connecting" : connectionState,
      error,
      isPending: isRuntimePending,
      snapshot,
      store: activeRuntime,
    }),
    [activeRuntime, connectionState, error, isRuntimePending, snapshot],
  );
}

export function removeRetainedTaskRuntime(projectId: string, taskId: string): boolean {
  return taskStoreRegistry.remove(projectId, taskId);
}

export function selectActiveTaskStore(
  store: TaskStore | undefined,
  projectId: string,
  taskId: string | undefined,
): TaskStore | undefined {
  const state = store?.getState();
  return taskId !== undefined && state?.projectId === projectId && state.taskId === taskId
    ? store
    : undefined;
}
