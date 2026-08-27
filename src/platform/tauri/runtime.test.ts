import { beforeEach, describe, expect, it, vi } from "vitest";

let channelHandler: ((event: unknown) => void) | undefined;
const invoke = vi.fn(async (command: string) => ({
  lastSeq: command === "start_runtime" ? 2 : 1,
  provider: command === "start_runtime" ? "codex" : null,
  status: command === "start_runtime" ? "ready" : "idle",
}));

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    public constructor(handler: (event: unknown) => void) {
      channelHandler = handler;
    }
  },
  invoke,
}));

describe("Tauri runtime recovery", () => {
  beforeEach(() => {
    invoke.mockClear();
  });

  it("starts a fresh runtime after the backend reports failure", async () => {
    const runtime = await import("./runtime.js");
    await runtime.ensureCodexRuntime();
    channelHandler?.({
      data: { provider: "codex", seq: 3, status: "failed" },
      type: "runtimeStatus",
    });
    await runtime.ensureCodexRuntime();

    expect(invoke.mock.calls.filter(([command]) => command === "start_runtime")).toHaveLength(2);
  });
});
