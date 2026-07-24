import {
  PendingRequestResolutionError,
  type AgentProvider,
  type AgentProviderEvent,
  type AgentProviderTurnInput,
} from "@code-agent/core";
import type { AgentTaskSnapshot, AgentTurn, PendingRequest } from "@code-agent/protocol";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createCodeAgentServer } from "./app.js";

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

function turnRequest(text: string) {
  return {
    input: { attachments: [], text, type: "prompt" as const },
    options: turnOptions,
  };
}

const task = {
  id: "task-1",
  pinned: false,
  projectId: "code-agent",
  title: "结构化历史",
  updatedAt: "2026-07-23T00:01:00.000Z",
} as const;

const snapshot = {
  ...task,
  contextUsage: null,
  pendingRequests: [],
  status: "idle" as const,
  turns: [],
};

const pendingRequest = {
  availableDecisions: ["allow", "allow_for_session", "deny"],
  command: "pnpm check",
  createdAt: "2026-07-23T00:02:00.000Z",
  cwd: "/workspace/CodeAgent",
  expiresAt: null,
  itemId: "command-1",
  networkAccess: null,
  projectId: "code-agent",
  reason: "需要执行检查",
  requestId: "number:7",
  status: "pending",
  taskId: "task-1",
  turnId: "turn-1",
  type: "command_approval",
} as const satisfies PendingRequest;

const closeCallbacks: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closeCallbacks.splice(0).map((close) => close()));
});

function createProvider() {
  const eventListeners = new Set<(event: AgentProviderEvent) => void>();
  const getCapabilities = vi.fn(() =>
    Promise.resolve({
      provider: "codex",
      tasks: { list: true, read: true, start: true },
      turns: { interrupt: true, start: true },
    }),
  );
  const listTasks = vi.fn(() => Promise.resolve({ data: [task], nextCursor: "next" }));
  const listModels = vi.fn(() =>
    Promise.resolve({
      data: [
        {
          defaultReasoningEffort: "high",
          description: "适合复杂编码任务",
          displayName: "GPT-5.6 Sol",
          id: "gpt-5.6-sol",
          isDefault: true,
          supportedReasoningEfforts: [{ description: "深入分析", id: "high" }],
        },
      ],
      nextCursor: null,
    }),
  );
  const readTask = vi.fn<(taskId: string) => Promise<AgentTaskSnapshot | undefined>>((taskId) =>
    Promise.resolve(taskId === task.id ? snapshot : undefined),
  );
  const resolvePendingRequest = vi.fn(() =>
    Promise.resolve({ ...pendingRequest, status: "resolved" as const }),
  );
  const startTask = vi.fn(() => Promise.resolve(task));
  const startTurn = vi.fn((taskId: string, input: AgentProviderTurnInput) =>
    Promise.resolve({
      completedAt: null,
      error: null,
      id: "turn-1",
      items: [{ id: "input-1", role: "user" as const, text: input.text, type: "message" as const }],
      startedAt: "2026-07-23T00:02:00.000Z",
      status: "running" as const,
    }),
  );
  const interruptTurn = vi.fn(() => Promise.resolve());
  const provider: AgentProvider = {
    getCapabilities,
    interruptTurn,
    listModels,
    listTasks,
    readTask,
    resolvePendingRequest,
    startTask,
    startTurn,
    subscribeEvents(listener) {
      eventListeners.add(listener);
      return () => {
        eventListeners.delete(listener);
      };
    },
  };
  return {
    emitEvent: (event: AgentProviderEvent) => {
      for (const listener of eventListeners) {
        listener(event);
      }
    },
    eventListeners,
    listTasks,
    listModels,
    interruptTurn,
    provider,
    readTask,
    resolvePendingRequest,
    startTask,
    startTurn,
  };
}

async function createHarness(options: Readonly<{ idempotencyCacheSize?: number }> = {}) {
  const {
    emitEvent,
    eventListeners,
    interruptTurn,
    listTasks,
    listModels,
    provider,
    readTask,
    resolvePendingRequest,
    startTask,
    startTurn,
  } = createProvider();
  const app = await createCodeAgentServer({ ...options, project, provider });
  closeCallbacks.push(() => app.close());
  return {
    app,
    emitEvent,
    eventListeners,
    interruptTurn,
    listTasks,
    listModels,
    readTask,
    resolvePendingRequest,
    startTask,
    startTurn,
  };
}

describe("CodeAgent Server", () => {
  it("serves health, capabilities, and projects", async () => {
    const { app } = await createHarness();

    const healthResponse = await app.inject({ method: "GET", url: "/v1/health" });
    const capabilitiesResponse = await app.inject({ method: "GET", url: "/v1/capabilities" });
    const projectsResponse = await app.inject({ method: "GET", url: "/v1/projects" });

    expect(healthResponse.json()).toEqual({
      status: "ok",
      version: 1,
    });
    expect(capabilitiesResponse.json()).toEqual({
      provider: "codex",
      tasks: { list: true, read: true, start: true },
      turns: { interrupt: true, start: true },
    });
    expect(projectsResponse.json()).toEqual({ data: [project], nextCursor: null });
  });

  it("serves the configured project's Git working tree status", async () => {
    const { provider } = createProvider();
    const readProjectGitStatus = vi.fn(() =>
      Promise.resolve({
        staged: [
          {
            diff: "--- a/staged.ts\n+++ b/staged.ts\n@@ -1 +1 @@\n-old\n+new",
            kind: "update" as const,
            path: "staged.ts",
          },
        ],
        unstaged: [],
      }),
    );
    const app = await createCodeAgentServer({ project, provider, readProjectGitStatus });
    closeCallbacks.push(() => app.close());

    const response = await app.inject({
      method: "GET",
      url: "/v1/projects/code-agent/git/status",
    });
    const missingProjectResponse = await app.inject({
      method: "GET",
      url: "/v1/projects/other/git/status",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ staged: [{ path: "staged.ts" }], unstaged: [] });
    expect(readProjectGitStatus).toHaveBeenCalledWith(project.rootPath);
    expect(missingProjectResponse.statusCode).toBe(404);
    expect(readProjectGitStatus).toHaveBeenCalledTimes(1);
  });

  it("serves models and resolves uploaded attachments before starting a turn", async () => {
    const { app, listModels, startTurn } = await createHarness();
    const models = await app.inject({ method: "GET", url: "/v1/models" });
    const uploadRequest = {
      headers: { "idempotency-key": "upload-1" },
      method: "POST" as const,
      payload: { dataUrl: pixelDataUrl, name: "screen.png" },
      url: "/v1/attachments",
    };
    const uploaded = await app.inject(uploadRequest);
    const repeatedUpload = await app.inject(uploadRequest);
    const attachment = uploaded.json<{ attachment: { id: string } }>().attachment;
    const turn = await app.inject({
      headers: { "idempotency-key": "attachment-turn" },
      method: "POST",
      payload: {
        input: { attachments: [{ id: attachment.id }], text: "", type: "prompt" },
        options: turnOptions,
      },
      url: "/v1/tasks/task-1/turns",
    });
    const consumed = await app.inject({
      headers: { "idempotency-key": "attachment-consumed" },
      method: "POST",
      payload: {
        input: { attachments: [{ id: attachment.id }], text: "", type: "prompt" },
        options: turnOptions,
      },
      url: "/v1/tasks/task-1/turns",
    });

    expect(models.statusCode).toBe(200);
    expect(models.json()).toMatchObject({ data: [{ id: "gpt-5.6-sol", isDefault: true }] });
    expect(listModels).toHaveBeenCalledTimes(1);
    expect(uploaded.statusCode).toBe(201);
    expect(repeatedUpload.json()).toEqual(uploaded.json());
    expect(uploaded.json()).toMatchObject({
      attachment: { mediaType: "image/png", name: "screen.png", size: 68 },
    });
    expect(turn.statusCode).toBe(201);
    expect(startTurn).toHaveBeenCalledWith(
      "task-1",
      { images: [{ mediaType: "image/png", url: pixelDataUrl }], text: "" },
      turnOptions,
    );
    expect(consumed.statusCode).toBe(404);
    expect(consumed.json()).toMatchObject({ code: "ATTACHMENT_NOT_FOUND" });
  });

  it("lists project tasks with validated pagination", async () => {
    const { app, listTasks } = await createHarness();
    const response = await app.inject({
      method: "GET",
      url: "/v1/projects/code-agent/tasks?cursor=cursor&limit=25",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: [task], nextCursor: "next" });
    expect(listTasks).toHaveBeenCalledWith({ cursor: "cursor", limit: 25 });
  });

  it("reads a structured task snapshot", async () => {
    const { app } = await createHarness();
    const response = await app.inject({ method: "GET", url: "/v1/tasks/task-1" });
    const body = response.json<{
      checkpoint: { sequence: number; sessionId: unknown };
      snapshot: typeof snapshot;
    }>();

    expect(response.statusCode).toBe(200);
    expect(body.checkpoint.sequence).toBe(0);
    expect(typeof body.checkpoint.sessionId).toBe("string");
    expect(body.snapshot).toEqual(snapshot);
  });

  it("serves idempotent task and turn mutations", async () => {
    const { app, interruptTurn, readTask, startTask, startTurn } = await createHarness();
    const headers = { "idempotency-key": "mutation-1" };

    const created = await app.inject({
      headers,
      method: "POST",
      payload: {},
      url: "/v1/projects/code-agent/tasks",
    });
    const repeated = await app.inject({
      headers,
      method: "POST",
      payload: {},
      url: "/v1/projects/code-agent/tasks",
    });
    const turn = await app.inject({
      headers: { "idempotency-key": "turn-1" },
      method: "POST",
      payload: turnRequest("继续实现"),
      url: "/v1/tasks/task-1/turns",
    });
    const turnBody = turn.json<{ taskId: string; turn: AgentTurn }>();
    readTask.mockResolvedValueOnce({
      ...snapshot,
      status: "running",
      turns: [turnBody.turn],
    });
    const interrupted = await app.inject({
      headers: { "idempotency-key": "interrupt-1" },
      method: "POST",
      payload: { taskId: "task-1" },
      url: "/v1/turns/turn-1/interrupt",
    });

    expect(created.statusCode).toBe(201);
    expect(repeated.json()).toEqual(created.json());
    expect(startTask).toHaveBeenCalledTimes(1);
    expect(turn.statusCode).toBe(201);
    expect(turn.json()).toMatchObject({ taskId: "task-1", turn: { id: "turn-1" } });
    expect(startTurn).toHaveBeenCalledWith("task-1", { images: [], text: "继续实现" }, turnOptions);
    expect(interrupted.statusCode).toBe(202);
    expect(interrupted.json()).toEqual({
      status: "interrupting",
      taskId: "task-1",
      turnId: "turn-1",
    });
    expect(interruptTurn).toHaveBeenCalledWith("task-1", "turn-1");

    readTask.mockResolvedValueOnce({
      ...snapshot,
      turns: [{ ...turnBody.turn, completedAt: "2026-07-23T00:03:00.000Z", status: "interrupted" }],
    });
    const replayedInterrupt = await app.inject({
      headers: { "idempotency-key": "interrupt-1" },
      method: "POST",
      payload: { taskId: "task-1" },
      url: "/v1/turns/turn-1/interrupt",
    });

    expect(replayedInterrupt.statusCode).toBe(202);
    expect(replayedInterrupt.json()).toEqual(interrupted.json());
    expect(interruptTurn).toHaveBeenCalledTimes(1);
  });

  it("resolves pending requests idempotently with complete identity validation", async () => {
    const { app, resolvePendingRequest } = await createHarness();
    const request = {
      headers: { "idempotency-key": "resolve-1" },
      method: "POST" as const,
      payload: {
        itemId: pendingRequest.itemId,
        projectId: pendingRequest.projectId,
        resolution: { decision: "allow_for_session" },
        taskId: pendingRequest.taskId,
        turnId: pendingRequest.turnId,
        type: pendingRequest.type,
      },
      url: `/v1/pending-requests/${encodeURIComponent(pendingRequest.requestId)}/resolve`,
    };

    const first = await app.inject(request);
    const repeated = await app.inject(request);

    expect(first.statusCode).toBe(200);
    expect(repeated.json()).toEqual(first.json());
    expect(first.json()).toEqual({ request: { ...pendingRequest, status: "resolved" } });
    expect(resolvePendingRequest).toHaveBeenCalledTimes(1);
    expect(resolvePendingRequest).toHaveBeenCalledWith({
      ...request.payload,
      requestId: pendingRequest.requestId,
    });
  });

  it("rejects cross-project and stale pending request resolutions", async () => {
    const { app, resolvePendingRequest } = await createHarness();
    const request = {
      headers: { "idempotency-key": "resolve-invalid" },
      method: "POST" as const,
      payload: {
        itemId: pendingRequest.itemId,
        projectId: "other-project",
        resolution: { decision: "deny" },
        taskId: pendingRequest.taskId,
        turnId: pendingRequest.turnId,
        type: pendingRequest.type,
      },
      url: `/v1/pending-requests/${encodeURIComponent(pendingRequest.requestId)}/resolve`,
    };
    const crossProject = await app.inject(request);
    expect(crossProject.statusCode).toBe(404);
    expect(crossProject.json()).toMatchObject({ code: "PROJECT_NOT_FOUND" });
    expect(resolvePendingRequest).not.toHaveBeenCalled();

    resolvePendingRequest.mockRejectedValueOnce(
      new PendingRequestResolutionError("mismatch", "identity mismatch"),
    );
    const mismatch = await app.inject({
      ...request,
      headers: { "idempotency-key": "resolve-mismatch" },
      payload: { ...request.payload, projectId: pendingRequest.projectId, taskId: "other-task" },
    });
    expect(mismatch.statusCode).toBe(409);
    expect(mismatch.json()).toMatchObject({ code: "PENDING_REQUEST_MISMATCH" });

    resolvePendingRequest.mockRejectedValueOnce(
      new PendingRequestResolutionError("expired", "request expired"),
    );
    const expired = await app.inject({
      ...request,
      headers: { "idempotency-key": "resolve-expired" },
      payload: { ...request.payload, projectId: pendingRequest.projectId },
    });
    expect(expired.statusCode).toBe(409);
    expect(expired.json()).toMatchObject({ code: "PENDING_REQUEST_EXPIRED" });
  });

  it("reuses idempotent results for equivalent payload key orders", async () => {
    const { app, startTurn } = await createHarness();
    const headers = {
      "content-type": "application/json",
      "idempotency-key": "equivalent-payload",
    };
    const first = await app.inject({
      headers,
      method: "POST",
      payload:
        '{"input":{"attachments":[],"text":"继续实现","type":"prompt"},"options":{"approvalPolicy":"on-request","model":"gpt-5.6-sol","reasoningEffort":"high"}}',
      url: "/v1/tasks/task-1/turns",
    });
    const repeated = await app.inject({
      headers,
      method: "POST",
      payload:
        '{"options":{"reasoningEffort":"high","model":"gpt-5.6-sol","approvalPolicy":"on-request"},"input":{"type":"prompt","text":"继续实现","attachments":[]}}',
      url: "/v1/tasks/task-1/turns",
    });

    expect(first.statusCode).toBe(201);
    expect(repeated.statusCode).toBe(201);
    expect(repeated.json()).toEqual(first.json());
    expect(startTurn).toHaveBeenCalledTimes(1);
  });

  it("keeps idempotency scopes distinct when resource IDs and keys contain separators", async () => {
    const { app, readTask, startTurn } = await createHarness();
    readTask.mockImplementation((taskId) =>
      Promise.resolve({ ...snapshot, id: taskId, turns: [] }),
    );
    const payload = turnRequest("继续实现");

    const first = await app.inject({
      headers: { "idempotency-key": "b:c" },
      method: "POST",
      payload,
      url: "/v1/tasks/task%3Aa/turns",
    });
    const second = await app.inject({
      headers: { "idempotency-key": "c" },
      method: "POST",
      payload,
      url: "/v1/tasks/task%3Aa%3Ab/turns",
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(startTurn).toHaveBeenNthCalledWith(
      1,
      "task:a",
      { images: [], text: payload.input.text },
      payload.options,
    );
    expect(startTurn).toHaveBeenNthCalledWith(
      2,
      "task:a:b",
      { images: [], text: payload.input.text },
      payload.options,
    );
  });

  it("evicts completed idempotency entries when the cache reaches its limit", async () => {
    const { app, startTask } = await createHarness({ idempotencyCacheSize: 1 });
    const createTask = (key: string) =>
      app.inject({
        headers: { "idempotency-key": key },
        method: "POST",
        payload: {},
        url: "/v1/projects/code-agent/tasks",
      });

    await createTask("task-key-1");
    await createTask("task-key-2");
    await createTask("task-key-1");

    expect(startTask).toHaveBeenCalledTimes(3);
  });

  it("rejects interruption for a terminal or unrelated turn", async () => {
    const { app, interruptTurn, readTask } = await createHarness();
    readTask.mockResolvedValueOnce({
      ...snapshot,
      turns: [
        {
          completedAt: "2026-07-23T00:03:00.000Z",
          error: null,
          id: "turn-completed",
          items: [],
          startedAt: "2026-07-23T00:02:00.000Z",
          status: "completed" as const,
        },
      ],
    });
    const terminal = await app.inject({
      headers: { "idempotency-key": "terminal-turn" },
      method: "POST",
      payload: { taskId: "task-1" },
      url: "/v1/turns/turn-completed/interrupt",
    });
    readTask.mockResolvedValueOnce(snapshot);
    const missing = await app.inject({
      headers: { "idempotency-key": "missing-turn" },
      method: "POST",
      payload: { taskId: "task-1" },
      url: "/v1/turns/turn-missing/interrupt",
    });

    expect(terminal.statusCode).toBe(409);
    expect(terminal.json()).toMatchObject({ code: "TURN_NOT_RUNNING" });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ code: "TURN_NOT_FOUND" });
    expect(interruptTurn).not.toHaveBeenCalled();
  });

  it("validates idempotency keys and rejects conflicting payloads", async () => {
    const { app, startTurn } = await createHarness();
    const missingKey = await app.inject({
      method: "POST",
      payload: {},
      url: "/v1/projects/code-agent/tasks",
    });
    const first = await app.inject({
      headers: { "idempotency-key": "turn-conflict" },
      method: "POST",
      payload: turnRequest("第一次"),
      url: "/v1/tasks/task-1/turns",
    });
    const conflict = await app.inject({
      headers: { "idempotency-key": "turn-conflict" },
      method: "POST",
      payload: turnRequest("第二次"),
      url: "/v1/tasks/task-1/turns",
    });

    expect(missingKey.statusCode).toBe(400);
    expect(missingKey.json()).toMatchObject({
      code: "IDEMPOTENCY_KEY_REQUIRED",
      retryable: false,
    });
    expect(first.statusCode).toBe(201);
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ code: "IDEMPOTENCY_CONFLICT", retryable: false });
    expect(startTurn).toHaveBeenCalledTimes(1);
  });

  it("normalizes provider failures without caching them", async () => {
    const { app, startTask } = await createHarness();
    startTask.mockRejectedValueOnce(new Error("native RPC details"));
    const request = {
      headers: { "idempotency-key": "retry-task" },
      method: "POST" as const,
      payload: {},
      url: "/v1/projects/code-agent/tasks",
    };

    const failed = await app.inject(request);
    const retried = await app.inject(request);

    expect(failed.statusCode).toBe(502);
    expect(failed.json()).toEqual({
      code: "PROVIDER_ERROR",
      message: "Agent provider request failed",
      retryable: true,
    });
    expect(retried.statusCode).toBe(201);
    expect(startTask).toHaveBeenCalledTimes(2);
  });

  it("captures the checkpoint after reading a task snapshot", async () => {
    const harness = createProvider();
    const snapshotDuringRead = {
      ...snapshot,
      status: "running" as const,
      turns: [
        {
          completedAt: null,
          error: null,
          id: "turn-1",
          items: [
            {
              id: "item-1",
              role: "assistant" as const,
              text: "读取期间到达",
              type: "message" as const,
            },
          ],
          startedAt: "2026-07-23T00:01:00.000Z",
          status: "running" as const,
        },
      ],
    };
    const provider: AgentProvider = {
      ...harness.provider,
      readTask: vi.fn((taskId: string) => {
        harness.emitEvent({
          itemId: "item-1",
          payload: { delta: "读取期间到达" },
          taskId,
          turnId: "turn-1",
          type: "message.delta",
        });
        return Promise.resolve(snapshotDuringRead);
      }),
    };
    const app = await createCodeAgentServer({ project, provider });
    closeCallbacks.push(() => app.close());

    const response = await app.inject({ method: "GET", url: "/v1/tasks/task-1" });

    expect(response.json()).toMatchObject({
      checkpoint: { sequence: 1 },
      snapshot: snapshotDuringRead,
    });
  });

  it("streams ready and realtime Agent Events over WebSocket", async () => {
    const { app, emitEvent } = await createHarness();
    const messages: unknown[] = [];
    const socket = await app.injectWS(
      "/v1/events?afterSequence=0",
      { headers: { host: "127.0.0.1:3210", origin: "http://127.0.0.1:3210" } },
      {
        onInit(webSocket) {
          webSocket.on("message", (data: { toString(): string }) => {
            messages.push(JSON.parse(data.toString()) as unknown);
          });
        },
      },
    );

    await vi.waitFor(() => {
      expect(messages).toHaveLength(1);
    });
    emitEvent({
      itemId: "item-1",
      payload: { delta: "实时更新" },
      taskId: "task-1",
      turnId: "turn-1",
      type: "message.delta",
    });
    await vi.waitFor(() => {
      expect(messages).toHaveLength(2);
    });

    expect(messages[0]).toMatchObject({
      latestSequence: 0,
      type: "connection.ready",
      version: 1,
    });
    expect(typeof (messages[0] as { sessionId: unknown }).sessionId).toBe("string");
    expect(messages[1]).toMatchObject({
      payload: { delta: "实时更新" },
      sequence: 1,
      type: "message.delta",
      version: 1,
    });
    expect(typeof (messages[1] as { sessionId: unknown }).sessionId).toBe("string");
    socket.terminate();
  });

  it("replays retained events and requests resync after retention expires", async () => {
    const harness = createProvider();
    const app = await createCodeAgentServer({
      eventBufferSize: 1,
      project,
      provider: harness.provider,
    });
    closeCallbacks.push(() => app.close());
    const event = {
      itemId: "item-1",
      payload: { delta: "1" },
      taskId: "task-1",
      turnId: "turn-1",
      type: "message.delta",
    } as const;
    harness.emitEvent(event);
    harness.emitEvent({ ...event, payload: { delta: "2" } });

    const replayed: unknown[] = [];
    const replaySocket = await app.injectWS(
      "/v1/events?afterSequence=1",
      { headers: { host: "localhost", origin: "http://localhost" } },
      {
        onInit(webSocket) {
          webSocket.on("message", (data: { toString(): string }) => {
            replayed.push(JSON.parse(data.toString()) as unknown);
          });
        },
      },
    );
    await vi.waitFor(() => {
      expect(replayed).toHaveLength(2);
    });
    expect(replayed[1]).toMatchObject({ payload: { delta: "2" }, sequence: 2 });
    replaySocket.terminate();

    const expired: unknown[] = [];
    const expiredSocket = await app.injectWS(
      "/v1/events?afterSequence=0",
      { headers: { host: "localhost", origin: "http://localhost" } },
      {
        onInit(webSocket) {
          webSocket.on("message", (data: { toString(): string }) => {
            expired.push(JSON.parse(data.toString()) as unknown);
          });
        },
      },
    );
    await vi.waitFor(() => {
      expect(expired).toHaveLength(1);
    });
    expect(expired[0]).toMatchObject({
      latestSequence: 2,
      reason: "event_retention_exceeded",
      type: "resync.required",
    });
    await vi.waitFor(() => {
      expect(expiredSocket.readyState).toBe(expiredSocket.CLOSED);
    });
  });

  it("rejects invalid event queries and cross-origin WebSockets", async () => {
    const { app } = await createHarness();

    await expect(app.injectWS("/v1/events?afterSequence=-1")).rejects.toThrow(
      /Unexpected server response: 400/u,
    );
    await expect(
      app.injectWS("/v1/events?afterSequence=0", {
        headers: { host: "localhost", origin: "http://attacker.example" },
      }),
    ).rejects.toThrow(/Unexpected server response: 403/u);
  });

  it("unsubscribes from Provider events when Fastify closes", async () => {
    const { app, eventListeners } = await createHarness();
    expect(eventListeners.size).toBe(1);

    await app.close();

    expect(eventListeners.size).toBe(0);
  });

  it("returns 404 for unknown projects and tasks", async () => {
    const { app, listTasks } = await createHarness();
    const projectResponse = await app.inject({
      method: "GET",
      url: "/v1/projects/other/tasks",
    });
    const taskResponse = await app.inject({ method: "GET", url: "/v1/tasks/missing" });

    expect(projectResponse.statusCode).toBe(404);
    expect(taskResponse.statusCode).toBe(404);
    expect(listTasks).not.toHaveBeenCalled();
    expect(taskResponse.json()).toEqual({ code: "TASK_NOT_FOUND", message: "Task not found" });
  });

  it("rejects invalid pagination before calling the provider", async () => {
    const { app, listTasks } = await createHarness();
    const response = await app.inject({
      method: "GET",
      url: "/v1/projects/code-agent/tasks?limit=0",
    });

    expect(response.statusCode).toBe(400);
    expect(listTasks).not.toHaveBeenCalled();
  });

  it("serves static assets and falls back to index.html for SPA routes", async () => {
    const staticRoot = await mkdtemp(join(tmpdir(), "code-agent-web-"));
    await writeFile(join(staticRoot, "index.html"), "<main>CodeAgent Web</main>", "utf8");
    await writeFile(join(staticRoot, "app.js"), "export {};", "utf8");
    const app = await createCodeAgentServer({
      project,
      provider: createProvider().provider,
      staticRoot,
    });
    closeCallbacks.push(() => app.close());

    const routeResponse = await app.inject({ method: "GET", url: "/p/code-agent/t/task-1" });
    const assetResponse = await app.inject({ method: "GET", url: "/app.js" });
    const apiResponse = await app.inject({ method: "GET", url: "/v1/missing" });

    expect(routeResponse.statusCode).toBe(200);
    expect(routeResponse.body).toContain("CodeAgent Web");
    expect(assetResponse.body).toBe("export {};");
    expect(apiResponse.statusCode).toBe(404);
    expect(apiResponse.headers["content-type"]).toContain("application/json");
  });
});
