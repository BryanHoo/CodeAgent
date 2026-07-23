import { describe, expect, it } from "vitest";

import { createCodexAgentProvider, CodexProtocolMappingError } from "./agent-provider.js";
import { RpcResponseError } from "./jsonl-rpc-client.js";

class FakeRpcClient {
  readonly calls: Readonly<{ method: string; params: unknown }>[] = [];
  readonly notifications: Readonly<{ method: string; params: unknown }>[] = [];
  readonly #notificationListeners = new Set<
    (notification: { method: string; params: unknown }) => void
  >();
  readonly #responses: unknown[];

  public constructor(responses: unknown[]) {
    this.#responses = [...responses];
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
      provider.startTurn("task-1", { text: "实现写入闭环", type: "text" }),
    ).resolves.toMatchObject({ id: "turn-1", status: "running" });
    await expect(provider.interruptTurn("task-1", "turn-1")).resolves.toBeUndefined();

    expect(rpc.calls).toEqual([
      { method: "thread/start", params: { cwd: "/workspace/CodeAgent" } },
      {
        method: "turn/start",
        params: {
          input: [{ text: "实现写入闭环", text_elements: [], type: "text" }],
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
    expect(events).toHaveLength(8);
  });

  it("does not publish notifications for tasks outside the active project", async () => {
    const rpc = new FakeRpcClient([
      { thread: nativeThread({ cwd: "/workspace/other", id: "task-foreign" }) },
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

  it("maps thread/list without repeating the runtime handshake", async () => {
    const rpc = new FakeRpcClient([{ data: [nativeThread()], nextCursor: "next-cursor" }]);
    const provider = createCodexAgentProvider({ client: rpc, project });

    await expect(provider.getCapabilities()).resolves.toEqual({
      provider: "codex",
      tasks: { list: true, read: true, start: true },
      turns: { interrupt: true, start: true },
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
