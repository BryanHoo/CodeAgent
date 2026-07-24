import { fileURLToPath } from "node:url";

import { CodeAgentClient } from "@code-agent/client";
import type { AgentEvent } from "@code-agent/protocol";
import {
  createCodexAgentProvider,
  startCodexAppServer,
  type CodexAppServerProcess,
} from "@code-agent/provider-codex";
import { createCodeAgentServer } from "@code-agent/server";
import { afterEach, describe, expect, it } from "vitest";

const fakeAppServerPath = fileURLToPath(
  new URL("../packages/provider-codex/test/fixtures/fake-app-server.mjs", import.meta.url),
);

const project = {
  createdAt: "2026-07-23T00:00:00.000Z",
  id: "code-agent",
  name: "CodeAgent",
  rootPath: "/workspace/CodeAgent",
} as const;

const pixelDataUrl =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const turnOptions = {
  approvalPolicy: "on-request",
  model: "gpt-5.6-sol",
  reasoningEffort: "high",
} as const;

const runtimes: CodexAppServerProcess[] = [];
const servers: Awaited<ReturnType<typeof createCodeAgentServer>>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => server.close()));
  await Promise.all(runtimes.splice(0).map(async (runtime) => runtime.close()));
});

describe("Realtime Path", () => {
  it("delivers Fake App Server notifications through Provider and WebSocket", async () => {
    const runtime = await startCodexAppServer({
      binaryPath: fakeAppServerPath,
      env: { ...process.env, FAKE_APP_SERVER_SCENARIO: "realtime" },
      rpcTimeoutMs: 1_000,
      shutdownTimeoutMs: 200,
    });
    runtimes.push(runtime);
    const provider = createCodexAgentProvider({ client: runtime.client, project });
    const server = await createCodeAgentServer({
      eventSessionId: "integration-session",
      project,
      provider,
    });
    servers.push(server);
    const baseUrl = await server.listen({ host: "127.0.0.1", port: 0 });
    const client = new CodeAgentClient({ baseUrl });
    const snapshot = await client.readTask("task-realtime");
    const events: AgentEvent[] = [];

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        unsubscribe();
        reject(new Error("Timed out waiting for Fake App Server realtime events"));
      }, 2_000);
      const unsubscribe = client.subscribeEvents({
        afterSequence: snapshot.checkpoint.sequence,
        onError: reject,
        onEvent(event) {
          events.push(event);
          if (event.type === "provider.error") {
            clearTimeout(timeout);
            unsubscribe();
            resolve();
          }
        },
        onResyncRequired(message) {
          clearTimeout(timeout);
          unsubscribe();
          reject(new Error(`Unexpected resync: ${message.reason}`));
        },
        sessionId: snapshot.checkpoint.sessionId,
      });
    });

    expect(events.map((event) => event.type)).toEqual([
      "turn.started",
      "message.delta",
      "message.delta",
      "item.completed",
      "command.output_delta",
      "item.completed",
      "usage.updated",
      "turn.completed",
      "provider.error",
    ]);
    expect(events.find((event) => event.type === "message.delta")).toMatchObject({
      payload: { delta: "Realtime " },
    });
    expect(events.at(-1)).toMatchObject({
      payload: { message: "模型服务不可用", willRetry: false },
      type: "provider.error",
    });
  });

  it("submits a prompt and streams the completed turn through the full mutation path", async () => {
    const runtime = await startCodexAppServer({
      binaryPath: fakeAppServerPath,
      env: { ...process.env, FAKE_APP_SERVER_SCENARIO: "agent-actions" },
      rpcTimeoutMs: 1_000,
      shutdownTimeoutMs: 200,
    });
    runtimes.push(runtime);
    const provider = createCodexAgentProvider({ client: runtime.client, project });
    const server = await createCodeAgentServer({
      eventSessionId: "action-complete-session",
      project,
      provider,
    });
    servers.push(server);
    const baseUrl = await server.listen({ host: "127.0.0.1", port: 0 });
    const client = new CodeAgentClient({ baseUrl });
    const models = await client.listModels();
    const created = await client.startTask(project.id, { idempotencyKey: "create-complete" });
    const uploaded = await client.uploadAttachment(
      { dataUrl: pixelDataUrl, name: "screen.png" },
      { idempotencyKey: "upload-complete" },
    );
    const snapshot = await client.readTask(created.task.id);
    const events: AgentEvent[] = [];

    const completed = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Timed out waiting for turn completion"));
      }, 2_000);
      const unsubscribe = client.subscribeEvents({
        afterSequence: snapshot.checkpoint.sequence,
        onError: reject,
        onEvent(event) {
          if (event.taskId !== created.task.id) {
            return;
          }
          events.push(event);
          if (event.type === "turn.completed") {
            clearTimeout(timeout);
            unsubscribe();
            resolve();
          }
        },
        onResyncRequired(message) {
          reject(new Error(`Unexpected resync: ${message.reason}`));
        },
        sessionId: snapshot.checkpoint.sessionId,
      });
    });

    await client.startTurn(
      created.task.id,
      {
        attachments: [{ id: uploaded.attachment.id }],
        text: "完成流式回复",
        type: "prompt",
      },
      turnOptions,
      { idempotencyKey: "turn-complete" },
    );
    await completed;

    expect(events.map((event) => event.type)).toEqual([
      "turn.started",
      "message.delta",
      "message.delta",
      "item.completed",
      "usage.updated",
      "turn.completed",
    ]);
    expect(models.data).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "gpt-5.6-sol", isDefault: true })]),
    );
    expect(events.at(-1)).toMatchObject({
      payload: { turn: { status: "completed" } },
      type: "turn.completed",
    });
  });

  it("submits and interrupts a running turn through the full mutation path", async () => {
    const runtime = await startCodexAppServer({
      binaryPath: fakeAppServerPath,
      env: { ...process.env, FAKE_APP_SERVER_SCENARIO: "agent-actions" },
      rpcTimeoutMs: 1_000,
      shutdownTimeoutMs: 200,
    });
    runtimes.push(runtime);
    const provider = createCodexAgentProvider({ client: runtime.client, project });
    const server = await createCodeAgentServer({
      eventSessionId: "action-interrupt-session",
      project,
      provider,
    });
    servers.push(server);
    const baseUrl = await server.listen({ host: "127.0.0.1", port: 0 });
    const client = new CodeAgentClient({ baseUrl });
    const created = await client.startTask(project.id, { idempotencyKey: "create-interrupt" });
    const snapshot = await client.readTask(created.task.id);
    const events: AgentEvent[] = [];

    const interrupted = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Timed out waiting for interruption"));
      }, 2_000);
      const unsubscribe = client.subscribeEvents({
        afterSequence: snapshot.checkpoint.sequence,
        onError: reject,
        onEvent(event) {
          if (event.taskId !== created.task.id) {
            return;
          }
          events.push(event);
          if (event.type === "turn.completed") {
            clearTimeout(timeout);
            unsubscribe();
            resolve();
          }
        },
        onResyncRequired(message) {
          reject(new Error(`Unexpected resync: ${message.reason}`));
        },
        sessionId: snapshot.checkpoint.sessionId,
      });
    });

    const started = await client.startTurn(
      created.task.id,
      { attachments: [], text: "等待中断", type: "prompt" },
      turnOptions,
      { idempotencyKey: "turn-interrupt" },
    );
    await client.interruptTurn(created.task.id, started.turn.id, {
      idempotencyKey: "interrupt-turn",
    });
    await interrupted;

    expect(events.map((event) => event.type)).toEqual(["turn.started", "turn.completed"]);
    expect(events.at(-1)).toMatchObject({
      payload: { turn: { status: "interrupted" } },
      type: "turn.completed",
    });
  });
});
