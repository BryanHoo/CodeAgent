import type { AgentEvent, AgentTaskSnapshotResponse } from "@code-agent/protocol";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useStore } from "zustand";

import {
  taskSnapshotQueryOptions,
  type CodeAgentRuntimeClient,
} from "../../projects/project-queries.js";
import { AgentEventBuffer } from "./task-runtime.js";
import {
  createTaskStore,
  createTaskStoreRegistry,
  type ReconstructedTaskSnapshot,
  type TaskStore,
} from "./task-store.js";

const taskStoreRegistry = createTaskStoreRegistry({ maxRetainedStores: 20 });
const emptyTaskStore = createTaskStore({ projectId: "", taskId: "" });
interface SharedRuntimeConnection {
  cleanup: () => void;
  consumers: number;
  signature: string;
}
const sharedRuntimeConnections = new WeakMap<TaskStore, SharedRuntimeConnection>();

export type TaskRuntimeView = Readonly<{
  connectionState: "closed" | "connected" | "connecting" | "reconnecting";
  error: Error | null;
  isPending: boolean;
  snapshot: ReconstructedTaskSnapshot | undefined;
  store: TaskStore | undefined;
}>;

type TaskRuntimeOptions = Readonly<{
  onSnapshot?: (response: AgentTaskSnapshotResponse) => void;
}>;

function isDeltaEvent(event: AgentEvent): boolean {
  return (
    event.type === "message.delta" ||
    event.type === "reasoning.delta" ||
    event.type === "command.output_delta"
  );
}

function releaseSharedRuntimeConnection(
  store: TaskStore,
  connection: SharedRuntimeConnection,
): void {
  connection.consumers -= 1;
  if (connection.consumers > 0) {
    return;
  }
  connection.cleanup();
  if (sharedRuntimeConnections.get(store) === connection) {
    sharedRuntimeConnections.delete(store);
  }
}

export function useTaskRuntime(
  projectId: string,
  taskId: string | undefined,
  client: CodeAgentRuntimeClient,
  options: TaskRuntimeOptions = {},
): TaskRuntimeView {
  const { onSnapshot } = options;
  const taskQuery = useQuery({
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
        void client.unsubscribeTask(projectId, taskId).catch(() => undefined);
      }
    };
  }, [client, projectId, taskId]);

  useEffect(() => {
    if (taskQuery.data !== undefined) {
      onSnapshot?.(taskQuery.data);
    }
  }, [onSnapshot, taskQuery.data]);

  useEffect(() => {
    if (taskQuery.data === undefined) {
      return;
    }
    const response = taskQuery.data;
    const buffer = new AgentEventBuffer();
    let frameId: number | undefined;
    let recovering = false;
    if (store === undefined) {
      return;
    }
    const storeIdentity = store.getState();
    if (storeIdentity.projectId !== projectId || storeIdentity.taskId !== taskId) {
      return;
    }
    const connectionSignature = `${response.checkpoint.sessionId}:${String(response.checkpoint.sequence)}`;
    const sharedConnection = sharedRuntimeConnections.get(store);
    if (sharedConnection?.signature === connectionSignature) {
      sharedConnection.consumers += 1;
      return () => {
        releaseSharedRuntimeConnection(store, sharedConnection);
      };
    }
    if (sharedConnection !== undefined) {
      sharedConnection.cleanup();
      sharedRuntimeConnections.delete(store);
    }
    store.getState().hydrate(response);

    const applyEvents = (events: readonly AgentEvent[]) => {
      if (events.length === 0) {
        return;
      }
      store.getState().applyEvents(events);
    };
    const flushFrame = () => {
      frameId = undefined;
      applyEvents(buffer.drain());
    };
    const refetchSnapshot = () => {
      if (recovering) {
        return;
      }
      recovering = true;
      void taskQuery.refetch().finally(() => {
        recovering = false;
      });
    };

    let unsubscribe: () => void = () => undefined;
    unsubscribe = client.subscribeEvents({
      afterSequence: response.checkpoint.sequence,
      projectId,
      onConnectionState(connectionState) {
        store.getState().setConnectionState(connectionState);
        if (connectionState === "connected") {
          // 成功握手后清除上一次连接尝试留下的瞬时错误。
          store.getState().setError(null);
        }
        if (connectionState === "reconnecting") {
          refetchSnapshot();
        }
      },
      onError(error) {
        store.getState().setError(error);
      },
      onEvent(event) {
        if (isDeltaEvent(event)) {
          if (!buffer.push(event)) {
            if (frameId !== undefined) {
              cancelAnimationFrame(frameId);
              frameId = undefined;
            }
            // 停止接收过量 Delta，交由新 Snapshot 和 checkpoint 恢复一致状态。
            unsubscribe();
            refetchSnapshot();
            return;
          }
          frameId ??= requestAnimationFrame(flushFrame);
          return;
        }
        if (frameId !== undefined) {
          cancelAnimationFrame(frameId);
          frameId = undefined;
        }
        // 关键事件前按 Sequence 冲刷全部更早 Delta，避免跨 Item 缓冲导致乱序。
        applyEvents([...buffer.flushThrough(event.sequence), event]);
      },
      onResyncRequired() {
        store.getState().setConnectionState("reconnecting");
        refetchSnapshot();
      },
      sessionId: response.checkpoint.sessionId,
    });

    const connection: SharedRuntimeConnection = {
      cleanup() {
        unsubscribe();
        if (frameId !== undefined) {
          cancelAnimationFrame(frameId);
        }
      },
      consumers: 1,
      signature: connectionSignature,
    };
    sharedRuntimeConnections.set(store, connection);
    return () => {
      releaseSharedRuntimeConnection(store, connection);
    };
  }, [client, projectId, store, taskQuery.data, taskQuery.refetch]);

  const activeRuntime =
    store === undefined ? undefined : selectActiveTaskStore(store, projectId, taskId);
  const hasHydratedSnapshot = activeRuntime?.getState().snapshotMetadata !== null;
  const error =
    activeRuntime === undefined || !hasHydratedSnapshot
      ? taskQuery.error
      : connectionState === "closed"
        ? (taskQuery.error ?? runtimeError)
        : null;
  // 仅在低频 Task 字段变化时重建兼容快照；Delta 不再广播到 Workbench 根节点。
  void taskStatus;
  void taskTitle;
  void taskSettings;
  void itemStructureRevision;
  const snapshot = activeRuntime?.getState().reconstructSnapshot();

  return {
    connectionState: activeRuntime === undefined ? "connecting" : connectionState,
    error,
    isPending:
      error === null &&
      (taskQuery.isPending || activeRuntime === undefined || !hasHydratedSnapshot),
    snapshot,
    store: activeRuntime,
  };
}

export function removeRetainedTaskRuntime(projectId: string, taskId: string): boolean {
  return taskStoreRegistry.remove(projectId, taskId);
}

export function isTaskRuntimeActive(projectId: string, taskId: string): boolean {
  return taskStoreRegistry.hasConsumers(projectId, taskId);
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
