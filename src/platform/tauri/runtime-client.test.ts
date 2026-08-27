import { describe, expect, it, vi } from "vitest";

import { type InvokeImplementation } from "./native-client.js";
import { TauriRuntimeClient } from "./runtime-client.js";

describe("TauriRuntimeClient", () => {
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
});
