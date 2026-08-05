import { CodeAgentClient } from "@code-agent/client";
import type { BrowserSessionResponse } from "@code-agent/protocol";

const BROWSER_SESSION_STORAGE_KEY = "code-agent.browser-session-id";
const BROWSER_SESSION_POLL_MS = 500;
const browserSessionClient = new CodeAgentClient();

type BrowserSessionStorage = Pick<Storage, "getItem" | "setItem">;

export interface BrowserSessionOptions {
  reload?: () => void;
  requestSession?: () => Promise<BrowserSessionResponse>;
  storage?: BrowserSessionStorage;
}

type BrowserSessionResult = "current" | "initialized" | "reloaded" | "unavailable";

export async function synchronizeBrowserSession(
  options: BrowserSessionOptions = {},
): Promise<BrowserSessionResult> {
  const storage = options.storage ?? sessionStorage;
  let response: BrowserSessionResponse;
  try {
    response = await (options.requestSession ?? (() => browserSessionClient.getBrowserSession()))();
  } catch {
    return "unavailable";
  }

  const previousInstanceId = storage.getItem(BROWSER_SESSION_STORAGE_KEY);
  storage.setItem(BROWSER_SESSION_STORAGE_KEY, response.instanceId);
  if (previousInstanceId === null) {
    return "initialized";
  }
  if (previousInstanceId === response.instanceId) {
    return "current";
  }

  // 服务实例变化说明旧页面跨越了进程重启，直接刷新当前标签加载新状态。
  const reload =
    options.reload ??
    (() => {
      location.reload();
    });
  reload();
  return "reloaded";
}

export function startBrowserSessionMonitor(options: BrowserSessionOptions = {}): () => void {
  let active = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const poll = async (): Promise<void> => {
    const result = await synchronizeBrowserSession(options);
    if (active && result !== "reloaded") {
      timer = setTimeout(() => void poll(), BROWSER_SESSION_POLL_MS);
    }
  };

  // 独立于 Project WebSocket 轮询，空工作台也能在服务重启后复用当前标签。
  void poll();
  return () => {
    active = false;
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  };
}
