import { afterEach, describe, expect, it, vi } from "vitest";

import { notifyBrowserSessionWebSocketDisconnected } from "../shared/browser-session-events.js";
import { startBrowserSessionMonitor, synchronizeBrowserSession } from "./browser-session.js";

class BrowserDocumentStub extends EventTarget {
  public visibilityState: DocumentVisibilityState = "visible";
}

class BrowserWindowStub extends EventTarget {
  public readonly navigator = { onLine: true };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
});

describe("synchronizeBrowserSession", () => {
  it("refreshes the current page when the server instance changes", async () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const requestSession = vi
      .fn()
      .mockResolvedValueOnce({ instanceId: "runtime-1", version: 1 })
      .mockResolvedValueOnce({ instanceId: "runtime-2", version: 1 });
    const reload = vi.fn();

    await expect(synchronizeBrowserSession({ reload, requestSession, storage })).resolves.toBe(
      "initialized",
    );
    await expect(synchronizeBrowserSession({ reload, requestSession, storage })).resolves.toBe(
      "reloaded",
    );

    expect(reload).toHaveBeenCalledOnce();
  });
});

describe("startBrowserSessionMonitor", () => {
  it("polls every 10 seconds while the page is visible and online", async () => {
    vi.useFakeTimers();
    const browserDocument = new BrowserDocumentStub();
    const browserWindow = new BrowserWindowStub();
    const requestSession = vi.fn().mockResolvedValue({ instanceId: "runtime-1", version: 1 });
    const stop = startBrowserSessionMonitor({
      browserDocument,
      browserWindow,
      requestSession,
      storage: { getItem: () => "runtime-1", setItem: vi.fn() },
    });

    await flushPromises();
    expect(requestSession).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(9_999);
    expect(requestSession).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(requestSession).toHaveBeenCalledTimes(2);
    stop();
  });

  it("pauses while hidden and checks immediately when visible again", async () => {
    vi.useFakeTimers();
    const browserDocument = new BrowserDocumentStub();
    const browserWindow = new BrowserWindowStub();
    const requestSession = vi.fn().mockResolvedValue({ instanceId: "runtime-1", version: 1 });
    const stop = startBrowserSessionMonitor({
      browserDocument,
      browserWindow,
      requestSession,
      storage: { getItem: () => "runtime-1", setItem: vi.fn() },
    });
    await flushPromises();

    browserDocument.visibilityState = "hidden";
    browserDocument.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(requestSession).toHaveBeenCalledOnce();

    browserDocument.visibilityState = "visible";
    browserDocument.dispatchEvent(new Event("visibilitychange"));
    await flushPromises();
    expect(requestSession).toHaveBeenCalledTimes(2);
    stop();
  });

  it("checks immediately after reconnecting online or losing a WebSocket", async () => {
    vi.useFakeTimers();
    const browserDocument = new BrowserDocumentStub();
    const browserWindow = new BrowserWindowStub();
    browserWindow.navigator.onLine = false;
    const requestSession = vi.fn().mockResolvedValue({ instanceId: "runtime-1", version: 1 });
    const stop = startBrowserSessionMonitor({
      browserDocument,
      browserWindow,
      requestSession,
      storage: { getItem: () => "runtime-1", setItem: vi.fn() },
    });

    await vi.advanceTimersByTimeAsync(30_000);
    expect(requestSession).not.toHaveBeenCalled();
    browserWindow.navigator.onLine = true;
    browserWindow.dispatchEvent(new Event("online"));
    await flushPromises();
    expect(requestSession).toHaveBeenCalledOnce();

    notifyBrowserSessionWebSocketDisconnected();
    await flushPromises();
    expect(requestSession).toHaveBeenCalledTimes(2);
    stop();
  });
});
