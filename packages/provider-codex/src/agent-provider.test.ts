import { describe, expect, it } from "vitest";

import { createCodexAgentProvider, CodexProtocolMappingError } from "./agent-provider.js";
import { RpcResponseError } from "./jsonl-rpc-client.js";

class FakeRpcClient {
  readonly calls: Readonly<{ method: string; params: unknown }>[] = [];
  readonly notifications: Readonly<{ method: string; params: unknown }>[] = [];
  readonly #responses: unknown[];

  public constructor(responses: unknown[]) {
    this.#responses = [...responses];
  }

  public request(method: string, params?: unknown): Promise<unknown> {
    this.calls.push({ method, params });
    const response = this.#responses.shift();
    return response instanceof Error ? Promise.reject(response) : Promise.resolve(response);
  }

  public notify(method: string, params?: unknown): void {
    this.notifications.push({ method, params });
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
  it("maps thread/list without repeating the runtime handshake", async () => {
    const rpc = new FakeRpcClient([{ data: [nativeThread()], nextCursor: "next-cursor" }]);
    const provider = createCodexAgentProvider({ client: rpc, project });

    await expect(provider.getCapabilities()).resolves.toEqual({
      provider: "codex",
      tasks: { list: true, read: true },
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
