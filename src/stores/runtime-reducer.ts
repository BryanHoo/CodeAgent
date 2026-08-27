import type { AppEvent, RuntimeSnapshot } from "@/domain/runtime";

export type RuntimeConnection = "idle" | "connecting" | "connected" | "error";

export type RuntimeStoreState = {
  connection: RuntimeConnection;
  snapshot: RuntimeSnapshot;
  error: string | null;
};

export const INITIAL_RUNTIME_STATE: RuntimeStoreState = Object.freeze({
  connection: "idle",
  snapshot: Object.freeze({
    schemaVersion: 1,
    status: "stopped",
    provider: null,
    lastSeq: 0,
  }),
  error: null,
});

export function reduceRuntimeEvent(
  state: RuntimeStoreState,
  event: AppEvent,
): RuntimeStoreState {
  // seq 是跨 IPC 的顺序屏障，旧事件不能覆盖更新后的投影。
  if (event.data.seq <= state.snapshot.lastSeq) {
    return state;
  }

  return {
    connection: "connected",
    snapshot: {
      ...state.snapshot,
      status: event.data.status,
      provider: event.data.provider,
      lastSeq: event.data.seq,
    },
    error: null,
  };
}
