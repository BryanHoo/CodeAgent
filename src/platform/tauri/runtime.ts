import { Channel, invoke } from "@tauri-apps/api/core";

export type RuntimeStatus = "failed" | "idle" | "ready" | "starting";
export type RuntimeSnapshot = Readonly<{
  lastSeq: number;
  provider: "codex" | null;
  status: RuntimeStatus;
}>;

type RuntimeEvent = Readonly<{
  data: Readonly<{ provider: "codex" | null; seq: number; status: RuntimeStatus }>;
  type: "runtimeStatus";
}>;

let runtimePromise: Promise<RuntimeSnapshot> | undefined;
const runtimeListeners = new Set<(event: RuntimeEvent) => void>();

export function subscribeRuntime(listener: (event: RuntimeEvent) => void): () => void {
  runtimeListeners.add(listener);
  return () => runtimeListeners.delete(listener);
}

export function ensureCodexRuntime(): Promise<RuntimeSnapshot> {
  runtimePromise ??= (async () => {
    const channel = new Channel<RuntimeEvent>((event) => {
      for (const listener of runtimeListeners) listener(event);
    });
    await invoke<RuntimeSnapshot>("connect_runtime", { onEvent: channel });
    return invoke<RuntimeSnapshot>("start_runtime");
  })().catch((error: unknown) => {
    runtimePromise = undefined;
    throw error;
  });
  return runtimePromise;
}
