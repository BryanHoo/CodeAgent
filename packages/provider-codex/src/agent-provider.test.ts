import { describe, expect, it, vi } from "vitest";

import type { AgentProviderEvent, PendingRequestResolutionError } from "@code-agent/core";

import { createCodexAgentProvider, CodexProtocolMappingError } from "./agent-provider.js";
import { RpcResponseError, type RpcRequestId } from "./jsonl-rpc-client.js";

class FakeRpcClient {
  readonly calls: Readonly<{ method: string; params: unknown }>[] = [];
  readonly notifications: Readonly<{ method: string; params: unknown }>[] = [];
  readonly serverErrors: Readonly<{
    error: { code: number; data: unknown; message: string };
    id: RpcRequestId;
  }>[] = [];
  readonly serverResponses: Readonly<{ id: RpcRequestId; result: unknown }>[] = [];
  readonly #notificationListeners = new Set<
    (notification: { method: string; params: unknown }) => void
  >();
  readonly #serverRequestListeners = new Set<
    (request: { id: RpcRequestId; method: string; params: unknown }) => void
  >();
  readonly #responses: unknown[];
  readonly #serverResponseBehavior: Promise<void> | (() => Promise<void>) | undefined;

  public constructor(
    responses: unknown[],
    serverResponseBehavior?: Promise<void> | (() => Promise<void>),
  ) {
    this.#responses = [...responses];
    this.#serverResponseBehavior = serverResponseBehavior;
  }

  public request(method: string, params?: unknown): Promise<unknown> {
    this.calls.push({ method, params });
    const response = this.#responses.shift();
    const resolved = typeof response === "function" ? (response as () => unknown)() : response;
    return resolved instanceof Error ? Promise.reject(resolved) : Promise.resolve(resolved);
  }

  public notify(method: string, params?: unknown): void {
    this.notifications.push({ method, params });
  }

  public onNotification(
    listener: (notification: { method: string; params: unknown }) => void,
  ): () => void {
    this.#notificationListeners.add(listener);
    return () => {
      this.#notificationListeners.delete(listener);
    };
  }

  public emitNotification(method: string, params?: unknown): void {
    for (const listener of this.#notificationListeners) {
      listener({ method, params });
    }
  }

  public onServerRequest(
    listener: (request: { id: RpcRequestId; method: string; params: unknown }) => void,
  ): () => void {
    this.#serverRequestListeners.add(listener);
    return () => {
      this.#serverRequestListeners.delete(listener);
    };
  }

  public async respondToServerRequest(id: RpcRequestId, result: unknown): Promise<void> {
    this.serverResponses.push({ id, result });
    await (typeof this.#serverResponseBehavior === "function"
      ? this.#serverResponseBehavior()
      : this.#serverResponseBehavior);
  }

  public rejectServerRequest(
    id: RpcRequestId,
    error: { code: number; data: unknown; message: string },
  ): Promise<void> {
    this.serverErrors.push({ error, id });
    return Promise.resolve();
  }

  public emitServerRequest(id: RpcRequestId, method: string, params: unknown): void {
    for (const listener of this.#serverRequestListeners) {
      listener({ id, method, params });
    }
  }
}

const project = {
  createdAt: "2026-07-23T00:00:00.000Z",
  id: "code-agent",
  name: "CodeAgent",
  rootPath: "/workspace/CodeAgent",
} as const;

function nativeThread(overrides: Record<string, unknown> = {}) {
  return {
    cliVersion: "0.145.0",
    createdAt: 1_753_228_800,
    cwd: "/workspace/CodeAgent",
    ephemeral: false,
    id: "task-1",
    modelProvider: "openai",
    name: null,
    preview: "实现真实 Task 历史\n更多内容",
    sessionId: "native-session",
    source: "cli",
    status: { type: "notLoaded" },
    turns: [],
    updatedAt: 1_753_232_400,
    ...overrides,
  };
}

describe("CodexAgentProvider", () => {
  it("rolls back exactly the latest Codex turn", async () => {
    const rpc = new FakeRpcClient([
      { data: [nativeThread()], nextCursor: null },
      { thread: nativeThread({ turns: [] }) },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    await provider.listTasks();

    await expect(provider.rollbackLatestTurn("task-1")).resolves.toBeUndefined();
    expect(rpc.calls.at(-1)).toEqual({
      method: "thread/rollback",
      params: { numTurns: 1, threadId: "task-1" },
    });
  });

  it("rejects malformed Codex rollback responses", async () => {
    const rpc = new FakeRpcClient([
      { data: [nativeThread()], nextCursor: null },
      { thread: nativeThread({ id: "another-task", turns: [] }) },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    await provider.listTasks();

    await expect(provider.rollbackLatestTurn("task-1")).rejects.toThrow(
      "thread/rollback returned a different thread",
    );
  });

  it("rejects unsupported server request methods instead of leaving Codex blocked", async () => {
    const rpc = new FakeRpcClient([{ data: [nativeThread()], nextCursor: null }]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    await provider.listTasks();

    rpc.emitServerRequest("unsupported-request", "item/tool/futureApproval", {
      threadId: "task-1",
    });
    await Promise.resolve();

    expect(rpc.serverErrors).toEqual([
      {
        error: {
          code: -32601,
          data: { method: "item/tool/futureApproval" },
          message: "Method not found",
        },
        id: "unsupported-request",
      },
    ]);
  });

  it("rejects user input questions that have no available answer", async () => {
    const rpc = new FakeRpcClient([{ data: [nativeThread()], nextCursor: null }]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    const events: AgentProviderEvent[] = [];
    provider.subscribeEvents((event) => events.push(event));
    await provider.listTasks();

    rpc.emitServerRequest("empty-choice", "item/tool/requestUserInput", {
      autoResolutionMs: null,
      itemId: "empty-choice-item",
      questions: [
        {
          header: "模式",
          id: "mode",
          isOther: false,
          isSecret: false,
          options: [],
          question: "下一步怎么处理？",
        },
      ],
      threadId: "task-1",
      turnId: "turn-1",
    });
    await Promise.resolve();

    expect(events).toEqual([]);
    expect(rpc.serverErrors).toEqual([
      {
        error: {
          code: -32602,
          data: { method: "item/tool/requestUserInput" },
          message: "Invalid params",
        },
        id: "empty-choice",
      },
    ]);
  });

  it("maps, restores, and resolves approval server requests", async () => {
    const rpc = new FakeRpcClient([
      { data: [nativeThread()], nextCursor: null },
      { thread: nativeThread({ status: { type: "active" } }) },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    const events: unknown[] = [];
    provider.subscribeEvents((event) => {
      events.push(event);
    });
    await provider.listTasks();

    rpc.emitServerRequest(7, "item/commandExecution/requestApproval", {
      availableDecisions: ["accept", "acceptForSession", "decline"],
      command: "pnpm check",
      cwd: "/workspace/CodeAgent",
      itemId: "command-1",
      networkApprovalContext: { host: "api.example.com", protocol: "https" },
      reason: "需要执行检查",
      startedAtMs: 1_753_228_800_000,
      threadId: "task-1",
      turnId: "turn-1",
    });

    const snapshot = await provider.readTask("task-1");
    const request = snapshot?.pendingRequests[0];
    expect(request).toMatchObject({
      availableDecisions: ["allow", "allow_for_session", "deny"],
      command: "pnpm check",
      itemId: "command-1",
      networkAccess: { host: "api.example.com", protocol: "https" },
      projectId: "code-agent",
      requestId: "number:7",
      status: "pending",
      taskId: "task-1",
      turnId: "turn-1",
      type: "command_approval",
    });
    if (request?.type !== "command_approval") {
      throw new Error("Expected a pending command approval");
    }

    await expect(
      provider.resolvePendingRequest({
        itemId: request.itemId,
        projectId: request.projectId,
        requestId: request.requestId,
        resolution: { decision: "allow_for_session" },
        taskId: request.taskId,
        turnId: request.turnId,
        type: request.type,
      }),
    ).resolves.toMatchObject({ requestId: "number:7", status: "resolved" });
    expect(rpc.serverResponses).toEqual([{ id: 7, result: { decision: "acceptForSession" } }]);
    await expect(
      provider.resolvePendingRequest({
        itemId: request.itemId,
        projectId: request.projectId,
        requestId: request.requestId,
        resolution: { decision: "deny" },
        taskId: request.taskId,
        turnId: request.turnId,
        type: request.type,
      }),
    ).rejects.toMatchObject({ code: "resolved" } satisfies Partial<PendingRequestResolutionError>);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: "pending_request.created" });
    expect(events[1]).toMatchObject({
      payload: { request: { status: "resolved" } },
      type: "pending_request.resolved",
    });
  });

  it("reuses matching concurrent resolutions and rejects conflicting decisions", async () => {
    let releaseResponse: () => void = () => undefined;
    const responseGate = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    const rpc = new FakeRpcClient(
      [
        { data: [nativeThread()], nextCursor: null },
        { thread: nativeThread({ status: { type: "active" } }) },
      ],
      responseGate,
    );
    const provider = createCodexAgentProvider({ client: rpc, project });
    await provider.listTasks();
    rpc.emitServerRequest(7, "item/commandExecution/requestApproval", {
      availableDecisions: ["accept", "decline"],
      command: "pnpm check",
      cwd: "/workspace/CodeAgent",
      itemId: "command-1",
      reason: null,
      startedAtMs: 1_753_228_800_000,
      threadId: "task-1",
      turnId: "turn-1",
    });
    const request = (await provider.readTask("task-1"))?.pendingRequests[0];
    if (request?.type !== "command_approval") {
      throw new Error("Expected a pending command approval");
    }
    const input = {
      itemId: request.itemId,
      projectId: request.projectId,
      requestId: request.requestId,
      taskId: request.taskId,
      turnId: request.turnId,
      type: request.type,
    } as const;

    const first = provider.resolvePendingRequest({
      ...input,
      resolution: { decision: "allow" },
    });
    const repeated = provider.resolvePendingRequest({
      ...input,
      resolution: { decision: "allow" },
    });
    const conflicting = provider.resolvePendingRequest({
      ...input,
      resolution: { decision: "deny" },
    });
    await Promise.resolve();
    releaseResponse();
    await expect(Promise.all([first, repeated])).resolves.toEqual([
      expect.objectContaining({ status: "resolved" }),
      expect.objectContaining({ status: "resolved" }),
    ]);
    await expect(conflicting).rejects.toMatchObject({
      code: "resolved",
    } satisfies Partial<PendingRequestResolutionError>);

    expect(rpc.serverResponses).toEqual([{ id: 7, result: { decision: "accept" } }]);
  });

  it("keeps a local resolution resolved when Codex confirms it before the write callback", async () => {
    let releaseResponse: () => void = () => undefined;
    const responseGate = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    const rpc = new FakeRpcClient([{ data: [nativeThread()], nextCursor: null }], responseGate);
    const provider = createCodexAgentProvider({ client: rpc, project });
    const events: AgentProviderEvent[] = [];
    provider.subscribeEvents((event) => events.push(event));
    await provider.listTasks();
    rpc.emitServerRequest("approval-race", "item/fileChange/requestApproval", {
      grantRoot: "/workspace/CodeAgent",
      itemId: "approval-race-item",
      reason: null,
      startedAtMs: 1_753_228_801_000,
      threadId: "task-1",
      turnId: "turn-1",
    });

    const resolution = provider.resolvePendingRequest({
      itemId: "approval-race-item",
      projectId: project.id,
      requestId: "string:approval-race",
      resolution: { decision: "allow" },
      taskId: "task-1",
      turnId: "turn-1",
      type: "file_change_approval",
    });
    await Promise.resolve();
    rpc.emitNotification("serverRequest/resolved", {
      requestId: "approval-race",
      threadId: "task-1",
    });
    releaseResponse();

    await expect(resolution).resolves.toMatchObject({ status: "resolved" });
    expect(events.map((event) => event.type)).toEqual([
      "pending_request.created",
      "pending_request.resolved",
    ]);
  });

  it("auto-resolves timed user input and rejects answers after expiry", async () => {
    vi.useFakeTimers();
    try {
      const rpc = new FakeRpcClient([{ data: [nativeThread()], nextCursor: null }]);
      const provider = createCodexAgentProvider({ client: rpc, project });
      const events: AgentProviderEvent[] = [];
      provider.subscribeEvents((event) => events.push(event));
      await provider.listTasks();
      rpc.emitServerRequest("timed-input", "item/tool/requestUserInput", {
        autoResolutionMs: 1_000,
        itemId: "timed-input-item",
        questions: [
          {
            header: "确认",
            id: "confirm",
            isOther: false,
            isSecret: false,
            options: [
              { description: "继续", label: "Yes" },
              { description: "停止", label: "No" },
            ],
            question: "继续执行吗？",
          },
        ],
        threadId: "task-1",
        turnId: "turn-timed",
      });

      await vi.advanceTimersByTimeAsync(1_000);

      expect(rpc.serverResponses).toEqual([{ id: "timed-input", result: { answers: {} } }]);
      expect(events.some((event) => event.type === "pending_request.expired")).toBe(true);
      await expect(
        provider.resolvePendingRequest({
          itemId: "timed-input-item",
          projectId: project.id,
          requestId: "string:timed-input",
          resolution: { answers: { confirm: ["Yes"] } },
          taskId: "task-1",
          turnId: "turn-timed",
          type: "user_input",
        }),
      ).rejects.toMatchObject({ code: "expired" } satisfies Partial<PendingRequestResolutionError>);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps auto-expiration expired when Codex confirms it before the write callback", async () => {
    vi.useFakeTimers();
    try {
      let releaseResponse: () => void = () => undefined;
      const responseGate = new Promise<void>((resolve) => {
        releaseResponse = resolve;
      });
      const rpc = new FakeRpcClient([{ data: [nativeThread()], nextCursor: null }], responseGate);
      const provider = createCodexAgentProvider({ client: rpc, project });
      const events: AgentProviderEvent[] = [];
      provider.subscribeEvents((event) => events.push(event));
      await provider.listTasks();
      rpc.emitServerRequest("expiry-race", "item/tool/requestUserInput", {
        autoResolutionMs: 1_000,
        itemId: "expiry-race-item",
        questions: [
          {
            header: "说明",
            id: "note",
            isOther: false,
            isSecret: false,
            options: null,
            question: "补充说明",
          },
        ],
        threadId: "task-1",
        turnId: "turn-1",
      });

      await vi.advanceTimersByTimeAsync(1_000);
      rpc.emitNotification("serverRequest/resolved", {
        requestId: "expiry-race",
        threadId: "task-1",
      });
      releaseResponse();
      await Promise.resolve();

      expect(events.map((event) => event.type)).toEqual([
        "pending_request.created",
        "pending_request.expired",
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps timed user input expiry active after a failed manual response", async () => {
    vi.useFakeTimers();
    try {
      let responseAttempt = 0;
      const rpc = new FakeRpcClient([{ data: [nativeThread()], nextCursor: null }], () => {
        responseAttempt += 1;
        return responseAttempt === 1
          ? Promise.reject(new Error("RPC write failed"))
          : Promise.resolve();
      });
      const provider = createCodexAgentProvider({ client: rpc, project });
      const events: AgentProviderEvent[] = [];
      provider.subscribeEvents((event) => events.push(event));
      await provider.listTasks();
      rpc.emitServerRequest("timed-input", "item/tool/requestUserInput", {
        autoResolutionMs: 1_000,
        itemId: "timed-input-item",
        questions: [
          {
            header: "确认",
            id: "confirm",
            isOther: false,
            isSecret: false,
            options: [
              { description: "继续", label: "Yes" },
              { description: "停止", label: "No" },
            ],
            question: "继续执行吗？",
          },
        ],
        threadId: "task-1",
        turnId: "turn-timed",
      });

      await expect(
        provider.resolvePendingRequest({
          itemId: "timed-input-item",
          projectId: project.id,
          requestId: "string:timed-input",
          resolution: { answers: { confirm: ["Yes"] } },
          taskId: "task-1",
          turnId: "turn-timed",
          type: "user_input",
        }),
      ).rejects.toThrow("RPC write failed");

      await vi.advanceTimersByTimeAsync(1_000);

      expect(rpc.serverResponses).toEqual([
        { id: "timed-input", result: { answers: { confirm: { answers: ["Yes"] } } } },
        { id: "timed-input", result: { answers: {} } },
      ]);
      expect(events.at(-1)).toMatchObject({
        payload: { request: { status: "expired" } },
        type: "pending_request.expired",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("maps file denial and semantic user input answers", async () => {
    const rpc = new FakeRpcClient([{ data: [nativeThread()], nextCursor: null }]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    const requests: unknown[] = [];
    provider.subscribeEvents((event) => {
      if (event.type === "pending_request.created") {
        requests.push(event.payload.request);
      }
    });
    await provider.listTasks();

    rpc.emitServerRequest("file-1", "item/fileChange/requestApproval", {
      grantRoot: "/workspace/CodeAgent",
      itemId: "file-item",
      reason: null,
      startedAtMs: 1_753_228_801_000,
      threadId: "task-1",
      turnId: "turn-1",
    });
    rpc.emitServerRequest("input-1", "item/tool/requestUserInput", {
      autoResolutionMs: 30_000,
      itemId: "input-item",
      questions: [
        {
          header: "确认",
          id: "confirm",
          isOther: false,
          isSecret: false,
          options: [
            { description: "继续", label: "Yes" },
            { description: "停止", label: "No" },
          ],
          question: "继续执行吗？",
        },
        {
          header: "说明",
          id: "note",
          isOther: false,
          isSecret: false,
          options: null,
          question: "补充说明",
        },
        {
          header: "替代方案",
          id: "alternative",
          isOther: true,
          isSecret: false,
          options: [
            { description: "继续", label: "Yes" },
            { description: "停止", label: "No" },
          ],
          question: "是否采用预设方案？",
        },
      ],
      threadId: "task-1",
      turnId: "turn-1",
    });

    expect(requests).toEqual([
      expect.objectContaining({ requestId: "string:file-1", type: "file_change_approval" }),
      expect.objectContaining({
        questions: [
          expect.objectContaining({ id: "confirm", type: "confirmation" }),
          expect.objectContaining({ id: "note", type: "short_text" }),
          expect.objectContaining({ id: "alternative", isOther: true, type: "choice" }),
        ],
        requestId: "string:input-1",
        type: "user_input",
      }),
    ]);
    const fileRequest = requests[0] as {
      itemId: string;
      projectId: string;
      requestId: string;
      taskId: string;
      turnId: string;
      type: "file_change_approval";
    };
    await provider.resolvePendingRequest({
      itemId: fileRequest.itemId,
      projectId: fileRequest.projectId,
      requestId: fileRequest.requestId,
      resolution: { decision: "deny" },
      taskId: fileRequest.taskId,
      turnId: fileRequest.turnId,
      type: fileRequest.type,
    });
    const inputRequest = requests[1] as {
      itemId: string;
      projectId: string;
      requestId: string;
      taskId: string;
      turnId: string;
      type: "user_input";
    };
    await provider.resolvePendingRequest({
      itemId: inputRequest.itemId,
      projectId: inputRequest.projectId,
      requestId: inputRequest.requestId,
      resolution: {
        answers: { alternative: ["自定义方案"], confirm: ["Yes"], note: ["继续"] },
      },
      taskId: inputRequest.taskId,
      turnId: inputRequest.turnId,
      type: inputRequest.type,
    });

    expect(rpc.serverResponses).toEqual([
      { id: "file-1", result: { decision: "decline" } },
      {
        id: "input-1",
        result: {
          answers: {
            alternative: { answers: ["自定义方案"] },
            confirm: { answers: ["Yes"] },
            note: { answers: ["继续"] },
          },
        },
      },
    ]);
  });

  it("applies Codex defaults to optional user input fields", async () => {
    const rpc = new FakeRpcClient([{ data: [nativeThread()], nextCursor: null }]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    const requests: unknown[] = [];
    provider.subscribeEvents((event) => {
      if (event.type === "pending_request.created") {
        requests.push(event.payload.request);
      }
    });
    await provider.listTasks();

    rpc.emitServerRequest("input-defaults", "item/tool/requestUserInput", {
      itemId: "input-defaults-item",
      questions: [{ header: "说明", id: "note", question: "补充说明" }],
      threadId: "task-1",
      turnId: "turn-1",
    });

    expect(requests).toEqual([
      expect.objectContaining({
        expiresAt: null,
        questions: [
          {
            header: "说明",
            id: "note",
            isOther: false,
            isSecret: false,
            options: [],
            prompt: "补充说明",
            type: "short_text",
          },
        ],
        requestId: "string:input-defaults",
        type: "user_input",
      }),
    ]);
  });

  it("rejects answers outside fixed user input options", async () => {
    const rpc = new FakeRpcClient([{ data: [nativeThread()], nextCursor: null }]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    await provider.listTasks();
    rpc.emitServerRequest("input-fixed", "item/tool/requestUserInput", {
      autoResolutionMs: null,
      itemId: "input-fixed-item",
      questions: [
        {
          header: "确认",
          id: "confirm",
          isOther: false,
          isSecret: false,
          options: [
            { description: "继续", label: "Yes" },
            { description: "停止", label: "No" },
          ],
          question: "继续执行吗？",
        },
      ],
      threadId: "task-1",
      turnId: "turn-1",
    });

    await expect(
      provider.resolvePendingRequest({
        itemId: "input-fixed-item",
        projectId: project.id,
        requestId: "string:input-fixed",
        resolution: { answers: { confirm: ["INVALID"] } },
        taskId: "task-1",
        turnId: "turn-1",
        type: "user_input",
      }),
    ).rejects.toMatchObject({ code: "mismatch" } satisfies Partial<PendingRequestResolutionError>);
    expect(rpc.serverResponses).toEqual([]);
  });

  it("expires requests once when Codex clears them or their turn ends", async () => {
    const rpc = new FakeRpcClient([{ data: [nativeThread()], nextCursor: null }]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    const events: unknown[] = [];
    provider.subscribeEvents((event) => {
      events.push(event);
    });
    await provider.listTasks();
    const emitApproval = (id: number, itemId: string, turnId: string) => {
      rpc.emitServerRequest(id, "item/fileChange/requestApproval", {
        itemId,
        startedAtMs: 1_753_228_801_000,
        threadId: "task-1",
        turnId,
      });
    };
    emitApproval(1, "file-1", "turn-1");
    rpc.emitNotification("serverRequest/resolved", { requestId: 1, threadId: "task-1" });
    rpc.emitNotification("serverRequest/resolved", { requestId: 1, threadId: "task-1" });
    emitApproval(2, "file-2", "turn-2");
    rpc.emitNotification("turn/completed", {
      threadId: "task-1",
      turn: {
        completedAt: 1_753_228_802,
        error: null,
        id: "turn-2",
        items: [],
        startedAt: 1_753_228_800,
        status: "interrupted",
      },
    });

    expect(
      events.filter((event) => (event as { type: string }).type === "pending_request.expired"),
    ).toHaveLength(2);
    expect(rpc.serverResponses).toEqual([]);
  });

  it("lists all visible Codex models through the provider contract", async () => {
    const rpc = new FakeRpcClient([
      {
        data: [
          {
            defaultReasoningEffort: "high",
            description: "适合复杂编码任务",
            displayName: "GPT-5.6 Sol",
            hidden: false,
            isDefault: true,
            model: "gpt-5.6-sol",
            supportedReasoningEfforts: [
              { description: "快速回答", reasoningEffort: "low" },
              { description: "深入分析", reasoningEffort: "high" },
            ],
          },
        ],
        nextCursor: "models-page-2",
      },
      {
        data: [
          {
            defaultReasoningEffort: "low",
            description: "隐藏模型",
            displayName: "Hidden",
            hidden: true,
            isDefault: false,
            model: "hidden-model",
            supportedReasoningEfforts: [{ description: "快速回答", reasoningEffort: "low" }],
          },
          {
            defaultReasoningEffort: "medium",
            description: "快速编码模型",
            displayName: "GPT-5.6 Terra",
            hidden: false,
            isDefault: false,
            model: "gpt-5.6-terra",
            supportedReasoningEfforts: [
              { description: "平衡速度与深度", reasoningEffort: "medium" },
            ],
          },
        ],
        nextCursor: null,
      },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });

    await expect(provider.listModels()).resolves.toEqual({
      data: [
        {
          defaultReasoningEffort: "high",
          description: "适合复杂编码任务",
          displayName: "GPT-5.6 Sol",
          id: "gpt-5.6-sol",
          isDefault: true,
          supportedReasoningEfforts: [
            { description: "快速回答", id: "low" },
            { description: "深入分析", id: "high" },
          ],
        },
        {
          defaultReasoningEffort: "medium",
          description: "快速编码模型",
          displayName: "GPT-5.6 Terra",
          id: "gpt-5.6-terra",
          isDefault: false,
          supportedReasoningEfforts: [{ description: "平衡速度与深度", id: "medium" }],
        },
      ],
      nextCursor: null,
    });
    expect(rpc.calls).toEqual([
      { method: "model/list", params: { includeHidden: false, limit: 100 } },
      {
        method: "model/list",
        params: { cursor: "models-page-2", includeHidden: false, limit: 100 },
      },
    ]);
  });

  it("rejects repeated model cursors and mismatched image data URLs", async () => {
    const cursorRpc = new FakeRpcClient([
      { data: [], nextCursor: "same-page" },
      { data: [], nextCursor: "same-page" },
    ]);
    const cursorProvider = createCodexAgentProvider({ client: cursorRpc, project });
    await expect(cursorProvider.listModels()).rejects.toThrow(
      "model/list returned a repeated cursor",
    );

    const inputRpc = new FakeRpcClient([{ thread: nativeThread() }]);
    const inputProvider = createCodexAgentProvider({ client: inputRpc, project });
    await inputProvider.startTask();
    await expect(
      inputProvider.startTurn(
        "task-1",
        {
          images: [{ mediaType: "image/png", url: "data:image/jpeg;base64,aW1hZ2U=" }],
          text: "",
        },
        { approvalPolicy: "on-request", model: "gpt-5.6-sol", reasoningEffort: "high" },
      ),
    ).rejects.toThrow("Provider image URL does not match its media type");
    expect(inputRpc.calls).toHaveLength(1);
  });

  it("maps task and turn mutations to Codex App Server RPC", async () => {
    const runningTurn = {
      completedAt: null,
      durationMs: null,
      error: null,
      id: "turn-1",
      items: [],
      itemsView: { type: "full" },
      startedAt: 1_753_228_800,
      status: "inProgress",
    };
    const rpc = new FakeRpcClient([{ thread: nativeThread() }, { turn: runningTurn }, {}]);
    const provider = createCodexAgentProvider({ client: rpc, project });

    await expect(provider.startTask()).resolves.toMatchObject({
      id: "task-1",
      projectId: "code-agent",
    });
    await expect(
      provider.startTurn(
        "task-1",
        {
          images: [
            {
              mediaType: "image/png",
              url: "data:image/png;base64,aW1hZ2U=",
            },
          ],
          text: "实现写入闭环",
        },
        { approvalPolicy: "untrusted", model: "gpt-5.6-sol", reasoningEffort: "high" },
      ),
    ).resolves.toMatchObject({ id: "turn-1", status: "running" });
    await expect(provider.interruptTurn("task-1", "turn-1")).resolves.toBeUndefined();

    expect(rpc.calls).toEqual([
      { method: "thread/start", params: { cwd: "/workspace/CodeAgent" } },
      {
        method: "turn/start",
        params: {
          approvalPolicy: "untrusted",
          input: [
            { text: "实现写入闭环", text_elements: [], type: "text" },
            { type: "image", url: "data:image/png;base64,aW1hZ2U=" },
          ],
          model: "gpt-5.6-sol",
          effort: "high",
          threadId: "task-1",
        },
      },
      { method: "turn/interrupt", params: { threadId: "task-1", turnId: "turn-1" } },
    ]);
  });

  it("maps Codex notifications to provider-independent realtime events", async () => {
    const rpc = new FakeRpcClient([{ data: [nativeThread()], nextCursor: null }]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    const events: unknown[] = [];
    const unsubscribe = provider.subscribeEvents((event) => {
      events.push(event);
    });
    await provider.listTasks();
    const runningTurn = {
      completedAt: null,
      durationMs: null,
      error: null,
      id: "turn-1",
      items: [],
      itemsView: { type: "full" },
      startedAt: 1_753_228_800,
      status: "inProgress",
    };
    const completedItem = { id: "item-1", text: "实时完成", type: "agentMessage" };
    const completedTurn = {
      ...runningTurn,
      completedAt: 1_753_228_801,
      items: [completedItem],
      status: "completed",
    };

    rpc.emitNotification("future/notification", { private: true });
    rpc.emitNotification("turn/started", { threadId: "task-1", turn: runningTurn });
    rpc.emitNotification("item/agentMessage/delta", {
      delta: "实时",
      itemId: "item-1",
      threadId: "task-1",
      turnId: "turn-1",
    });
    rpc.emitNotification("item/reasoning/summaryTextDelta", {
      delta: "分析",
      itemId: "item-2",
      summaryIndex: 0,
      threadId: "task-1",
      turnId: "turn-1",
    });
    rpc.emitNotification("item/reasoning/textDelta", {
      contentIndex: 0,
      delta: "细节",
      itemId: "item-2",
      threadId: "task-1",
      turnId: "turn-1",
    });
    rpc.emitNotification("item/commandExecution/outputDelta", {
      delta: "Done\n",
      itemId: "item-3",
      threadId: "task-1",
      turnId: "turn-1",
    });
    rpc.emitNotification("item/completed", {
      completedAtMs: 1_753_228_801_000,
      item: completedItem,
      threadId: "task-1",
      turnId: "turn-1",
    });
    rpc.emitNotification("thread/tokenUsage/updated", {
      threadId: "task-1",
      tokenUsage: {
        last: {
          cacheWriteInputTokens: 0,
          cachedInputTokens: 10_000,
          inputTokens: 20_000,
          outputTokens: 4_000,
          reasoningOutputTokens: 1_000,
          totalTokens: 25_000,
        },
        modelContextWindow: 200_000,
        total: {
          cacheWriteInputTokens: 0,
          cachedInputTokens: 10_000,
          inputTokens: 80_000,
          outputTokens: 15_000,
          reasoningOutputTokens: 5_000,
          totalTokens: 100_000,
        },
      },
      turnId: "turn-1",
    });
    rpc.emitNotification("turn/completed", { threadId: "task-1", turn: completedTurn });
    rpc.emitNotification("error", {
      error: { message: "模型服务不可用" },
      threadId: "task-1",
      turnId: "turn-1",
      willRetry: false,
    });

    expect(events).toEqual([
      {
        payload: {
          turn: {
            completedAt: null,
            error: null,
            id: "turn-1",
            items: [],
            startedAt: "2025-07-23T00:00:00.000Z",
            status: "running",
          },
        },
        taskId: "task-1",
        turnId: "turn-1",
        type: "turn.started",
      },
      {
        itemId: "item-1",
        payload: { delta: "实时" },
        taskId: "task-1",
        turnId: "turn-1",
        type: "message.delta",
      },
      {
        itemId: "item-2",
        payload: { delta: "分析", field: "summary" },
        taskId: "task-1",
        turnId: "turn-1",
        type: "reasoning.delta",
      },
      {
        itemId: "item-2",
        payload: { delta: "细节", field: "content" },
        taskId: "task-1",
        turnId: "turn-1",
        type: "reasoning.delta",
      },
      {
        itemId: "item-3",
        payload: { delta: "Done\n" },
        taskId: "task-1",
        turnId: "turn-1",
        type: "command.output_delta",
      },
      {
        itemId: "item-1",
        payload: {
          item: { id: "item-1", role: "assistant", text: "实时完成", type: "message" },
        },
        taskId: "task-1",
        turnId: "turn-1",
        type: "item.completed",
      },
      {
        payload: { usage: { contextWindow: 200_000, usedTokens: 25_000 } },
        taskId: "task-1",
        turnId: "turn-1",
        type: "usage.updated",
      },
      {
        payload: {
          turn: {
            completedAt: "2025-07-23T00:00:01.000Z",
            error: null,
            id: "turn-1",
            items: [{ id: "item-1", role: "assistant", text: "实时完成", type: "message" }],
            startedAt: "2025-07-23T00:00:00.000Z",
            status: "completed",
          },
        },
        taskId: "task-1",
        turnId: "turn-1",
        type: "turn.completed",
      },
      {
        payload: { message: "模型服务不可用", willRetry: false },
        taskId: "task-1",
        turnId: "turn-1",
        type: "provider.error",
      },
    ]);

    unsubscribe();
    rpc.emitNotification("item/agentMessage/delta", {
      delta: "不应交付",
      itemId: "item-1",
      threadId: "task-1",
      turnId: "turn-1",
    });
    expect(events).toHaveLength(9);
  });

  it("does not publish notifications for tasks outside the active project", async () => {
    let pendingResolution: Promise<unknown> | undefined;
    const rpc = new FakeRpcClient([
      () => {
        rpc.emitServerRequest("foreign-request", "item/fileChange/requestApproval", {
          grantRoot: "/workspace/other",
          itemId: "foreign-file",
          reason: null,
          startedAtMs: 1_753_228_801_000,
          threadId: "task-foreign",
          turnId: "turn-foreign",
        });
        pendingResolution = provider
          .resolvePendingRequest({
            itemId: "foreign-file",
            projectId: project.id,
            requestId: "string:foreign-request",
            resolution: { decision: "deny" },
            taskId: "task-foreign",
            turnId: "turn-foreign",
            type: "file_change_approval",
          })
          .then(
            () => "resolved",
            (error: unknown) => error,
          );
        return { thread: nativeThread({ cwd: "/workspace/other", id: "task-foreign" }) };
      },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    const events: unknown[] = [];
    provider.subscribeEvents((event) => {
      events.push(event);
    });

    await expect(provider.readTask("task-foreign")).resolves.toBeUndefined();
    rpc.emitNotification("item/agentMessage/delta", {
      delta: "不应泄漏",
      itemId: "item-foreign",
      threadId: "task-foreign",
      turnId: "turn-foreign",
    });

    expect(events).toEqual([]);
    await expect(pendingResolution).resolves.toMatchObject({ code: "not_found" });
    expect(rpc.serverResponses).toEqual([]);
  });

  it("restores server requests received while readTask validates project ownership", async () => {
    const rpc = new FakeRpcClient([
      () => {
        rpc.emitServerRequest("during-read", "item/fileChange/requestApproval", {
          grantRoot: "/workspace/CodeAgent",
          itemId: "file-during-read",
          reason: null,
          startedAtMs: 1_753_228_801_000,
          threadId: "task-1",
          turnId: "turn-1",
        });
        return { thread: nativeThread() };
      },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    const events: unknown[] = [];
    provider.subscribeEvents((event) => events.push(event));

    const snapshot = await provider.readTask("task-1");

    expect(snapshot?.pendingRequests).toEqual([
      expect.objectContaining({ requestId: "string:during-read", status: "pending" }),
    ]);
    expect(events).toEqual([expect.objectContaining({ type: "pending_request.created" })]);
  });

  it("preserves owned server requests when task snapshot mapping fails", async () => {
    const rpc = new FakeRpcClient([
      () => {
        rpc.emitServerRequest("during-invalid-read", "item/fileChange/requestApproval", {
          grantRoot: "/workspace/CodeAgent",
          itemId: "file-during-invalid-read",
          reason: null,
          startedAtMs: 1_753_228_801_000,
          threadId: "task-1",
          turnId: "turn-1",
        });
        return { thread: nativeThread({ turns: null }) };
      },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    const events: AgentProviderEvent[] = [];
    provider.subscribeEvents((event) => events.push(event));

    await expect(provider.readTask("task-1")).rejects.toThrow("thread/read turns must be an array");
    await expect(
      provider.resolvePendingRequest({
        itemId: "file-during-invalid-read",
        projectId: project.id,
        requestId: "string:during-invalid-read",
        resolution: { decision: "deny" },
        taskId: "task-1",
        turnId: "turn-1",
        type: "file_change_approval",
      }),
    ).resolves.toMatchObject({ status: "resolved" });

    expect(rpc.serverResponses).toEqual([
      { id: "during-invalid-read", result: { decision: "decline" } },
    ]);
    expect(events.map((event) => event.type)).toEqual([
      "pending_request.created",
      "pending_request.resolved",
    ]);
  });

  it("does not restore server requests resolved while readTask validates ownership", async () => {
    const rpc = new FakeRpcClient([
      () => {
        rpc.emitServerRequest("resolved-during-read", "item/fileChange/requestApproval", {
          grantRoot: "/workspace/CodeAgent",
          itemId: "resolved-file-during-read",
          reason: null,
          startedAtMs: 1_753_228_801_000,
          threadId: "task-1",
          turnId: "turn-1",
        });
        rpc.emitNotification("serverRequest/resolved", {
          requestId: "resolved-during-read",
          threadId: "task-1",
        });
        return { thread: nativeThread() };
      },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    const events: unknown[] = [];
    provider.subscribeEvents((event) => events.push(event));

    const snapshot = await provider.readTask("task-1");

    expect(snapshot?.pendingRequests).toEqual([]);
    expect(events).toEqual([]);
  });

  it("does not restore server requests whose turn completes during ownership validation", async () => {
    const rpc = new FakeRpcClient([
      () => {
        rpc.emitServerRequest("completed-during-read", "item/fileChange/requestApproval", {
          grantRoot: "/workspace/CodeAgent",
          itemId: "completed-file-during-read",
          reason: null,
          startedAtMs: 1_753_228_801_000,
          threadId: "task-1",
          turnId: "turn-completed-during-read",
        });
        rpc.emitNotification("turn/completed", {
          threadId: "task-1",
          turn: {
            completedAt: 1_753_228_802,
            error: null,
            id: "turn-completed-during-read",
            items: [],
            startedAt: 1_753_228_800,
            status: "completed",
          },
        });
        return { thread: nativeThread() };
      },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    const events: unknown[] = [];
    provider.subscribeEvents((event) => events.push(event));

    const snapshot = await provider.readTask("task-1");

    expect(snapshot?.pendingRequests).toEqual([]);
    expect(events).toEqual([expect.objectContaining({ type: "turn.completed" })]);
  });

  it("delivers notifications received while readTask is validating project ownership", async () => {
    const deliveryOrder: string[] = [];
    const rpc = new FakeRpcClient([
      () => {
        rpc.emitNotification("item/agentMessage/delta", {
          delta: "读取期间到达",
          itemId: "item-1",
          threadId: "task-1",
          turnId: "turn-1",
        });
        return { thread: nativeThread() };
      },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    provider.subscribeEvents(() => {
      deliveryOrder.push("event");
    });

    await provider.readTask("task-1");
    deliveryOrder.push("snapshot");

    expect(deliveryOrder).toEqual(["event", "snapshot"]);
  });

  it("restores the latest context usage after validating project ownership", async () => {
    const rpc = new FakeRpcClient([
      () => {
        rpc.emitNotification("thread/tokenUsage/updated", {
          threadId: "task-1",
          tokenUsage: {
            last: { totalTokens: 25_000 },
            modelContextWindow: 200_000,
            total: { totalTokens: 100_000 },
          },
          turnId: "turn-1",
        });
        return { thread: nativeThread() };
      },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });

    await expect(provider.readTask("task-1")).resolves.toMatchObject({
      contextUsage: { contextWindow: 200_000, usedTokens: 25_000 },
    });
  });

  it("maps thread/list without repeating the runtime handshake", async () => {
    const rpc = new FakeRpcClient([{ data: [nativeThread()], nextCursor: "next-cursor" }]);
    const provider = createCodexAgentProvider({ client: rpc, project });

    await expect(provider.getCapabilities()).resolves.toEqual({
      provider: "codex",
      tasks: { list: true, read: true, start: true },
      turns: { interrupt: true, rollback: true, start: true },
    });
    await expect(provider.listTasks({ cursor: "cursor", limit: 25 })).resolves.toEqual({
      data: [
        {
          id: "task-1",
          pinned: false,
          projectId: "code-agent",
          title: "实现真实 Task 历史",
          updatedAt: "2025-07-23T01:00:00.000Z",
        },
      ],
      nextCursor: "next-cursor",
    });
    expect(rpc.calls).toEqual([
      {
        method: "thread/list",
        params: {
          cursor: "cursor",
          cwd: "/workspace/CodeAgent",
          limit: 25,
          sortDirection: "desc",
          sortKey: "updated_at",
        },
      },
    ]);
    expect(rpc.notifications).toEqual([]);
  });

  it("maps thread/read turns and items without exposing native thread fields", async () => {
    const rpc = new FakeRpcClient([
      {
        thread: nativeThread({
          name: "结构化历史",
          status: { activeFlags: [], type: "active" },
          turns: [
            {
              completedAt: 1_753_232_400,
              id: "turn-1",
              items: [
                { content: [{ text: "读取历史", type: "text" }], id: "i1", type: "userMessage" },
                { id: "i2", text: "已读取", type: "agentMessage" },
                {
                  content: ["核对边界"],
                  id: "i3",
                  summary: ["分析协议"],
                  type: "reasoning",
                },
                {
                  aggregatedOutput: "Done",
                  command: "pnpm check",
                  commandActions: [],
                  cwd: "/workspace/CodeAgent",
                  exitCode: 0,
                  id: "i4",
                  status: "completed",
                  type: "commandExecution",
                },
                {
                  changes: [
                    {
                      diff: "+export {};",
                      kind: { move_path: null, type: "update" },
                      path: "src/index.ts",
                    },
                  ],
                  id: "i5",
                  status: "completed",
                  type: "fileChange",
                },
                {
                  arguments: { path: "src/index.ts" },
                  id: "i6",
                  result: { content: [{ text: "export {};", type: "text" }] },
                  server: "filesystem",
                  status: "completed",
                  tool: "read_file",
                  type: "mcpToolCall",
                },
                { id: "i7", text: "1. 定义协议", type: "plan" },
                { id: "i8", type: "contextCompaction" },
                { id: "i9", type: "futureItem", value: "private" },
              ],
              startedAt: 1_753_228_800,
              status: "completed",
            },
          ],
        }),
      },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });

    const snapshot = await provider.readTask("task-1");

    expect(rpc.calls[0]).toEqual({
      method: "thread/read",
      params: { includeTurns: true, threadId: "task-1" },
    });
    expect(snapshot).toMatchObject({
      id: "task-1",
      projectId: "code-agent",
      status: "running",
      title: "结构化历史",
      turns: [
        {
          error: null,
          id: "turn-1",
          status: "completed",
          items: [
            { id: "i1", role: "user", text: "读取历史", type: "message" },
            { id: "i2", role: "assistant", text: "已读取", type: "message" },
            { content: "核对边界", id: "i3", summary: "分析协议", type: "reasoning" },
            {
              command: "pnpm check",
              cwd: "/workspace/CodeAgent",
              exitCode: 0,
              id: "i4",
              output: "Done",
              outputTruncated: false,
              status: "completed",
              type: "command",
            },
            {
              changes: [{ diff: "+export {};", kind: "update", path: "src/index.ts" }],
              id: "i5",
              status: "completed",
              type: "file_change",
            },
            {
              id: "i6",
              input: { path: "src/index.ts" },
              name: "filesystem/read_file",
              output: { content: [{ text: "export {};", type: "text" }] },
              status: "completed",
              type: "tool",
            },
            { id: "i7", text: "1. 定义协议", type: "plan" },
            { id: "i8", label: "上下文压缩", type: "activity" },
            {
              detail: "未识别的活动类型: futureItem",
              id: "i9",
              label: "Provider 活动",
              type: "activity",
            },
          ],
        },
      ],
    });
    expect(JSON.stringify(snapshot)).not.toMatch(
      /modelProvider|sessionId|nativeThread|futureItem.*private/,
    );
  });

  it("preserves failures and bounds command output in task snapshots", async () => {
    const lineLimitedOutput = Array.from(
      { length: 10_001 },
      (_, index) => `line-${String(index)}`,
    ).join("\n");
    const byteLimitedOutput = "界".repeat(400_000);
    const rpc = new FakeRpcClient([
      {
        thread: nativeThread({
          turns: [
            {
              completedAt: 1_753_232_400,
              error: {
                additionalDetails: null,
                codexErrorInfo: null,
                message: "模型服务不可用",
              },
              id: "failed-turn",
              items: [
                {
                  aggregatedOutput: lineLimitedOutput,
                  command: "print-lines",
                  cwd: "/workspace/CodeAgent",
                  id: "line-command",
                  status: "failed",
                  type: "commandExecution",
                },
                {
                  aggregatedOutput: byteLimitedOutput,
                  command: "print-bytes",
                  cwd: "/workspace/CodeAgent",
                  id: "byte-command",
                  status: "completed",
                  type: "commandExecution",
                },
                {
                  arguments: { path: "missing.ts" },
                  error: { message: "MCP 服务不可用" },
                  id: "failed-tool",
                  result: null,
                  server: "filesystem",
                  status: "failed",
                  tool: "read_file",
                  type: "mcpToolCall",
                },
              ],
              startedAt: 1_753_228_800,
              status: "failed",
            },
          ],
        }),
      },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });

    const snapshot = await provider.readTask("task-1");
    const turn = snapshot?.turns[0];
    const lineCommand = turn?.items.find((item) => item.id === "line-command");
    const byteCommand = turn?.items.find((item) => item.id === "byte-command");
    const failedTool = turn?.items.find((item) => item.id === "failed-tool");

    expect(turn?.error).toBe("模型服务不可用");
    expect(lineCommand).toMatchObject({
      output: lineLimitedOutput.split("\n").slice(-10_000).join("\n"),
      outputTruncated: true,
    });
    expect(byteCommand).toMatchObject({ outputTruncated: true });
    if (byteCommand?.type !== "command") {
      throw new Error("Expected a command item");
    }
    expect(Buffer.byteLength(byteCommand.output ?? "", "utf8")).toBeLessThanOrEqual(1_048_576);
    expect(failedTool).toMatchObject({ output: { error: "MCP 服务不可用" } });
  });

  it("returns undefined for a thread that belongs to another project", async () => {
    const rpc = new FakeRpcClient([{ thread: nativeThread({ cwd: "/workspace/Other" }) }]);
    const provider = createCodexAgentProvider({ client: rpc, project });

    await expect(provider.readTask("task-1")).resolves.toBeUndefined();
  });

  it("returns undefined when Codex reports that a thread is not loaded", async () => {
    const rpc = new FakeRpcClient([
      new RpcResponseError({
        code: -32600,
        data: null,
        message: "thread not loaded: missing-task",
      }),
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });

    await expect(provider.readTask("missing-task")).resolves.toBeUndefined();
  });

  it("preserves unrelated RPC failures when reading a thread", async () => {
    const error = new RpcResponseError({
      code: -32600,
      data: null,
      message: "invalid request",
    });
    const rpc = new FakeRpcClient([error]);
    const provider = createCodexAgentProvider({ client: rpc, project });

    await expect(provider.readTask("task-1")).rejects.toBe(error);
  });

  it("rejects malformed native responses at the adapter boundary", async () => {
    const rpc = new FakeRpcClient([{ data: "invalid" }]);
    const provider = createCodexAgentProvider({ client: rpc, project });

    await expect(provider.listTasks()).rejects.toThrow(CodexProtocolMappingError);
  });
});
