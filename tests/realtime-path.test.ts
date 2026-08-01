import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { CodeAgentClient } from "@code-agent/client";
import type {
  AgentEvent,
  AgentGlobalSettings,
  AgentProjectDefaults,
  AgentTaskSettings,
} from "@code-agent/protocol";
import {
  CodexAppServerProcess,
  SUPPORTED_CODEX_VERSION,
  createCodexRuntimeProvider,
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
  approvalsReviewer: "user",
  model: "gpt-5.6-sol",
  reasoningEffort: "high",
  sandboxMode: "workspace-write",
} as const;

const runtimes: CodexAppServerProcess[] = [];
const servers: Awaited<ReturnType<typeof createCodeAgentServer>>[] = [];

async function startFakeAppServer(scenario: string): Promise<CodexAppServerProcess> {
  // Fake Server 是 Node.js 脚本，Windows 必须通过原生 node.exe 启动。
  const child = spawn(process.execPath, [fakeAppServerPath, "app-server", "--listen", "stdio://"], {
    env: { ...process.env, FAKE_APP_SERVER_SCENARIO: scenario },
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const runtime = new CodexAppServerProcess(
    child,
    { path: process.execPath, source: "explicit" },
    { raw: `codex-cli ${SUPPORTED_CODEX_VERSION}`, version: SUPPORTED_CODEX_VERSION },
    { rpcTimeoutMs: 1_000, shutdownTimeoutMs: 200 },
  );
  try {
    await runtime.waitForSpawn();
    await runtime.client.request("initialize", {
      capabilities: { experimentalApi: true },
      clientInfo: { name: "code_agent", title: "CodeAgent", version: "0.0.0" },
    });
    runtime.client.notify("initialized", {});
    runtimes.push(runtime);
    return runtime;
  } catch (error) {
    await runtime.close();
    throw error;
  }
}

function createServerOptions(provider: ReturnType<typeof createCodexRuntimeProvider>) {
  let globalSettings: AgentGlobalSettings | undefined;
  const projectDefaults = new Map<string, AgentProjectDefaults>();
  const pinnedTaskIds = new Map<string, Set<string>>();
  const taskSettings = new Map<string, AgentTaskSettings>();

  return {
    projectRepository: {
      list: () => Promise.resolve([project]),
      read: (projectId: string) => Promise.resolve(projectId === project.id ? project : undefined),
      register: () => Promise.resolve(project),
      remove: () => Promise.resolve(false),
      rename: () => Promise.resolve(undefined),
      reorder: () => Promise.resolve([project]),
    },
    provider,
    selectProjectDirectory: () => Promise.resolve(undefined),
    settingsRepository: {
      readGlobalSettings: () => Promise.resolve(globalSettings),
      readProjectDefaults: (projectId: string) => Promise.resolve(projectDefaults.get(projectId)),
      readTaskSettings: (projectId: string, taskId: string) =>
        Promise.resolve(taskSettings.get(`${projectId}:${taskId}`)),
      writeGlobalSettings: (settings: AgentGlobalSettings) => {
        globalSettings = settings;
        return Promise.resolve(settings);
      },
      writeProjectDefaults: (projectId: string, settings: AgentProjectDefaults) => {
        const defaults = {
          model: settings.model,
          reasoningEffort: settings.reasoningEffort,
          sandboxMode: settings.sandboxMode,
        };
        projectDefaults.set(projectId, defaults);
        return Promise.resolve(defaults);
      },
      writeTaskSettings: (projectId: string, taskId: string, settings: AgentTaskSettings) => {
        taskSettings.set(`${projectId}:${taskId}`, settings);
        return Promise.resolve(settings);
      },
    },
    taskMetadataRepository: {
      listPinnedTaskIds: (projectId: string) =>
        Promise.resolve([...(pinnedTaskIds.get(projectId) ?? [])]),
      writeTaskPinned: (projectId: string, taskId: string, pinned: boolean) => {
        const current = pinnedTaskIds.get(projectId) ?? new Set<string>();
        if (pinned) {
          current.add(taskId);
        } else {
          current.delete(taskId);
        }
        pinnedTaskIds.set(projectId, current);
        return Promise.resolve(pinned);
      },
    },
  };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => server.close()));
  await Promise.all(runtimes.splice(0).map(async (runtime) => runtime.close()));
});

describe("Realtime Path", () => {
  it("delivers Fake App Server notifications through Provider and WebSocket", async () => {
    const runtime = await startFakeAppServer("realtime");
    const provider = createCodexRuntimeProvider({ client: runtime.client });
    const server = await createCodeAgentServer({
      ...createServerOptions(provider),
      eventSessionId: "integration-session",
    });
    servers.push(server);
    const baseUrl = await server.listen({ host: "127.0.0.1", port: 0 });
    const client = new CodeAgentClient({ baseUrl });
    const snapshot = await client.readTask(project.id, "task-realtime");
    const events: AgentEvent[] = [];

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        unsubscribe();
        reject(new Error("Timed out waiting for Fake App Server realtime events"));
      }, 2_000);
      const unsubscribe = client.subscribeEvents({
        afterSequence: snapshot.checkpoint.sequence,
        projectId: project.id,
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
      "item.started",
      "message.delta",
      "item.completed",
      "command.output_delta",
      "item.completed",
      "item.completed",
      "usage.updated",
      "turn.completed",
      "provider.error",
    ]);
    expect(events.find((event) => event.type === "message.delta")).toMatchObject({
      payload: { delta: "Realtime connected" },
    });
    expect(events.find((event) => event.type === "item.started")).toMatchObject({
      payload: {
        item: {
          input: { prompt: "理解前端项目" },
          name: "agent/spawn",
          status: "running",
          type: "tool",
        },
      },
    });
    expect(events.at(-1)).toMatchObject({
      payload: { message: "模型服务不可用", willRetry: false },
      type: "provider.error",
    });
  });

  it("submits a prompt and streams the completed turn through the full mutation path", async () => {
    const runtime = await startFakeAppServer("agent-actions");
    const provider = createCodexRuntimeProvider({ client: runtime.client });
    const server = await createCodeAgentServer({
      ...createServerOptions(provider),
      eventSessionId: "action-complete-session",
    });
    servers.push(server);
    const baseUrl = await server.listen({ host: "127.0.0.1", port: 0 });
    const client = new CodeAgentClient({ baseUrl });
    const models = await client.listModels();
    const created = await client.startTask(project.id, { idempotencyKey: "create-complete" });
    const uploaded = await client.uploadAttachment(
      project.id,
      { dataUrl: pixelDataUrl, kind: "image", name: "screen.png" },
      { idempotencyKey: "upload-complete" },
    );
    const snapshot = await client.readTask(project.id, created.task.id);
    const events: AgentEvent[] = [];

    const completed = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Timed out waiting for turn completion"));
      }, 2_000);
      const unsubscribe = client.subscribeEvents({
        afterSequence: snapshot.checkpoint.sequence,
        projectId: project.id,
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
      project.id,
      created.task.id,
      {
        attachments: [{ id: uploaded.attachment.id }],
        skills: [],
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
      "item.completed",
      "usage.updated",
      "turn.completed",
    ]);
    expect(events.find((event) => event.type === "message.delta")).toMatchObject({
      payload: { delta: "流式回复完成" },
    });
    expect(models.data).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "gpt-5.6-sol", isDefault: true })]),
    );
    expect(events.at(-1)).toMatchObject({
      payload: { turn: { status: "completed" } },
      type: "turn.completed",
    });
  });

  it("submits and interrupts a running turn through the full mutation path", async () => {
    const runtime = await startFakeAppServer("agent-actions");
    const provider = createCodexRuntimeProvider({ client: runtime.client });
    const server = await createCodeAgentServer({
      ...createServerOptions(provider),
      eventSessionId: "action-interrupt-session",
    });
    servers.push(server);
    const baseUrl = await server.listen({ host: "127.0.0.1", port: 0 });
    const client = new CodeAgentClient({ baseUrl });
    const created = await client.startTask(project.id, { idempotencyKey: "create-interrupt" });
    const snapshot = await client.readTask(project.id, created.task.id);
    const events: AgentEvent[] = [];

    const interrupted = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Timed out waiting for interruption"));
      }, 2_000);
      const unsubscribe = client.subscribeEvents({
        afterSequence: snapshot.checkpoint.sequence,
        projectId: project.id,
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
      project.id,
      created.task.id,
      { attachments: [], skills: [], text: "等待中断", type: "prompt" },
      turnOptions,
      { idempotencyKey: "turn-interrupt" },
    );
    await client.interruptTurn(project.id, created.task.id, started.turn.id, {
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
