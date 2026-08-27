import { Channel, invoke, isTauri } from "@tauri-apps/api/core";

import type { AppEvent, RuntimeSnapshot } from "@/domain/runtime";

let runtimeChannel: Channel<AppEvent> | null = null;
let connectionPromise: Promise<RuntimeSnapshot> | null = null;

const WEB_PREVIEW_SNAPSHOT: RuntimeSnapshot = Object.freeze({
  schemaVersion: 1,
  status: "stopped",
  provider: null,
  lastSeq: 0,
});

export function connectRuntimeChannel(
  onEvent: (event: AppEvent) => void,
): Promise<RuntimeSnapshot> {
  if (!isTauri()) {
    return Promise.resolve(WEB_PREVIEW_SNAPSHOT);
  }

  if (connectionPromise) {
    return connectionPromise;
  }

  // Channel 在模块作用域只创建一次，后续业务只能通过 Store 订阅归一化事件。
  runtimeChannel = new Channel<AppEvent>();
  runtimeChannel.onmessage = onEvent;
  connectionPromise = invoke<RuntimeSnapshot>("connect_runtime", {
    onEvent: runtimeChannel,
  }).catch((error: unknown) => {
    runtimeChannel = null;
    connectionPromise = null;
    throw error;
  });

  return connectionPromise;
}

export async function initializeRuntimeChannel(
  onEvent: (event: AppEvent) => void,
): Promise<RuntimeSnapshot> {
  const snapshot = await connectRuntimeChannel(onEvent);

  if (!isTauri() || snapshot.status !== "stopped") {
    return snapshot;
  }

  // Provider 进程只在模块级 Channel 就绪后启动，保证首个状态事件有稳定消费者。
  return invoke<RuntimeSnapshot>("start_runtime");
}
