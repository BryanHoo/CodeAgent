import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TauriCodeAgentTransport } from "./tauri-transport.js";

beforeEach(() => {
  vi.stubGlobal("window", {});
});

afterEach(() => {
  clearMocks();
  vi.unstubAllGlobals();
});

describe("TauriCodeAgentTransport", () => {
  it("maps supported domain operations to typed commands", async () => {
    const calls: { command: string; payload: unknown }[] = [];
    mockIPC((command, payload) => {
      calls.push({ command, payload });
      if (command === "app_info") {
        return {
          appVersion: "1.9.0",
          codexVersion: "0.147.0",
          latestVersion: null,
          releaseNotes: null,
          status: "current",
          updateAvailable: false,
        };
      }
      return { status: "ok", version: 1 };
    });
    const transport = new TauriCodeAgentTransport();

    await transport.request(
      { name: "app.info", output: {} as never },
      { requestId: "info-request" },
    );
    await transport.request(
      { name: "app.health", output: {} as never },
      { requestId: "diagnostics-request" },
    );

    expect(calls).toEqual([
      { command: "app_info", payload: { requestId: "info-request" } },
      { command: "app_diagnostics", payload: { requestId: "diagnostics-request" } },
    ]);
  });

  it("returns a stable error for operations unavailable in phase 2", async () => {
    const transport = new TauriCodeAgentTransport();

    await expect(
      transport.request(
        { name: "projects.list", output: {} as never },
        { requestId: "projects-request" },
      ),
    ).rejects.toMatchObject({ code: "unsupported_operation" });
  });

  it("invokes explicit host cancellation", async () => {
    const commands: string[] = [];
    mockIPC((command) => {
      commands.push(command);
      return undefined;
    });
    const transport = new TauriCodeAgentTransport();

    await transport.cancel("active-request");

    expect(commands).toEqual(["cancel_operation"]);
  });

  it("starts each test without retained Tauri internals", () => {
    expect(window).not.toHaveProperty("__TAURI_INTERNALS__");
  });
});
