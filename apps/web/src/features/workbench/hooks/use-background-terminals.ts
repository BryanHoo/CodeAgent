import type { AgentBackgroundTerminal } from "@code-agent/protocol";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import type { CodeAgentBackgroundTerminalClient } from "../../projects/project-queries.js";

const BACKGROUND_TERMINAL_POLL_INTERVAL_MS = 1_500;

export function getBackgroundTerminalPollInterval(
  isTaskRunning: boolean,
  terminalCount: number,
): number | false {
  return isTaskRunning || terminalCount > 0 ? BACKGROUND_TERMINAL_POLL_INTERVAL_MS : false;
}

export type BackgroundTerminalView = Readonly<{
  error: Error | null;
  isPending: boolean;
  terminalError: Error | null;
  terminals: readonly AgentBackgroundTerminal[];
  terminatingTerminalId: string | null;
  terminateTerminal: (terminalId: string) => Promise<void>;
}>;

export function useBackgroundTerminals(
  client: CodeAgentBackgroundTerminalClient,
  projectId: string,
  taskId: string | undefined,
  isTaskRunning: boolean,
): BackgroundTerminalView {
  const previousTaskRunningRef = useRef(isTaskRunning);
  const idempotencyKeysRef = useRef(new Map<string, string>());
  const [terminalError, setTerminalError] = useState<Error | null>(null);
  const terminalsQuery = useQuery({
    enabled: taskId !== undefined,
    queryFn: () => {
      if (taskId === undefined) {
        throw new Error("Background terminal query requires a task");
      }
      return client.listBackgroundTerminals(projectId, taskId);
    },
    queryKey: ["projects", projectId, "tasks", taskId, "background-terminals"] as const,
    refetchInterval(query) {
      // Turn 已结束但终端仍存在时继续轮询，直到 Provider 确认进程退出。
      return getBackgroundTerminalPollInterval(isTaskRunning, query.state.data?.data.length ?? 0);
    },
  });
  const terminateMutation = useMutation({
    mutationFn: async (terminalId: string) => {
      if (taskId === undefined) {
        return;
      }
      const idempotencyKey =
        idempotencyKeysRef.current.get(terminalId) ?? globalThis.crypto.randomUUID();
      idempotencyKeysRef.current.set(terminalId, idempotencyKey);
      await client.terminateBackgroundTerminal(projectId, taskId, terminalId, { idempotencyKey });
    },
  });

  useEffect(() => {
    if (previousTaskRunningRef.current === isTaskRunning || taskId === undefined) {
      return;
    }
    previousTaskRunningRef.current = isTaskRunning;
    // Turn 终态到达时立即读取一次，不能把仍存活的后台终端随回复一起清除。
    void terminalsQuery.refetch();
  }, [isTaskRunning, taskId, terminalsQuery.refetch]);

  const terminateTerminal = useCallback(
    async (terminalId: string) => {
      setTerminalError(null);
      try {
        await terminateMutation.mutateAsync(terminalId);
        idempotencyKeysRef.current.delete(terminalId);
        await terminalsQuery.refetch();
      } catch (error) {
        setTerminalError(error instanceof Error ? error : new Error("停止终端失败"));
      }
    },
    [terminateMutation.mutateAsync, terminalsQuery.refetch],
  );

  return {
    error: terminalsQuery.error,
    isPending: terminalsQuery.isPending,
    terminalError,
    terminals: terminalsQuery.data?.data ?? [],
    terminatingTerminalId:
      terminateMutation.isPending && typeof terminateMutation.variables === "string"
        ? terminateMutation.variables
        : null,
    terminateTerminal,
  };
}
