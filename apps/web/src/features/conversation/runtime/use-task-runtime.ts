import type { AgentEvent } from "@code-agent/protocol";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import {
  taskSnapshotQueryOptions,
  type CodeAgentRuntimeClient,
} from "../../projects/project-queries.js";
import {
  AgentEventBuffer,
  hydrateTaskRuntime,
  reduceAgentEvent,
  type TaskRuntimeState,
} from "./task-runtime.js";

function isDeltaEvent(event: AgentEvent): boolean {
  return (
    event.type === "message.delta" ||
    event.type === "reasoning.delta" ||
    event.type === "command.output_delta"
  );
}

export function useTaskRuntime(taskId: string, client: CodeAgentRuntimeClient) {
  const taskQuery = useQuery(taskSnapshotQueryOptions(taskId, client));
  const [runtime, setRuntime] = useState<TaskRuntimeState>();
  const [runtimeError, setRuntimeError] = useState<Error | null>(null);

  useEffect(() => {
    if (taskQuery.data === undefined) {
      return;
    }
    const response = taskQuery.data;
    const buffer = new AgentEventBuffer();
    let frameId: number | undefined;
    let recovering = false;
    setRuntime(hydrateTaskRuntime(response));
    setRuntimeError(null);

    const applyEvents = (events: readonly AgentEvent[]) => {
      if (events.length === 0) {
        return;
      }
      setRuntime((current) =>
        current === undefined
          ? current
          : events.reduce((state, event) => reduceAgentEvent(state, event), current),
      );
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
      onConnectionState(connectionState) {
        setRuntime((current) =>
          current === undefined ? current : { ...current, connectionState },
        );
        if (connectionState === "connected") {
          // 成功握手后清除上一次连接尝试留下的瞬时错误。
          setRuntimeError(null);
        }
        if (connectionState === "reconnecting") {
          refetchSnapshot();
        }
      },
      onError(error) {
        setRuntimeError(error);
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
        setRuntime((current) =>
          current === undefined ? current : { ...current, connectionState: "reconnecting" },
        );
        refetchSnapshot();
      },
      sessionId: response.checkpoint.sessionId,
    });

    return () => {
      unsubscribe();
      if (frameId !== undefined) {
        cancelAnimationFrame(frameId);
      }
    };
  }, [client, taskQuery.data, taskQuery.refetch]);

  const activeRuntime = runtime?.snapshot.id === taskId ? runtime : undefined;
  const error =
    activeRuntime === undefined
      ? taskQuery.error
      : activeRuntime.connectionState === "closed"
        ? (taskQuery.error ?? runtimeError)
        : null;

  return {
    connectionState: activeRuntime?.connectionState ?? "connecting",
    error,
    isPending: error === null && (taskQuery.isPending || activeRuntime === undefined),
    snapshot: activeRuntime?.snapshot,
  } as const;
}
