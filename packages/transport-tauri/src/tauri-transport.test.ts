import { clearMocks, mockConvertFileSrc, mockIPC } from "@tauri-apps/api/mocks";
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

  it("returns a stable error for operations not migrated yet", async () => {
    const transport = new TauriCodeAgentTransport();

    await expect(
      transport.request(
        { name: "tasks.list", output: {} as never },
        { requestId: "tasks-request" },
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

  it("uploads attachment bytes through raw IPC without base64", async () => {
    let payload: unknown;
    mockIPC((command, value) => {
      expect(command).toBe("attachment_upload");
      payload = value;
      return { attachment: { id: "asset-id" } };
    });
    const transport = new TauriCodeAgentTransport();
    const bytes = new Uint8Array(10 * 1024 * 1024);
    bytes[0] = 0x89;

    await transport.request(
      {
        input: {
          input: {
            content: new Blob([bytes], { type: "image/png" }),
            kind: "image",
            name: "图.png",
          },
          projectId: "project-a",
        },
        name: "attachments.upload",
        output: {} as never,
      },
      { requestId: "upload-request" },
    );

    expect(payload).toBeInstanceOf(Uint8Array);
    expect((payload as Uint8Array).byteLength).toBe(bytes.byteLength);
  });

  it("builds scoped asset URLs without absolute host paths", () => {
    mockConvertFileSrc("macos");
    const transport = new TauriCodeAgentTransport();

    const url = transport.resolveAssetUrl({
      attachmentId: "opaque-id",
      kind: "project-attachment",
      path: "/Users/private/secret.png",
      projectId: "project-a",
    });

    expect(url).toBe("codeagent-asset://localhost/project-attachment%2Fproject-a%2Fopaque-id");
    expect(url).not.toContain("Users");
  });

  it("uses the native Windows custom protocol URL form", () => {
    mockConvertFileSrc("windows");
    const transport = new TauriCodeAgentTransport();

    expect(
      transport.resolveAssetUrl({
        kind: "project-image",
        path: "images/screen.png",
        projectId: "project-a",
      }),
    ).toBe("http://codeagent-asset.localhost/project-image%2Fproject-a%2Fimages%252Fscreen.png");
  });

  it.each(["/Users/private/image.png", "C:\\private\\image.png", "\\\\server\\image.png"])(
    "rejects absolute project image paths before building asset URLs: %s",
    (path) => {
      const transport = new TauriCodeAgentTransport();

      expect(() =>
        transport.resolveAssetUrl({
          kind: "project-image",
          path,
          projectId: "project-a",
        }),
      ).toThrow("Project image asset paths must be relative");
    },
  );

  it("maps project operations to owned typed command payloads", async () => {
    const calls: { command: string; payload: unknown }[] = [];
    mockIPC((command, payload) => {
      calls.push({ command, payload });
      return { data: [], nextCursor: null };
    });
    const transport = new TauriCodeAgentTransport();

    await transport.request(
      { input: { projectIds: ["beta", "alpha"] }, name: "projects.reorder", output: {} as never },
      { idempotencyKey: "reorder-key", requestId: "reorder-request" },
    );

    expect(calls).toEqual([
      {
        command: "project_reorder",
        payload: {
          idempotencyKey: "reorder-key",
          projectIds: ["beta", "alpha"],
          requestId: "reorder-request",
        },
      },
    ]);
  });

  it("starts each test without retained Tauri internals", () => {
    expect(window).not.toHaveProperty("__TAURI_INTERNALS__");
  });
});
