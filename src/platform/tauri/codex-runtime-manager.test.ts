import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

describe("Codex runtime manager", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("checks the runtime again after a private download completes", async () => {
    invoke
      .mockResolvedValueOnce({
        detectedVersion: null,
        globalInstallCommand: "npm install -g @openai/codex@0.149.0",
        requiredVersion: "0.149.0",
        status: "compatible",
      })
      .mockResolvedValueOnce({
        detectedVersion: "0.149.0",
        globalInstallCommand: "npm install -g @openai/codex@0.149.0",
        requiredVersion: "0.149.0",
        status: "compatible",
      });
    const { downloadAndInspectCodexRuntime } = await import("./codex-runtime-manager.js");

    const availability = await downloadAndInspectCodexRuntime();

    expect(availability.status).toBe("compatible");
    expect(invoke.mock.calls.map(([command]) => command)).toEqual([
      "install_codex_runtime",
      "inspect_codex_runtime",
    ]);
  });
});
