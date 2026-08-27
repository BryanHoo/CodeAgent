import { Channel, invoke } from "@tauri-apps/api/core";
import type { AgentEvent } from "@/protocol/index.js";

export type RuntimeStatus = "failed" | "idle" | "ready" | "starting";
export type RuntimeSnapshot = Readonly<{
  lastSeq: number;
  provider: "codex" | null;
  status: RuntimeStatus;
}>;

type RuntimeStatusEvent = Readonly<{
  data: Readonly<{ provider: "codex" | null; seq: number; status: RuntimeStatus }>;
  type: "runtimeStatus";
}>;

type AgentRuntimeEvent = Readonly<{
  data: Readonly<{ event: AgentEvent }>;
  type: "agentEvent";
}>;

type RuntimeEvent = AgentRuntimeEvent | RuntimeStatusEvent;
type AgentEventSubscription = Readonly<{
  afterSequence: number;
  onEvent: (event: AgentEvent) => void;
}>;

let runtimePromise: Promise<RuntimeSnapshot> | undefined;
const runtimeListeners = new Set<(event: RuntimeStatusEvent) => void>();
const agentEventListeners = new Set<(event: AgentEvent) => void>();
const recentAgentEvents: AgentEvent[] = [];
const MAX_BUFFERED_AGENT_EVENTS = 1_024;

export function subscribeRuntime(listener: (event: RuntimeStatusEvent) => void): () => void {
  runtimeListeners.add(listener);
  return () => runtimeListeners.delete(listener);
}

export function subscribeAgentEvents(options: AgentEventSubscription): () => void {
  agentEventListeners.add(options.onEvent);
  // Channel 在页面订阅前已经可能收到事件，按 checkpoint 回放避免首帧丢失。
  for (const event of recentAgentEvents) {
    if (event.sequence > options.afterSequence) options.onEvent(event);
  }
  return () => agentEventListeners.delete(options.onEvent);
}

export function ensureCodexRuntime(): Promise<RuntimeSnapshot> {
  runtimePromise ??= (async () => {
    const channel = new Channel<RuntimeEvent>((event) => {
      if (event.type === "runtimeStatus") {
        for (const listener of runtimeListeners) listener(event);
        // 后端进程已失效时清除已兑现 Promise，让下一次命令重新握手。
        if (event.data.status === "failed") runtimePromise = undefined;
        return;
      }
      recentAgentEvents.push(event.data.event);
      if (recentAgentEvents.length > MAX_BUFFERED_AGENT_EVENTS) recentAgentEvents.shift();
      for (const listener of agentEventListeners) listener(event.data.event);
    });
    await invoke<RuntimeSnapshot>("connect_runtime", { onEvent: channel });
    return invoke<RuntimeSnapshot>("start_runtime");
  })().catch((error: unknown) => {
    runtimePromise = undefined;
    throw error;
  });
  return runtimePromise;
}
