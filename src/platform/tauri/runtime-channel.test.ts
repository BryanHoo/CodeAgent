import { beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
  isTauri: vi.fn<() => boolean>(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class MockChannel {
    onmessage: ((message: unknown) => void) | null = null;
  },
  invoke: tauri.invoke,
  isTauri: tauri.isTauri,
}));

import { initializeRuntimeChannel } from "@/platform/tauri/runtime-channel";

describe("initializeRuntimeChannel", () => {
  beforeEach(() => {
    tauri.invoke.mockReset();
    tauri.isTauri.mockReset();
  });

  it("keeps web preview stopped without invoking desktop commands", async () => {
    tauri.isTauri.mockReturnValue(false);

    const snapshot = await initializeRuntimeChannel(() => undefined);

    expect(snapshot.status).toBe("stopped");
    expect(tauri.invoke).not.toHaveBeenCalled();
  });

  it("starts Codex once after connecting a stopped desktop runtime", async () => {
    tauri.isTauri.mockReturnValue(true);
    tauri.invoke.mockImplementation((command: string) => {
      if (command === "connect_runtime") {
        return Promise.resolve({
          schemaVersion: 1,
          status: "stopped",
          provider: null,
          lastSeq: 0,
        });
      }
      return Promise.resolve({
        schemaVersion: 1,
        status: "ready",
        provider: "codex",
        lastSeq: 2,
      });
    });

    const snapshot = await initializeRuntimeChannel(() => undefined);

    expect(snapshot.status).toBe("ready");
    expect(tauri.invoke.mock.calls.map(([command]) => command)).toEqual([
      "connect_runtime",
      "start_runtime",
    ]);
  });
});
