import { describe, expect, it, vi } from "vitest";

import { type InvokeImplementation } from "./native-client.js";
import { TauriRuntimeClient } from "./runtime-client.js";

describe("TauriRuntimeClient", () => {
  it("does not expose unsupported app update installation", () => {
    const client = new TauriRuntimeClient({
      ensureRuntime: vi.fn(async () => undefined),
      invoke: vi.fn() as InvokeImplementation,
    });

    expect("installAppUpdate" in client).toBe(false);
  });

  it("loads the Bing background through the native command", async () => {
    const invoke = vi.fn(async () => ({ assetPath: "/cache/bing.jpg" }));
    const client = new TauriRuntimeClient({
      ensureRuntime: vi.fn(async () => undefined),
      invoke: invoke as InvokeImplementation,
    });

    await expect(client.getWorkbenchBackground("2026-08-25")).resolves.toEqual({
      assetPath: "/cache/bing.jpg",
    });
    expect(invoke).toHaveBeenCalledWith("get_workbench_background", {
      day: "2026-08-25",
    });
  });

  it("reads runtime IPC performance metrics", async () => {
    const response = { projects: [], version: 1 as const };
    const invoke = vi.fn(async () => response);
    const client = new TauriRuntimeClient({
      ensureRuntime: vi.fn(async () => undefined),
      invoke: invoke as InvokeImplementation,
    });

    await expect(client.getPerformanceMetrics()).resolves.toEqual(response);
    expect(invoke).toHaveBeenCalledWith("get_runtime_performance_metrics");
  });
});
