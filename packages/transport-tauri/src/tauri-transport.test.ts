import { clearMocks, mockConvertFileSrc, mockIPC } from "@tauri-apps/api/mocks";
import { CodeAgentError } from "@code-agent/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TauriCodeAgentTransport } from "./tauri-transport.js";

beforeEach(() => {
  vi.stubGlobal("window", { crypto: globalThis.crypto });
});

afterEach(() => {
  clearMocks();
  vi.unstubAllGlobals();
});

describe("TauriCodeAgentTransport", () => {
  it("maps native notification operations to typed commands", async () => {
    const calls: { command: string; payload: unknown }[] = [];
    mockIPC((command, payload) => {
      calls.push({ command, payload });
      return { status: "shown" };
    });
    const transport = new TauriCodeAgentTransport();

    await transport.request(
      {
        input: {
          body: "完成",
          projectId: "project-1",
          tag: "task-1",
          taskId: "task-1",
          title: "CodeAgent",
        },
        name: "host.notification_show",
        output: {} as never,
      },
      { requestId: "host-request" },
    );

    expect(calls).toEqual([
      {
        command: "host_notification_show",
        payload: {
          body: "完成",
          projectId: "project-1",
          requestId: "host-request",
          tag: "task-1",
          taskId: "task-1",
          title: "CodeAgent",
        },
      },
    ]);
  });

  it("maps supported domain operations to typed commands", async () => {
    const calls: { command: string; payload: unknown }[] = [];
    mockIPC((command, payload) => {
      calls.push({ command, payload });
      if (command === "app_info") {
        return {
          appVersion: "1.9.0",
          codexVersion: "0.147.0",
          error: null,
          latestVersion: null,
          releaseNotes: null,
          status: "current",
          updateAvailable: false,
        };
      }
      return {
        runtime: { state: "ready" },
        status: "ok",
        version: 1,
      };
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

  it("maps source file reads to the nested Tauri query contract", async () => {
    const calls: { command: string; payload: unknown }[] = [];
    mockIPC((command, payload) => {
      calls.push({ command, payload });
      return { content: "export {};", nextCursor: null, path: "src/main.ts" };
    });
    const transport = new TauriCodeAgentTransport();

    await transport.request(
      {
        input: { cursor: 1024, path: "src/main.ts", projectId: "project-a" },
        name: "files.source_read",
        output: {} as never,
      },
      { requestId: "source-request" },
    );

    expect(calls).toEqual([
      {
        command: "file_source_read",
        payload: {
          projectId: "project-a",
          query: { cursor: 1024, path: "src/main.ts" },
          requestId: "source-request",
        },
      },
    ]);
  });

  it("maps task turn pagination to the Tauri command", async () => {
    const calls: { command: string; payload: unknown }[] = [];
    mockIPC((command, payload) => {
      calls.push({ command, payload });
      return { data: [], nextCursor: null };
    });
    const transport = new TauriCodeAgentTransport();

    await transport.request(
      {
        input: { cursor: "older/value", projectId: "project-1", taskId: "task-1" },
        name: "turns.list",
        output: {} as never,
      },
      { requestId: "turn-page-request" },
    );

    expect(calls).toEqual([
      {
        command: "turn_list",
        payload: {
          cursor: "older/value",
          projectId: "project-1",
          requestId: "turn-page-request",
          taskId: "task-1",
        },
      },
    ]);
  });

  it("maps the app update mutation with stable request identities", async () => {
    const calls: { command: string; payload: unknown }[] = [];
    mockIPC((command, payload) => {
      calls.push({ command, payload });
      return {
        appVersion: "1.10.0",
        codexVersion: "0.147.0",
        error: null,
        latestVersion: "1.11.0",
        releaseNotes: null,
        status: "restart-required",
        updateAvailable: false,
      };
    });
    const transport = new TauriCodeAgentTransport();

    await transport.request(
      { input: { version: "1.11.0" }, name: "app.update_install", output: {} as never },
      { idempotencyKey: "update-key", requestId: "update-request" },
    );

    expect(calls).toEqual([
      {
        command: "app_update_install",
        payload: {
          idempotencyKey: "update-key",
          requestId: "update-request",
          version: "1.11.0",
        },
      },
    ]);
  });

  it("maps Phase 5 operations and preserves idempotency payloads", async () => {
    const calls: { command: string; payload: unknown }[] = [];
    mockIPC((command, payload) => {
      calls.push({ command, payload });
      return { status: "ok" };
    });
    const transport = new TauriCodeAgentTransport();

    await transport.request(
      {
        input: {
          input: {
            attachments: [],
            skills: [],
            text: "继续",
            type: "prompt",
          },
          projectId: "temporary",
          taskId: "task-1",
          turnOptions: {
            approvalPolicy: "never",
            approvalsReviewer: "user",
            model: "gpt-5.6",
            reasoningEffort: "high",
            sandboxMode: "danger-full-access",
          },
        },
        name: "turns.start",
        output: {} as never,
      },
      { idempotencyKey: "turn-key", requestId: "turn-request" },
    );
    await transport.request(
      {
        input: { projectId: "temporary", taskId: "task-1" },
        name: "mcp_servers.list",
        output: {} as never,
      },
      { requestId: "mcp-request" },
    );

    expect(calls[0]?.command).toBe("turn_start");
    expect(calls[0]?.payload).toMatchObject({
      idempotencyKey: "turn-key",
      projectId: "temporary",
      requestId: "turn-request",
      taskId: "task-1",
    });
    expect(calls.slice(1)).toEqual([
      {
        command: "mcp_servers_list",
        payload: {
          projectId: "temporary",
          requestId: "mcp-request",
          taskId: "task-1",
        },
      },
    ]);
  });

  it("maps structured Tauri command errors", async () => {
    mockIPC(() => {
      throw Object.assign(new Error("Codex stopped"), {
        code: "provider_failure",
        retryable: true,
      });
    });
    const transport = new TauriCodeAgentTransport();

    await expect(
      transport.request({ name: "models.list", output: {} as never }, { requestId: "models" }),
    ).rejects.toMatchObject({
      code: "provider_failure",
      message: "Codex stopped",
      retryable: true,
    });
  });

  it("delivers ready and continuous Channel events then unsubscribes", async () => {
    const states: string[] = [];
    const events: { event: unknown; wireBytes: number | undefined }[] = [];
    const calls: { command: string; payload: unknown }[] = [];
    let channelId = 0;
    const liveEvent = providerEvent(4, "session-1");
    mockIPC((command, payload) => {
      calls.push({ command, payload });
      if (command === "event_subscribe") {
        channelId = readChannelId((payload as { channel: unknown }).channel);
        return { subscriptionId: "subscription-1" };
      }
      if (command === "event_pull") {
        return encodePullBatch([
          {
            latestSequence: 3,
            sessionId: "session-1",
            type: "connection.ready",
            version: 2,
          },
          liveEvent,
        ]);
      }
      return true;
    });
    const transport = new TauriCodeAgentTransport();
    const unsubscribe = transport.subscribeEvents({
      afterSequence: 3,
      onConnectionState: (state) => states.push(state),
      onEvent: (event, wireBytes) => events.push({ event, wireBytes }),
      onResyncRequired: vi.fn(),
      projectId: "temporary",
      sessionId: "session-1",
    });
    await vi.waitFor(() => {
      expect(channelId).toBeGreaterThan(0);
    });
    sendChannel(channelId, 0, { type: "event.available" });
    await vi.waitFor(() => {
      expect(states).toEqual(["connecting", "connected"]);
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event: liveEvent,
      wireBytes: new TextEncoder().encode(JSON.stringify(liveEvent)).byteLength,
    });
    const pullCall = calls.find((call) => call.command === "event_pull");
    expect(pullCall?.payload).toEqual({
      maxBytes: 256 * 1024,
      maxEvents: 64,
      subscriptionId: "subscription-1",
    });

    unsubscribe();
    sendChannel(channelId, 1, { type: "event.available" });
    await vi.waitFor(() => {
      expect(calls).toContainEqual({
        command: "event_unsubscribe",
        payload: { subscriptionId: "subscription-1" },
      });
    });
    expect(states.at(-1)).toBe("closed");
    expect(events).toHaveLength(1);
  });

  it("uses one Project Context lease for event subscription and release", async () => {
    const calls: { command: string; payload: unknown }[] = [];
    mockIPC((command, payload) => {
      calls.push({ command, payload });
      return command === "event_subscribe" ? { subscriptionId: "subscription-lease" } : true;
    });
    const transport = new TauriCodeAgentTransport();
    const leaseId = "lease-project-a";

    const unsubscribe = transport.subscribeEvents({
      afterSequence: 0,
      onEvent: vi.fn(),
      onResyncRequired: vi.fn(),
      projectContextLeaseId: leaseId,
      projectId: "project-a",
      sessionId: "session-lease",
    });
    await vi.waitFor(() => {
      expect(calls[0]).toMatchObject({
        command: "event_subscribe",
        payload: { leaseId, projectId: "project-a" },
      });
    });

    unsubscribe();
    await transport.releaseProjectContext("project-a", leaseId);

    const releaseCall = calls.find((call) => call.command === "project_context_release");
    expect(releaseCall).toMatchObject({
      command: "project_context_release",
      payload: { leaseId, projectId: "project-a" },
    });
    expect(typeof (releaseCall?.payload as { requestId?: unknown }).requestId).toBe("string");
  });

  it("reports event unsubscribe errors without rewriting them", async () => {
    let channelId = 0;
    mockIPC((command, payload) => {
      if (command === "event_subscribe") {
        channelId = readChannelId((payload as { channel: unknown }).channel);
        return { subscriptionId: "subscription-failing-unsubscribe" };
      }
      if (command === "event_unsubscribe") {
        return Promise.reject(new Error("native unsubscribe failed exactly"));
      }
      return true;
    });
    const onError = vi.fn();
    const transport = new TauriCodeAgentTransport();
    const unsubscribe = transport.subscribeEvents({
      afterSequence: 0,
      onError,
      onEvent: vi.fn(),
      onResyncRequired: vi.fn(),
      projectId: "project-a",
      sessionId: "session-unsubscribe-error",
    });
    await vi.waitFor(() => {
      expect(channelId).toBeGreaterThan(0);
    });
    await Promise.resolve();
    await Promise.resolve();

    unsubscribe();

    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ message: "native unsubscribe failed exactly" }),
      );
    });
  });

  it("stops Channel delivery for local sequence gaps and server resync", async () => {
    const resyncs: unknown[] = [];
    let channelId = 0;
    mockIPC((command, payload) => {
      if (command === "event_subscribe") {
        channelId = readChannelId((payload as { channel: unknown }).channel);
        return { subscriptionId: "subscription-gap" };
      }
      if (command === "event_pull") {
        return encodePullBatch([
          {
            latestSequence: 0,
            sessionId: "session-gap",
            type: "connection.ready",
            version: 2,
          },
          providerEvent(2, "session-gap"),
        ]);
      }
      return true;
    });
    const transport = new TauriCodeAgentTransport();
    transport.subscribeEvents({
      afterSequence: 0,
      onEvent: vi.fn(),
      onResyncRequired: (message) => resyncs.push(message),
      projectId: "project-a",
      sessionId: "session-gap",
    });
    await vi.waitFor(() => {
      expect(channelId).toBeGreaterThan(0);
    });
    sendChannel(channelId, 0, { type: "event.available" });
    await vi.waitFor(() => {
      expect(resyncs).toEqual([
        expect.objectContaining({ latestSequence: 2, reason: "sequence_gap" }),
      ]);
    });

    let serverChannelId = 0;
    mockIPC((command, payload) => {
      if (command === "event_subscribe") {
        serverChannelId = readChannelId((payload as { channel: unknown }).channel);
        return { subscriptionId: "subscription-server" };
      }
      if (command === "event_pull") {
        return encodePullBatch([
          {
            latestSequence: 8,
            reason: "event_retention_exceeded",
            sessionId: "session-gap",
            type: "resync.required",
            version: 2,
          },
        ]);
      }
      return true;
    });
    transport.subscribeEvents({
      afterSequence: 2,
      onEvent: vi.fn(),
      onResyncRequired: (message) => resyncs.push(message),
      projectId: "project-a",
      sessionId: "session-gap",
    });
    await vi.waitFor(() => {
      expect(serverChannelId).toBeGreaterThan(0);
    });
    sendChannel(serverChannelId, 0, { type: "event.available" });
    await vi.waitFor(() => {
      expect(resyncs.at(-1)).toMatchObject({ reason: "event_retention_exceeded" });
    });
  });

  it("keeps a single in-flight pull and continues after a full budget batch", async () => {
    const events: number[] = [];
    const pulls: unknown[] = [];
    let channelId = 0;
    let pullCount = 0;
    mockIPC((command, payload) => {
      if (command === "event_subscribe") {
        channelId = readChannelId((payload as { channel: unknown }).channel);
        return { subscriptionId: "subscription-budget" };
      }
      if (command === "event_pull") {
        pulls.push(payload);
        pullCount += 1;
        if (pullCount === 1) {
          return encodePullBatch([
            {
              latestSequence: 0,
              sessionId: "session-budget",
              type: "connection.ready",
              version: 2,
            },
            ...Array.from({ length: 64 }, (_, index) => providerEvent(index + 1, "session-budget")),
          ]);
        }
        if (pullCount === 2) {
          return encodePullBatch([providerEvent(65, "session-budget")]);
        }
        return encodePullBatch([]);
      }
      return true;
    });
    const transport = new TauriCodeAgentTransport();
    transport.subscribeEvents({
      afterSequence: 0,
      onEvent: (event) => events.push(event.sequence),
      onResyncRequired: vi.fn(),
      projectId: "project-a",
      sessionId: "session-budget",
    });
    await vi.waitFor(() => {
      expect(channelId).toBeGreaterThan(0);
    });
    sendChannel(channelId, 0, { type: "event.available" });
    sendChannel(channelId, 1, { type: "event.available" });
    await vi.waitFor(() => {
      expect(events.at(-1)).toBe(65);
    });
    expect(events).toHaveLength(65);
    expect(pulls).toHaveLength(2);
  });

  it("stops pulling after an empty batch until the next notify", async () => {
    const pulls: number[] = [];
    let channelId = 0;
    mockIPC((command, payload) => {
      if (command === "event_subscribe") {
        channelId = readChannelId((payload as { channel: unknown }).channel);
        return { subscriptionId: "subscription-idle" };
      }
      if (command === "event_pull") {
        pulls.push(1);
        return encodePullBatch([]);
      }
      return true;
    });
    const transport = new TauriCodeAgentTransport();
    transport.subscribeEvents({
      afterSequence: 0,
      onEvent: vi.fn(),
      onResyncRequired: vi.fn(),
      projectId: "project-a",
      sessionId: "session-idle",
    });
    await vi.waitFor(() => {
      expect(channelId).toBeGreaterThan(0);
    });
    sendChannel(channelId, 0, { type: "event.available" });
    await vi.waitFor(() => {
      expect(pulls).toHaveLength(1);
    });
    await Promise.resolve();
    expect(pulls).toHaveLength(1);
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

  it("preserves structured attachment upload errors", async () => {
    mockIPC(() => {
      throw Object.assign(new Error("git: remote rejected"), {
        code: "provider_failure",
        retryable: true,
      });
    });
    const transport = new TauriCodeAgentTransport();

    const request = transport.request(
      {
        input: {
          input: {
            content: new Blob(["content"], { type: "text/plain" }),
            kind: "text",
            name: "note.txt",
          },
          projectId: "project-a",
        },
        name: "attachments.upload",
        output: {} as never,
      },
      { requestId: "upload-error" },
    );

    await expect(request).rejects.toBeInstanceOf(CodeAgentError);
    await expect(request).rejects.toMatchObject({
      code: "provider_failure",
      message: "git: remote rejected",
      retryable: true,
    });
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
    "builds controlled asset URLs for absolute project image paths: %s",
    (path) => {
      mockConvertFileSrc("macos");
      const transport = new TauriCodeAgentTransport();

      const url = transport.resolveAssetUrl({
        kind: "project-image",
        path,
        projectId: "project-a",
      });

      expect(url).toContain("project-image");
      expect(decodeURIComponent(decodeURIComponent(url))).toContain(path);
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

  it("uses the request ID as the default mutation idempotency key", async () => {
    const calls: { command: string; payload: unknown }[] = [];
    mockIPC((command, payload) => {
      calls.push({ command, payload });
      return { task: { id: "task-1" } };
    });
    const transport = new TauriCodeAgentTransport();

    await transport.request(
      { input: { projectId: "project-a" }, name: "tasks.start", output: {} as never },
      { requestId: "task-request" },
    );

    expect(calls).toEqual([
      {
        command: "task_start",
        payload: {
          idempotencyKey: "task-request",
          projectId: "project-a",
          requestId: "task-request",
        },
      },
    ]);
  });

  it("starts each test without retained Tauri internals", () => {
    expect(window).not.toHaveProperty("__TAURI_INTERNALS__");
  });
});

const PULL_BATCH_MAGIC = 0x4341_4550;

function encodePullBatch(frames: object[]): Uint8Array {
  const encoded = frames.map((frame) => new TextEncoder().encode(JSON.stringify(frame)));
  let size = 8;
  for (const bytes of encoded) size += 4 + bytes.length;
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  view.setUint32(0, PULL_BATCH_MAGIC, true);
  view.setUint32(4, encoded.length, true);
  let offset = 8;
  for (const bytes of encoded) {
    view.setUint32(offset, bytes.length, true);
    offset += 4;
    out.set(bytes, offset);
    offset += bytes.length;
  }
  return out;
}

function sendChannel(id: number, index: number, message: unknown): void {
  (
    window as unknown as { __TAURI_INTERNALS__: { runCallback(id: number, value: unknown): void } }
  ).__TAURI_INTERNALS__.runCallback(id, { index, message });
}

function readChannelId(channel: unknown): number {
  if (typeof channel === "object" && channel !== null && "id" in channel) {
    return Number(channel.id);
  }
  return Number(String(channel).split(":").at(-1));
}

function providerEvent(sequence: number, sessionId: string) {
  return {
    itemId: "item-1",
    payload: { delta: "hello" },
    provider: "codex",
    sequence,
    sessionId,
    taskId: "task-1",
    timestamp: "2026-08-12T00:00:00.000Z",
    turnId: "turn-1",
    type: "message.delta",
    version: 2,
  };
}
