import { CodeAgentClient } from "@code-agent/client";
import type { BrowserSessionResponse } from "@code-agent/protocol";
import { subscribeBrowserSessionWebSocketDisconnected } from "../shared/browser-session-events.js";

const BROWSER_SESSION_STORAGE_KEY = "code-agent.browser-session-id";
const BROWSER_SESSION_POLL_MS = 10_000;
const browserSessionClient = new CodeAgentClient();

type BrowserSessionStorage = Pick<Storage, "getItem" | "setItem">;
type BrowserSessionDocument = Pick<
  Document,
  "addEventListener" | "removeEventListener" | "visibilityState"
>;
type BrowserSessionWindow = Pick<Window, "addEventListener" | "removeEventListener"> & {
  navigator: Pick<Navigator, "onLine">;
};

export interface BrowserSessionOptions {
  browserDocument?: BrowserSessionDocument;
  browserWindow?: BrowserSessionWindow;
  pollIntervalMs?: number;
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
  const browserDocument = options.browserDocument ?? document;
  const browserWindow = options.browserWindow ?? window;
  const pollIntervalMs = options.pollIntervalMs ?? BROWSER_SESSION_POLL_MS;
  let active = true;
  let checking = false;
  let checkRequested = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const clearTimer = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };
  const canPoll = (): boolean =>
    browserDocument.visibilityState === "visible" && browserWindow.navigator.onLine;
  const schedule = (): void => {
    clearTimer();
    if (active && canPoll()) {
      timer = setTimeout(() => void check(), pollIntervalMs);
    }
  };
  const check = async (): Promise<void> => {
    if (!active || !canPoll()) {
      clearTimer();
      return;
    }
    if (checking) {
      checkRequested = true;
      return;
    }
    checking = true;
    clearTimer();
    const result = await synchronizeBrowserSession(options);
    checking = false;
    if (result === "reloaded") {
      return;
    }
    if (checkRequested) {
      checkRequested = false;
      void check();
      return;
    }
    schedule();
  };
  const checkNow = (): void => {
    if (canPoll()) {
      void check();
    } else {
      clearTimer();
    }
  };
  const handleVisibilityChange = (): void => {
    checkNow();
  };
  const handleOnline = (): void => {
    checkNow();
  };

  // 后台或离线时停止轮询；恢复前台、联网或长连接异常时立即核对服务实例。
  browserDocument.addEventListener("visibilitychange", handleVisibilityChange);
  browserWindow.addEventListener("online", handleOnline);
  const unsubscribeWebSocket = subscribeBrowserSessionWebSocketDisconnected(checkNow);
  checkNow();
  return () => {
    active = false;
    clearTimer();
    browserDocument.removeEventListener("visibilitychange", handleVisibilityChange);
    browserWindow.removeEventListener("online", handleOnline);
    unsubscribeWebSocket();
  };
}
