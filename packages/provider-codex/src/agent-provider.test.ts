import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { AgentProviderEvent, PendingRequestResolutionError } from "@code-agent/core";
import type { Project } from "@code-agent/protocol";

import {
  CodexAgentProvider,
  createCodexRuntimeProvider,
  CodexProtocolMappingError,
  type CodexProviderLogger,
  type CodexRpcClient,
} from "./agent-provider.js";
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

  public get notificationListenerCount(): number {
    return this.#notificationListeners.size;
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

  public get serverRequestListenerCount(): number {
    return this.#serverRequestListeners.size;
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

const PINNED_THREAD_SECTION = {
  id: "01984de2-8f74-7c91-a3b2-5c5e937cf318",
  name: "Pinned",
} as const;

function createCodexAgentProvider(options: {
  client: CodexRpcClient;
  logger?: CodexProviderLogger;
  project: Project;
}): CodexAgentProvider {
  return new CodexAgentProvider(options.client, options.project, {
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  });
}

function nativeThread(overrides: Record<string, unknown> = {}) {
  return {
    cliVersion: "0.147.0",
    createdAt: 1_753_228_800,
    cwd: "/workspace/CodeAgent",
    ephemeral: false,
    id: "task-1",
    modelProvider: "openai",
    name: null,
    preview: "实现真实 Task 历史\n更多内容",
    section: null,
    sectionEnteredAt: null,
    sessionId: "native-session",
    source: "cli",
    status: { type: "notLoaded" },
    turns: [],
    updatedAt: 1_753_232_400,
    ...overrides,
  };
}

describe("CodexAgentProvider", () => {
  it("publishes plan updates and restores the latest plan in task snapshots", async () => {
    const rpc = new FakeRpcClient([
      { data: [nativeThread()], nextCursor: null },
      { thread: nativeThread({ status: { type: "active" }, turns: [] }) },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    const events: AgentProviderEvent[] = [];
    provider.subscribeEvents((event) => events.push(event));
    await provider.listTasks();

    rpc.emitNotification("turn/plan/updated", {
      explanation: "先补齐数据链路，再接入界面。",
      plan: [
        { status: "completed", step: "定义协议" },
        { status: "inProgress", step: "接入右栏" },
        { status: "pending", step: "完成验证" },
      ],
      threadId: "task-1",
      turnId: "turn-1",
    });

    expect(events).toEqual([
      {
        payload: {
          plan: {
            explanation: "先补齐数据链路，再接入界面。",
            steps: [
              { status: "completed", text: "定义协议" },
              { status: "in_progress", text: "接入右栏" },
              { status: "pending", text: "完成验证" },
            ],
          },
        },
        taskId: "task-1",
        turnId: "turn-1",
        type: "plan.updated",
      },
    ]);
    await expect(provider.readTask("task-1")).resolves.toMatchObject({
      plan: {
        explanation: "先补齐数据链路，再接入界面。",
        steps: [
          { status: "completed", text: "定义协议" },
          { status: "in_progress", text: "接入右栏" },
          { status: "pending", text: "完成验证" },
        ],
      },
    });
  });

  it("warns with safe identity fields when dropping unknown or invalid notifications", async () => {
    const rpc = new FakeRpcClient([{ data: [nativeThread()], nextCursor: null }]);
    const warn = vi.fn<CodexProviderLogger["warn"]>();
    const provider = createCodexAgentProvider({ client: rpc, logger: { warn }, project });
    const events: AgentProviderEvent[] = [];
    provider.subscribeEvents((event) => events.push(event));
    await provider.listTasks();

    provider.receiveNotification("future/notification", {
      private: "unknown-secret-body",
      threadId: "task-1",
    });
    provider.receiveNotification("thread/goal/updated", {
      goal: {
        objective: "完成 Goal 协议适配",
        status: "active",
        threadId: "task-1",
      },
      threadId: "task-1",
      turnId: null,
    });
    provider.receiveNotification("item/agentMessage/delta", {
      delta: { body: "invalid-secret-body" },
      itemId: "item-1",
      threadId: "task-1",
      turnId: "turn-1",
    });
    provider.receiveNotification("item/agentMessage/delta", {
      delta: "后续事件",
      itemId: "item-1",
      threadId: "task-1",
      turnId: "turn-1",
    });

    expect(warn.mock.calls).toEqual([
      [
        {
          codexVersion: "0.147.0",
          diagnosticCode: "unknown_notification",
          method: "future/notification",
          projectId: "code-agent",
          taskId: "task-1",
        },
        "Codex notification dropped",
      ],
      [
        {
          codexVersion: "0.147.0",
          diagnosticCode: "invalid_notification",
          method: "item/agentMessage/delta",
          projectId: "code-agent",
          taskId: "task-1",
        },
        "Codex notification dropped",
      ],
    ]);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("unknown-secret-body");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("invalid-secret-body");
    expect(events).toEqual([
      {
        itemId: "item-1",
        payload: { delta: "后续事件" },
        taskId: "task-1",
        turnId: "turn-1",
        type: "message.delta",
      },
    ]);
  });

  it("sets a persistent goal before starting the first goal turn", async () => {
    const runningGoalTurn = {
      completedAt: null,
      durationMs: null,
      error: null,
      id: "turn-goal",
      items: [],
      itemsView: { type: "full" },
      startedAt: 1_754_396_400,
      status: "inProgress",
    };
    const goalResponse = {
      goal: {
        createdAt: 1_754_396_400,
        objective: "完成 Goal 协议适配",
        status: "active",
        threadId: "task-1",
        timeUsedSeconds: 0,
        tokenBudget: null,
        tokensUsed: 0,
        updatedAt: 1_754_396_400,
      },
    };
    const rpc = new FakeRpcClient([
      { thread: nativeThread() },
      {},
      () => {
        rpc.emitNotification("turn/started", {
          threadId: "task-1",
          turn: runningGoalTurn,
        });
        return goalResponse;
      },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });

    await provider.startTask();
    await expect(
      provider.startTurn(
        "task-1",
        {
          files: [],
          images: [],
          skills: [],
          text: "  完成 Goal 协议适配  ",
          textAttachments: [],
        },
        {
          approvalPolicy: "on-request",
          approvalsReviewer: "user",
          goalMode: true,
          model: "gpt-5.6-sol",
          reasoningEffort: "high",
          sandboxMode: "workspace-write",
        },
      ),
    ).resolves.toMatchObject({ id: "turn-goal", status: "running" });

    expect(rpc.calls.map(({ method }) => method)).toEqual([
      "thread/start",
      "thread/settings/update",
      "thread/goal/set",
    ]);
    expect(rpc.calls[1]).toEqual({
      method: "thread/settings/update",
      params: {
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        collaborationMode: {
          mode: "default",
          settings: {
            developer_instructions: null,
            model: "gpt-5.6-sol",
            reasoning_effort: "high",
          },
        },
        effort: "high",
        model: "gpt-5.6-sol",
        sandboxPolicy: {
          excludeSlashTmp: false,
          excludeTmpdirEnvVar: false,
          networkAccess: false,
          type: "workspaceWrite",
          writableRoots: [],
        },
        threadId: "task-1",
      },
    });
    expect(rpc.calls[2]).toEqual({
      method: "thread/goal/set",
      params: {
        objective: "完成 Goal 协议适配",
        status: "active",
        threadId: "task-1",
      },
    });
  });

  it("streams automatic approval review lifecycle as timeline items", async () => {
    const rpc = new FakeRpcClient([{ data: [nativeThread()], nextCursor: null }]);
    const provider = createCodexRuntimeProvider({ client: rpc }).forProject(project);
    const events: AgentProviderEvent[] = [];
    provider.subscribeEvents((event) => events.push(event));
    await provider.listTasks();

    const action = {
      command: "/bin/zsh -lc pwd",
      cwd: "/workspace/CodeAgent",
      source: "shell",
      type: "command",
    };
    rpc.emitNotification("item/autoApprovalReview/started", {
      action,
      review: {
        rationale: null,
        riskLevel: null,
        status: "inProgress",
        userAuthorization: null,
      },
      reviewId: "review-1",
      startedAtMs: 1_753_228_800_000,
      targetItemId: "command-1",
      threadId: "task-1",
      turnId: "turn-1",
    });
    rpc.emitNotification("item/autoApprovalReview/completed", {
      action,
      completedAtMs: 1_753_228_802_000,
      decisionSource: "agent",
      review: {
        rationale: "The user explicitly requested this read-only command.",
        riskLevel: "low",
        status: "approved",
        userAuthorization: "high",
      },
      reviewId: "review-1",
      startedAtMs: 1_753_228_800_000,
      targetItemId: "command-1",
      threadId: "task-1",
      turnId: "turn-1",
    });

    expect(events).toMatchObject([
      {
        itemId: "auto-approval-review-review-1",
        payload: {
          item: {
            action: { detail: "/bin/zsh -lc pwd", type: "command" },
            id: "auto-approval-review-review-1",
            status: "in_progress",
            targetItemId: "command-1",
            type: "approval_review",
          },
        },
        type: "item.started",
      },
      {
        itemId: "auto-approval-review-review-1",
        payload: {
          item: {
            action: { detail: "/bin/zsh -lc pwd", type: "command" },
            rationale: "The user explicitly requested this read-only command.",
            riskLevel: "low",
            status: "approved",
            type: "approval_review",
            userAuthorization: "high",
          },
        },
        type: "item.completed",
      },
    ]);
  });

  it("lists and terminates background terminals through the experimental thread API", async () => {
    const rpc = new FakeRpcClient([
      { thread: nativeThread() },
      {
        data: [
          {
            command: "pnpm dev",
            cpuPercent: 1.5,
            cwd: "/workspace/CodeAgent",
            itemId: "command-1",
            osPid: 2345,
            processId: "terminal-1",
            rssKb: 4096,
          },
        ],
        nextCursor: null,
      },
      { terminated: true },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    await provider.readTask("task-1");

    await expect(provider.listBackgroundTerminals("task-1")).resolves.toEqual({
      data: [
        {
          command: "pnpm dev",
          cwd: "/workspace/CodeAgent",
          id: "terminal-1",
          itemId: "command-1",
        },
      ],
    });
    await expect(provider.terminateBackgroundTerminal("task-1", "terminal-1")).resolves.toBe(true);
    expect(rpc.calls.slice(1)).toEqual([
      {
        method: "thread/backgroundTerminals/list",
        params: { limit: 100, threadId: "task-1" },
      },
      {
        method: "thread/backgroundTerminals/terminate",
        params: { processId: "terminal-1", threadId: "task-1" },
      },
    ]);
  });

  it("returns no background terminals when the historical thread is not loaded", async () => {
    const rpc = new FakeRpcClient([
      { thread: nativeThread() },
      new RpcResponseError({
        code: -32600,
        data: null,
        message: "thread not found: task-1",
      }),
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    await provider.readTask("task-1");

    await expect(provider.listBackgroundTerminals("task-1")).resolves.toEqual({ data: [] });
    expect(rpc.calls.slice(1)).toEqual([
      {
        method: "thread/backgroundTerminals/list",
        params: { limit: 100, threadId: "task-1" },
      },
    ]);
  });

  it("unsubscribes an idle task and releases provider task state", async () => {
    const rpc = new FakeRpcClient([
      { thread: nativeThread({ turns: [] }) },
      { data: [], nextCursor: null },
      { status: "unsubscribed" },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    await provider.readTask("task-1");

    await expect(provider.unsubscribeTask("task-1")).resolves.toBe("unsubscribed");
    await expect(provider.unsubscribeTask("task-1")).resolves.toBe("notLoaded");

    expect(rpc.calls.slice(1)).toEqual([
      {
        method: "thread/backgroundTerminals/list",
        params: { limit: 100, threadId: "task-1" },
      },
      { method: "thread/unsubscribe", params: { threadId: "task-1" } },
    ]);
  });

  it("preserves structured subagent details from Codex collaboration items", async () => {
    const rpc = new FakeRpcClient([
      {
        thread: nativeThread({
          turns: [
            {
              completedAt: 1_753_228_860,
              error: null,
              id: "turn-collaboration",
              items: [
                {
                  agentsStates: {
                    "child-frontend": { message: "前端分析完成", status: "completed" },
                  },
                  id: "collaboration-spawn",
                  model: "gpt-5.6-sol",
                  prompt: "理解前端项目",
                  reasoningEffort: "high",
                  receiverThreadIds: ["child-frontend"],
                  senderThreadId: "task-1",
                  status: "completed",
                  tool: "spawnAgent",
                  type: "collabAgentToolCall",
                },
                {
                  agentPath: "/root/frontend_analysis",
                  agentThreadId: "child-frontend",
                  id: "subagent-started",
                  kind: "started",
                  type: "subAgentActivity",
                },
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

    expect(snapshot?.turns[0]?.items).toEqual([
      {
        id: "collaboration-spawn",
        input: {
          model: "gpt-5.6-sol",
          prompt: "理解前端项目",
          reasoningEffort: "high",
          receiverTaskIds: ["child-frontend"],
          senderTaskId: "task-1",
        },
        name: "agent/spawn",
        output: {
          agents: [
            {
              message: "前端分析完成",
              nickname: "frontend_analysis",
              status: "completed",
              taskId: "child-frontend",
            },
          ],
        },
        status: "completed",
        type: "tool",
      },
      {
        detail: "已启动",
        id: "subagent-started",
        label: "子代理 frontend_analysis",
        status: "completed",
        type: "activity",
      },
    ]);
  });

  it("uses 新聊天 until Codex provides a task title", async () => {
    const rpc = new FakeRpcClient([
      { thread: nativeThread({ name: null, preview: "" }) },
      { thread: nativeThread({ name: "Codex 返回的标题", preview: "忽略的预览" }) },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });

    await expect(provider.startTask()).resolves.toMatchObject({ title: "新聊天" });
    await expect(provider.startTask()).resolves.toMatchObject({ title: "Codex 返回的标题" });
  });

  it("keeps a newly created task visible until Codex materializes it in the native list", async () => {
    const rpc = new FakeRpcClient([
      { thread: nativeThread({ name: null, preview: "" }) },
      { data: [], nextCursor: null },
      {
        data: [nativeThread({ name: "Codex 生成的标题", preview: "用户发送了你好" })],
        nextCursor: null,
      },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });

    await expect(provider.startTask()).resolves.toMatchObject({ id: "task-1", title: "新聊天" });
    await expect(provider.listTasks()).resolves.toMatchObject({
      data: [{ id: "task-1", title: "新聊天" }],
    });
    await expect(provider.listTasks()).resolves.toMatchObject({
      data: [{ id: "task-1", title: "Codex 生成的标题" }],
    });
  });

  it("keeps an ephemeral task out of the project task list", async () => {
    const rpc = new FakeRpcClient([
      { thread: nativeThread({ ephemeral: true }) },
      { data: [], nextCursor: null },
    ]);
    const provider = createCodexRuntimeProvider({ client: rpc }).forProject(project);

    await expect(provider.startTask({ ephemeral: true })).resolves.toMatchObject({ id: "task-1" });
    await expect(provider.listTasks()).resolves.toEqual({ data: [], nextCursor: null });
    expect(rpc.calls).toEqual([
      { method: "thread/start", params: { cwd: project.rootPath, ephemeral: true } },
      {
        method: "thread/list",
        params: {
          cwd: project.rootPath,
          sortDirection: "desc",
          sortKey: "updated_at",
        },
      },
    ]);
  });

  it("publishes ephemeral task events only to explicit internal subscribers", async () => {
    const rpc = new FakeRpcClient([{ thread: nativeThread({ ephemeral: true }) }]);
    const provider = createCodexRuntimeProvider({ client: rpc }).forProject(project);
    const visibleEvents: AgentProviderEvent[] = [];
    const internalEvents: AgentProviderEvent[] = [];
    provider.subscribeEvents((event) => visibleEvents.push(event));
    provider.subscribeEvents((event) => internalEvents.push(event), { includeEphemeral: true });
    await provider.startTask({ ephemeral: true });

    rpc.emitNotification("item/agentMessage/delta", {
      delta: "hidden commit message",
      itemId: "message-1",
      threadId: "task-1",
      turnId: "turn-1",
    });

    expect(visibleEvents).toEqual([]);
    expect(internalEvents).toMatchObject([
      {
        itemId: "message-1",
        taskId: "task-1",
        turnId: "turn-1",
        type: "message.delta",
      },
    ]);
  });

  it("shares one RPC subscription across multiple project providers", async () => {
    const otherProject = {
      ...project,
      id: "other",
      name: "Other",
      rootPath: "/workspace/Other",
    };
    const rpc = new FakeRpcClient([
      { data: [nativeThread()], nextCursor: null },
      {
        data: [nativeThread({ cwd: otherProject.rootPath, id: "task-2" })],
        nextCursor: null,
      },
      { thread: nativeThread({ cwd: otherProject.rootPath, id: "task-3" }) },
    ]);
    const runtime = createCodexRuntimeProvider({ client: rpc });
    const projectProvider = runtime.forProject(project);
    const otherProvider = runtime.forProject(otherProject);

    await expect(projectProvider.listTasks()).resolves.toMatchObject({
      data: [{ id: "task-1", projectId: project.id }],
    });
    await expect(otherProvider.listTasks()).resolves.toMatchObject({
      data: [{ id: "task-2", projectId: otherProject.id }],
    });
    await expect(otherProvider.startTask()).resolves.toMatchObject({
      id: "task-3",
      projectId: otherProject.id,
    });

    expect(rpc.notificationListenerCount).toBe(1);
    expect(rpc.serverRequestListenerCount).toBe(1);
    expect(rpc.calls).toEqual([
      {
        method: "thread/list",
        params: {
          cwd: project.rootPath,
          sortDirection: "desc",
          sortKey: "updated_at",
        },
      },
      {
        method: "thread/list",
        params: {
          cwd: otherProject.rootPath,
          sortDirection: "desc",
          sortKey: "updated_at",
        },
      },
      { method: "thread/start", params: { cwd: otherProject.rootPath } },
    ]);
    await expect(projectProvider.readTask("task-2")).resolves.toBeUndefined();
    expect(rpc.calls).toHaveLength(3);
    expect(() => runtime.forProject({ ...project, rootPath: "/workspace/Conflicting" })).toThrow(
      "project identity belongs to another cwd",
    );
  });

  it("validates background terminal ownership only on the first query", async () => {
    const rpc = new FakeRpcClient([
      { thread: nativeThread() },
      { data: [], nextCursor: null },
      { data: [], nextCursor: null },
    ]);
    const provider = createCodexRuntimeProvider({ client: rpc }).forProject(project);

    await expect(provider.listBackgroundTerminals("task-1")).resolves.toEqual({ data: [] });
    await expect(provider.listBackgroundTerminals("task-1")).resolves.toEqual({ data: [] });

    expect(rpc.calls).toEqual([
      { method: "thread/read", params: { includeTurns: true, threadId: "task-1" } },
      {
        method: "thread/backgroundTerminals/list",
        params: { limit: 100, threadId: "task-1" },
      },
      {
        method: "thread/backgroundTerminals/list",
        params: { limit: 100, threadId: "task-1" },
      },
    ]);
  });

  it("routes a review child thread through its parent task owner", async () => {
    const outerTurn = {
      completedAt: null,
      error: null,
      id: "review-outer-turn",
      items: [],
      startedAt: 1_753_228_800,
      status: "inProgress",
    };
    const workerTurn = {
      ...outerTurn,
      id: "review-worker-turn",
      items: [],
    };
    const rpc = new FakeRpcClient([
      { data: [nativeThread()], nextCursor: null },
      { reviewThreadId: "task-1", turn: outerTurn },
      { thread: nativeThread({ id: "reviewer-thread" }) },
    ]);
    const provider = createCodexRuntimeProvider({ client: rpc }).forProject(project);
    const events: AgentProviderEvent[] = [];
    provider.subscribeEvents((event) => events.push(event));
    await provider.listTasks();
    await provider.startReview("task-1", { type: "uncommitted_changes" });

    rpc.emitNotification("item/started", {
      item: { id: "review-mode", review: "current changes", type: "enteredReviewMode" },
      threadId: "task-1",
      turnId: "review-outer-turn",
    });
    rpc.emitNotification("thread/started", {
      thread: {
        id: "reviewer-thread",
        parentThreadId: "task-1",
        source: { subAgent: "review" },
      },
    });
    await vi.waitFor(() => {
      expect(rpc.calls.at(-1)).toEqual({
        method: "thread/resume",
        params: { threadId: "reviewer-thread" },
      });
    });
    rpc.emitNotification("turn/started", {
      threadId: "reviewer-thread",
      turn: workerTurn,
    });
    rpc.emitNotification("item/started", {
      item: {
        command: "git diff",
        cwd: "/workspace",
        id: "review-command",
        status: "inProgress",
        type: "commandExecution",
      },
      threadId: "reviewer-thread",
      turnId: "review-worker-turn",
    });

    expect(
      events.map((event) => [event.type, event.taskId, "turnId" in event ? event.turnId : null]),
    ).toEqual([
      ["item.started", "task-1", "review-outer-turn"],
      ["turn.started", "task-1", "review-outer-turn"],
      ["item.started", "task-1", "review-outer-turn"],
    ]);
  });

  it("releases all project runtime state before the same identity is reused", async () => {
    vi.useFakeTimers();
    const imageContent = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const imageUrl = `data:image/png;base64,${imageContent.toString("base64")}`;
    const rpc = new FakeRpcClient([
      { data: [nativeThread()], nextCursor: null },
      {
        thread: nativeThread({
          turns: [
            {
              completedAt: 1_753_232_400,
              error: null,
              id: "turn-image",
              items: [
                {
                  content: [
                    { text: "分析这张图", type: "text" },
                    { name: "diagram.png", type: "image", url: imageUrl },
                  ],
                  id: "message-image",
                  type: "userMessage",
                },
              ],
              startedAt: 1_753_228_800,
              status: "completed",
            },
          ],
        }),
      },
    ]);
    const runtime = createCodexRuntimeProvider({ client: rpc });
    const provider = runtime.forProject(project);

    try {
      await provider.listTasks();
      const snapshot = await provider.readTask("task-1");
      const item = snapshot?.turns[0]?.items[0];
      const attachmentId = item?.type === "message" ? item.attachments?.[0]?.id : undefined;
      if (attachmentId === undefined) {
        throw new Error("Expected historical attachment metadata");
      }
      rpc.emitServerRequest("timed-input", "item/tool/requestUserInput", {
        autoResolutionMs: 30_000,
        isBlocking: false,
        itemId: "timed-input-item",
        questions: [
          {
            header: "确认",
            id: "confirm",
            isOther: false,
            isSecret: false,
            options: [{ description: "继续", label: "Yes" }],
            question: "继续执行吗？",
          },
        ],
        threadId: "task-1",
        turnId: "turn-timed",
      });
      expect(vi.getTimerCount()).toBe(1);

      await runtime.releaseProject(project.id);

      expect(vi.getTimerCount()).toBe(0);
      expect(runtime.isTaskOwner(project, "task-1")).toBe(false);
      runtime.claimTask(project, "task-1");
      await expect(provider.readTaskAttachment("task-1", attachmentId)).resolves.toBeUndefined();
      const replacement = runtime.forProject({
        ...project,
        rootPath: "/workspace/RecreatedCodeAgent",
      });
      expect(replacement).not.toBe(provider);
    } finally {
      vi.useRealTimers();
    }
  });

  it("matches Windows project paths without case sensitivity", async () => {
    const windowsProject = { ...project, rootPath: "C:\\Users\\Test\\CodeAgent" };
    const rpc = new FakeRpcClient([
      {
        data: [nativeThread({ cwd: "c:\\users\\test\\codeagent" })],
        nextCursor: null,
      },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project: windowsProject });

    await expect(provider.listTasks()).resolves.toMatchObject({
      data: [{ id: "task-1", projectId: project.id }],
    });
  });

  it.runIf(process.platform !== "win32")(
    "matches Linux project paths through symbolic links",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "code-agent-provider-path-"));
      const projectRoot = join(root, "project");
      const projectAlias = join(root, "project-alias");
      try {
        await mkdir(projectRoot);
        await symlink(projectRoot, projectAlias);
        const linkedProject = { ...project, rootPath: projectRoot };
        const rpc = new FakeRpcClient([
          { data: [nativeThread({ cwd: projectAlias })], nextCursor: null },
        ]);
        const provider = createCodexAgentProvider({ client: rpc, project: linkedProject });

        await expect(provider.listTasks()).resolves.toMatchObject({
          data: [{ id: "task-1", projectId: project.id }],
        });
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    },
  );

  it("revalidates ownership before a sidebar mutation on a released task", async () => {
    const rpc = new FakeRpcClient([
      { data: [nativeThread()], nextCursor: null },
      { data: [], nextCursor: null },
      { status: "unsubscribed" },
      { thread: nativeThread({ turns: [] }) },
      {},
    ]);
    const runtime = createCodexRuntimeProvider({ client: rpc });
    const provider = runtime.forProject(project);
    await provider.listTasks();
    await provider.unsubscribeTask("task-1");

    await expect(provider.renameTask("task-1", "释放后重命名")).resolves.toBeUndefined();

    expect(rpc.calls.slice(-2)).toEqual([
      {
        method: "thread/read",
        params: { includeTurns: true, threadId: "task-1" },
      },
      {
        method: "thread/name/set",
        params: { name: "释放后重命名", threadId: "task-1" },
      },
    ]);
  });

  it("resumes a persisted Codex task before continuing it after runtime restart", async () => {
    const runningTurn = {
      completedAt: null,
      durationMs: null,
      error: null,
      id: "turn-after-restart",
      items: [],
      itemsView: { type: "full" },
      startedAt: 1_753_228_800,
      status: "inProgress",
    };
    const rpc = new FakeRpcClient([
      { thread: nativeThread() },
      { thread: nativeThread() },
      { turn: runningTurn },
    ]);
    const runtime = createCodexRuntimeProvider({ client: rpc });
    const provider = runtime.forProject(project);

    // 新 Runtime 只能先读取持久化历史，再显式恢复 Codex Thread 后继续发送。
    await expect(provider.readTask("task-1")).resolves.toMatchObject({ id: "task-1" });
    await expect(
      provider.startTurn(
        "task-1",
        { files: [], images: [], skills: [], text: "继续之前的任务", textAttachments: [] },
        {
          approvalPolicy: "on-request",
          approvalsReviewer: "user",
          model: "gpt-5.6-sol",
          reasoningEffort: "high",
          sandboxMode: "workspace-write",
        },
      ),
    ).resolves.toMatchObject({ id: "turn-after-restart", status: "running" });

    expect(rpc.calls.map(({ method }) => method)).toEqual([
      "thread/read",
      "thread/resume",
      "turn/start",
    ]);
    expect(rpc.calls[1]).toEqual({
      method: "thread/resume",
      params: { threadId: "task-1" },
    });
    expect(rpc.calls[2]).toMatchObject({
      method: "turn/start",
      params: {
        collaborationMode: {
          mode: "default",
          settings: {
            developer_instructions: null,
            model: "gpt-5.6-sol",
            reasoning_effort: "high",
          },
        },
      },
    });
  });

  it("steers the active Codex turn with the expected turn id", async () => {
    const rpc = new FakeRpcClient([
      { data: [nativeThread()], nextCursor: null },
      { turnId: "turn-1" },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    await provider.listTasks();

    await expect(
      provider.steerTurn("task-1", "turn-1", {
        files: [],
        images: [],
        skills: [],
        text: "优先修复失败测试",
        textAttachments: [],
      }),
    ).resolves.toBeUndefined();

    expect(rpc.calls.at(-1)).toEqual({
      method: "turn/steer",
      params: {
        expectedTurnId: "turn-1",
        input: [{ text: "优先修复失败测试", text_elements: [], type: "text" }],
        threadId: "task-1",
      },
    });
  });

  it("shares one resume request across concurrent turns for a restored task", async () => {
    let resolveResume!: (response: unknown) => void;
    const resumeResponse = new Promise<unknown>((resolveResponse) => {
      resolveResume = resolveResponse;
    });
    const createRunningTurn = (turnId: string) => ({
      completedAt: null,
      durationMs: null,
      error: null,
      id: turnId,
      items: [],
      itemsView: { type: "full" },
      startedAt: 1_753_228_800,
      status: "inProgress",
    });
    const rpc = new FakeRpcClient([
      { thread: nativeThread() },
      () => resumeResponse,
      { turn: createRunningTurn("turn-concurrent-1") },
      { turn: createRunningTurn("turn-concurrent-2") },
    ]);
    const provider = createCodexRuntimeProvider({ client: rpc }).forProject(project);
    const turnOptions = {
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      sandboxMode: "workspace-write",
    } as const;

    await provider.readTask("task-1");
    const firstTurn = provider.startTurn(
      "task-1",
      { files: [], images: [], skills: [], text: "并发消息一", textAttachments: [] },
      turnOptions,
    );
    const secondTurn = provider.startTurn(
      "task-1",
      { files: [], images: [], skills: [], text: "并发消息二", textAttachments: [] },
      turnOptions,
    );
    await Promise.resolve();

    // 两个续写请求必须等待同一个恢复操作，避免重复加载同一 Thread。
    expect(rpc.calls.map(({ method }) => method)).toEqual(["thread/read", "thread/resume"]);
    resolveResume({ thread: nativeThread() });
    await expect(Promise.all([firstTurn, secondTurn])).resolves.toMatchObject([
      { id: "turn-concurrent-1" },
      { id: "turn-concurrent-2" },
    ]);
    expect(rpc.calls.filter(({ method }) => method === "thread/resume")).toHaveLength(1);
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
      isBlocking: true,
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

  it("rejects user input requests without an explicit blocking state", async () => {
    const rpc = new FakeRpcClient([{ data: [nativeThread()], nextCursor: null }]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    const events: AgentProviderEvent[] = [];
    provider.subscribeEvents((event) => events.push(event));
    await provider.listTasks();

    rpc.emitServerRequest("missing-blocking", "item/tool/requestUserInput", {
      autoResolutionMs: null,
      itemId: "missing-blocking-item",
      questions: [
        {
          header: "确认",
          id: "confirm",
          isOther: false,
          isSecret: false,
          options: [{ description: "继续", label: "Yes" }],
          question: "继续执行吗？",
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
        id: "missing-blocking",
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
        isBlocking: false,
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
        isBlocking: false,
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
        isBlocking: false,
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
      isBlocking: false,
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
      isBlocking: true,
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
      isBlocking: true,
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

  it("lists enabled project skills and submits the native Codex skill input", async () => {
    const runningTurn = {
      completedAt: null,
      durationMs: null,
      error: null,
      id: "turn-skill",
      items: [],
      itemsView: { type: "full" },
      startedAt: 1_753_228_800,
      status: "inProgress",
    };
    const rpc = new FakeRpcClient([
      {
        data: [
          {
            cwd: project.rootPath,
            errors: [],
            skills: [
              {
                description: "Security audit specialist",
                enabled: true,
                interface: {
                  displayName: "Security review",
                  shortDescription: "审查认证、授权和敏感数据边界",
                },
                name: "review-security",
                path: "/Users/test/.codex/skills/review-security/SKILL.md",
                scope: "system",
                shortDescription: null,
              },
              {
                description: "Documentation specialist",
                enabled: true,
                interface: {
                  displayName: "Documentation writer",
                  shortDescription: "编写清晰的项目文档",
                },
                name: "documentation-writer",
                path: "/Users/test/.codex/skills/documentation-writer/SKILL.md",
                scope: "user",
                shortDescription: null,
              },
              {
                description: "Disabled skill",
                enabled: false,
                interface: null,
                name: "disabled-skill",
                path: "/Users/test/.codex/skills/disabled-skill/SKILL.md",
                scope: "user",
                shortDescription: null,
              },
            ],
          },
        ],
      },
      { thread: nativeThread() },
      { turn: runningTurn },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });

    const skillPage = await provider.listSkills();
    const selectedSkill = skillPage.data[0];
    const secondSkill = skillPage.data[1];
    if (selectedSkill === undefined || secondSkill === undefined) {
      throw new Error("Expected two enabled Codex skills");
    }
    expect(selectedSkill.id).toMatch(/^skill_[a-f0-9]{32}$/u);
    expect(skillPage).toEqual({
      data: [
        {
          description: "审查认证、授权和敏感数据边界",
          displayName: "Security review",
          id: selectedSkill.id,
          name: "review-security",
          scope: "system",
        },
        {
          description: "编写清晰的项目文档",
          displayName: "Documentation writer",
          id: secondSkill.id,
          name: "documentation-writer",
          scope: "user",
        },
      ],
      nextCursor: null,
    });
    await provider.startTask();
    await expect(
      provider.startTurn(
        "task-1",
        {
          files: [],
          images: [],
          skills: [
            { id: selectedSkill.id, name: "review-security" },
            { id: secondSkill.id, name: "documentation-writer" },
          ],
          text: "",
          textAttachments: [],
        },
        {
          approvalPolicy: "on-request",
          approvalsReviewer: "user",
          collaborationMode: "plan",
          model: "gpt-5.6-sol",
          reasoningEffort: "high",
          sandboxMode: "workspace-write",
        },
      ),
    ).resolves.toMatchObject({ id: "turn-skill", status: "running" });

    expect(rpc.calls).toEqual([
      {
        method: "skills/list",
        params: { cwds: [project.rootPath], forceReload: false },
      },
      { method: "thread/start", params: { cwd: project.rootPath } },
      {
        method: "turn/start",
        params: {
          approvalPolicy: "on-request",
          approvalsReviewer: "user",
          collaborationMode: {
            mode: "plan",
            settings: {
              developer_instructions: null,
              model: "gpt-5.6-sol",
              reasoning_effort: "high",
            },
          },
          effort: "high",
          input: [
            {
              text: "$review-security $documentation-writer",
              text_elements: [],
              type: "text",
            },
            {
              name: "review-security",
              path: "/Users/test/.codex/skills/review-security/SKILL.md",
              type: "skill",
            },
            {
              name: "documentation-writer",
              path: "/Users/test/.codex/skills/documentation-writer/SKILL.md",
              type: "skill",
            },
          ],
          model: "gpt-5.6-sol",
          sandboxPolicy: {
            excludeSlashTmp: false,
            excludeTmpdirEnvVar: false,
            networkAccess: false,
            type: "workspaceWrite",
            writableRoots: [],
          },
          threadId: "task-1",
        },
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
          files: [],
          images: [{ mediaType: "image/png", url: "data:image/jpeg;base64,aW1hZ2U=" }],
          skills: [],
          text: "",
          textAttachments: [],
        },
        {
          approvalPolicy: "on-request",
          approvalsReviewer: "user",
          model: "gpt-5.6-sol",
          reasoningEffort: "high",
          sandboxMode: "workspace-write",
        },
      ),
    ).rejects.toThrow("Provider image URL does not match its media type");
    expect(inputRpc.calls).toHaveLength(1);
  });

  it("reads the project sandbox mode from Codex config", async () => {
    const rpc = new FakeRpcClient([
      { config: { sandbox_mode: "read-only" }, layers: null, origins: {} },
      { config: { sandbox_mode: null }, layers: null, origins: {} },
      { config: { sandbox_mode: "host-write" }, layers: null, origins: {} },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });

    await expect(provider.readSandboxMode()).resolves.toBe("read-only");
    await expect(provider.readSandboxMode()).resolves.toBe("workspace-write");
    await expect(provider.readSandboxMode()).rejects.toThrow("config/read sandbox_mode is invalid");
    expect(rpc.calls).toEqual([
      { method: "config/read", params: { cwd: project.rootPath } },
      { method: "config/read", params: { cwd: project.rootPath } },
      { method: "config/read", params: { cwd: project.rootPath } },
    ]);
  });

  it("reads supported user defaults from Codex config without project layers", async () => {
    const rpc = new FakeRpcClient([
      {
        config: {
          approval_policy: "never",
          approvals_reviewer: "user",
          model: "gpt-5.6-sol",
          model_reasoning_effort: "high",
          sandbox_mode: "read-only",
        },
        layers: null,
        origins: {},
      },
      {
        config: {
          approval_policy: { granular: {} },
          approvals_reviewer: "guardian_subagent",
          model: null,
          model_reasoning_effort: null,
          sandbox_mode: null,
        },
        layers: null,
        origins: {},
      },
      {
        config: {
          approval_policy: "never",
          approvals_reviewer: "auto_review",
        },
        layers: null,
        origins: {},
      },
    ]);
    const runtime = createCodexRuntimeProvider({ client: rpc });

    await expect(runtime.readDefaultSettings()).resolves.toEqual({
      approvalPolicy: "never",
      approvalsReviewer: "user",
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      sandboxMode: "read-only",
    });
    await expect(runtime.readDefaultSettings()).resolves.toEqual({});
    await expect(runtime.readDefaultSettings()).resolves.toEqual({
      approvalPolicy: "on-request",
      approvalsReviewer: "auto_review",
    });
    expect(rpc.calls).toEqual([
      { method: "config/read", params: { includeLayers: false } },
      { method: "config/read", params: { includeLayers: false } },
      { method: "config/read", params: { includeLayers: false } },
    ]);
  });

  it("lists only MCP servers readable by the current task across all pages", async () => {
    const rpc = new FakeRpcClient([
      { thread: nativeThread() },
      {
        data: [
          {
            authStatus: "unsupported",
            name: "playwright",
            resourceTemplates: [],
            resources: [],
            serverInfo: null,
            tools: { browser_open: { description: "secret detail", inputSchema: {} } },
          },
        ],
        nextCursor: "page-2",
      },
      {
        data: [
          {
            authStatus: "unknown",
            name: "fast-context",
            resourceTemplates: [],
            resources: [],
            serverInfo: null,
            tools: {},
          },
          {
            authStatus: "notLoggedIn",
            name: "playwright",
            resourceTemplates: [],
            resources: [],
            serverInfo: null,
            tools: {},
          },
        ],
        nextCursor: null,
      },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });

    await provider.startTask();
    await expect(provider.listMcpServers("task-1")).resolves.toEqual({
      data: [
        {
          authStatus: "unknown",
          description: null,
          error: null,
          failureReason: null,
          name: "fast-context",
          status: "ready",
          title: null,
          toolCount: 0,
          version: null,
        },
        {
          authStatus: "unsupported",
          description: null,
          error: null,
          failureReason: null,
          name: "playwright",
          status: "ready",
          title: null,
          toolCount: 1,
          version: null,
        },
      ],
    });
    expect(rpc.calls).toEqual([
      { method: "thread/start", params: { cwd: project.rootPath } },
      {
        method: "mcpServerStatus/list",
        params: { detail: "toolsAndAuthOnly", threadId: "task-1" },
      },
      {
        method: "mcpServerStatus/list",
        params: { cursor: "page-2", detail: "toolsAndAuthOnly", threadId: "task-1" },
      },
    ]);
  });

  it("resumes a persisted task before listing its MCP servers", async () => {
    const rpc = new FakeRpcClient([
      { thread: nativeThread() },
      { thread: nativeThread() },
      { data: [], nextCursor: null },
    ]);
    const provider = createCodexRuntimeProvider({ client: rpc }).forProject(project);

    await provider.readTask("task-1");
    await expect(provider.listMcpServers("task-1")).resolves.toEqual({ data: [] });

    expect(rpc.calls.map(({ method }) => method)).toEqual([
      "thread/read",
      "thread/resume",
      "mcpServerStatus/list",
    ]);
  });

  it("resumes a persisted task before reloading its MCP servers", async () => {
    const rpc = new FakeRpcClient([
      { thread: nativeThread() },
      { thread: nativeThread() },
      {},
      { data: [], nextCursor: null },
    ]);
    const provider = createCodexRuntimeProvider({ client: rpc }).forProject(project);

    await provider.readTask("task-1");
    await expect(provider.reloadMcpServers("task-1")).resolves.toEqual({ data: [] });

    expect(rpc.calls.map(({ method }) => method)).toEqual([
      "thread/read",
      "thread/resume",
      "config/mcpServer/reload",
      "mcpServerStatus/list",
    ]);
  });

  it("merges MCP startup failures, redacts diagnostics, and reloads known task servers", async () => {
    const rpc = new FakeRpcClient([
      { thread: nativeThread() },
      {
        data: [
          {
            authStatus: "oAuth",
            name: "fast-context",
            resourceTemplates: [],
            resources: [],
            serverInfo: {
              description: "Semantic repository search at https://internal.example.com/docs",
              icons: null,
              name: "fast-context",
              title: "Fast Context",
              version: "1.2.0",
              websiteUrl: "https://example.com",
            },
            tools: {
              search: { description: "search", inputSchema: {}, name: "search" },
              trace: { description: "trace", inputSchema: {}, name: "trace" },
            },
          },
        ],
        nextCursor: null,
      },
      {},
      {
        data: [
          {
            authStatus: "oAuth",
            name: "fast-context",
            resourceTemplates: [],
            resources: [],
            serverInfo: {
              description: "Semantic repository search",
              icons: null,
              name: "fast-context",
              title: "Fast Context",
              version: "1.2.0",
              websiteUrl: "https://example.com",
            },
            tools: {
              search: { description: "search", inputSchema: {}, name: "search" },
              trace: { description: "trace", inputSchema: {}, name: "trace" },
            },
          },
        ],
        nextCursor: null,
      },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    const events: AgentProviderEvent[] = [];
    provider.subscribeEvents((event) => events.push(event));

    await provider.startTask();
    provider.receiveNotification("mcpServer/startupStatus/updated", {
      error:
        "OAuth request to https://auth.example.com/callback failed: API_TOKEN=top-secret-value",
      failureReason: "reauthenticationRequired",
      name: "docs",
      status: "failed",
      threadId: "task-1",
    });
    expect(events).toContainEqual({
      payload: {
        error: "OAuth request to [URL redacted] failed: API_TOKEN=[REDACTED]",
        failureReason: "reauthenticationRequired",
        name: "docs",
        status: "failed",
      },
      taskId: "task-1",
      type: "mcp_server.status_updated",
    });

    await expect(provider.listMcpServers("task-1")).resolves.toEqual({
      data: [
        {
          authStatus: null,
          description: null,
          error: "OAuth request to [URL redacted] failed: API_TOKEN=[REDACTED]",
          failureReason: "reauthenticationRequired",
          name: "docs",
          status: "failed",
          title: null,
          toolCount: 0,
          version: null,
        },
        {
          authStatus: "oAuth",
          description: "Semantic repository search at [URL redacted]",
          error: null,
          failureReason: null,
          name: "fast-context",
          status: "ready",
          title: "Fast Context",
          toolCount: 2,
          version: "1.2.0",
        },
      ],
    });
    await expect(provider.reloadMcpServers("task-1")).resolves.toMatchObject({
      data: [
        { error: null, name: "docs", status: "starting" },
        { error: null, name: "fast-context", status: "starting" },
      ],
    });
    expect(rpc.calls.slice(-2)).toEqual([
      { method: "config/mcpServer/reload", params: undefined },
      {
        method: "mcpServerStatus/list",
        params: { detail: "toolsAndAuthOnly", threadId: "task-1" },
      },
    ]);
  });

  it("restores MCP startup states when the reload RPC fails", async () => {
    const readyServerPage = {
      data: [
        {
          authStatus: "unsupported",
          name: "playwright",
          resourceTemplates: [],
          resources: [],
          serverInfo: null,
          tools: {},
        },
      ],
      nextCursor: null,
    };
    const rpc = new FakeRpcClient([
      { thread: nativeThread() },
      readyServerPage,
      new Error("reload unavailable"),
      readyServerPage,
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });

    await provider.startTask();
    await provider.listMcpServers("task-1");
    await expect(provider.reloadMcpServers("task-1")).rejects.toThrow("reload unavailable");
    await expect(provider.listMcpServers("task-1")).resolves.toMatchObject({
      data: [{ name: "playwright", status: "ready" }],
    });
  });

  it("rejects repeated MCP status cursors for a task", async () => {
    const rpc = new FakeRpcClient([
      { thread: nativeThread() },
      { data: [], nextCursor: "same-page" },
      { data: [], nextCursor: "same-page" },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });

    await provider.startTask();
    await expect(provider.listMcpServers("task-1")).rejects.toThrow(
      "mcpServerStatus/list returned a repeated cursor",
    );
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
          files: [
            {
              mediaType: "application/pdf",
              name: "specification.pdf",
              path: "/tmp/specification.pdf",
            },
          ],
          outputSchema: {
            additionalProperties: false,
            properties: { message: { type: "string" } },
            required: ["message"],
            type: "object",
          },
          skills: [],
          text: "实现写入闭环",
          textAttachments: [{ name: "Pasted text.txt", text: "第一行\n你好" }],
        },
        {
          approvalPolicy: "on-request",
          approvalsReviewer: "auto_review",
          model: "gpt-5.6-sol",
          reasoningEffort: "high",
          sandboxMode: "workspace-write",
        },
      ),
    ).resolves.toMatchObject({ id: "turn-1", status: "running" });
    await expect(provider.interruptTurn("task-1", "turn-1")).resolves.toBeUndefined();

    expect(rpc.calls).toEqual([
      { method: "thread/start", params: { cwd: "/workspace/CodeAgent" } },
      {
        method: "turn/start",
        params: {
          approvalPolicy: "on-request",
          approvalsReviewer: "auto_review",
          collaborationMode: {
            mode: "default",
            settings: {
              developer_instructions: null,
              model: "gpt-5.6-sol",
              reasoning_effort: "high",
            },
          },
          input: [
            { text: "实现写入闭环", text_elements: [], type: "text" },
            {
              text: "第一行\n你好",
              text_elements: [
                {
                  byteRange: { end: 16, start: 0 },
                  placeholder: "Pasted text.txt",
                },
              ],
              type: "text",
            },
            {
              name: "specification.pdf",
              path: "/tmp/specification.pdf",
              type: "mention",
            },
            { type: "image", url: "data:image/png;base64,aW1hZ2U=" },
          ],
          model: "gpt-5.6-sol",
          outputSchema: {
            additionalProperties: false,
            properties: { message: { type: "string" } },
            required: ["message"],
            type: "object",
          },
          effort: "high",
          sandboxPolicy: {
            excludeSlashTmp: false,
            excludeTmpdirEnvVar: false,
            networkAccess: false,
            type: "workspaceWrite",
            writableRoots: [],
          },
          threadId: "task-1",
        },
      },
      { method: "turn/interrupt", params: { threadId: "task-1", turnId: "turn-1" } },
    ]);
  });

  it("maps restricted and full-access sandbox policies", async () => {
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
    const rpc = new FakeRpcClient([
      { thread: nativeThread() },
      { turn: runningTurn },
      { turn: { ...runningTurn, id: "turn-2" } },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    await provider.startTask();

    await provider.startTurn(
      "task-1",
      { files: [], images: [], skills: [], text: "只读检查", textAttachments: [] },
      {
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        model: "gpt-5.6-sol",
        reasoningEffort: "high",
        sandboxMode: "read-only",
      },
    );
    await provider.startTurn(
      "task-1",
      { files: [], images: [], skills: [], text: "完全访问", textAttachments: [] },
      {
        approvalPolicy: "never",
        approvalsReviewer: "user",
        model: "gpt-5.6-sol",
        reasoningEffort: "high",
        sandboxMode: "danger-full-access",
      },
    );

    expect(rpc.calls[1]).toMatchObject({
      params: { sandboxPolicy: { networkAccess: false, type: "readOnly" } },
    });
    expect(rpc.calls[2]).toMatchObject({
      params: { sandboxPolicy: { type: "dangerFullAccess" } },
    });
  });

  it("maps task commands to Codex App Server RPC", async () => {
    const runningTurn = {
      completedAt: null,
      durationMs: null,
      error: null,
      id: "review-turn",
      items: [
        {
          content: [
            {
              text: "Review the current code changes (staged, unstaged, and untracked files) and provide prioritized findings.",
              type: "text",
            },
          ],
          id: "review-prompt-1",
          type: "userMessage",
        },
        {
          content: [
            {
              text: "Review the current code changes (staged, unstaged, and untracked files) and provide prioritized findings.",
              type: "text",
            },
          ],
          id: "review-prompt-2",
          type: "userMessage",
        },
        {
          id: "review-mode",
          review: "current changes",
          type: "enteredReviewMode",
        },
      ],
      itemsView: { type: "full" },
      startedAt: 1_753_228_800,
      status: "inProgress",
    };
    const rpc = new FakeRpcClient([
      { data: [nativeThread()], nextCursor: null },
      {},
      {},
      { reviewThreadId: "task-1", turn: runningTurn },
      {},
      { thread: nativeThread({ id: "task-2", preview: "续接任务" }) },
      { threadId: "task-1" },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    await provider.listTasks();

    await expect(provider.renameTask("task-1", "新的任务名称")).resolves.toBeUndefined();
    await expect(provider.archiveTask("task-1")).resolves.toBeUndefined();
    await expect(
      provider.startReview("task-1", { type: "base_branch", branch: "main" }),
    ).resolves.toMatchObject({
      id: "review-turn",
      items: [
        {
          id: "review-mode-review-turn",
          target: { branch: "main", type: "base_branch" },
          type: "review",
        },
      ],
      status: "running",
    });
    await expect(provider.compactTask("task-1")).resolves.toBeUndefined();
    await expect(provider.forkTask("task-1")).resolves.toMatchObject({ id: "task-2" });
    await expect(
      provider.uploadFeedback("task-1", {
        classification: "other",
        includeLogs: true,
        reason: "体验反馈",
      }),
    ).resolves.toBeUndefined();

    expect(rpc.calls.slice(1)).toEqual([
      {
        method: "thread/name/set",
        params: { name: "新的任务名称", threadId: "task-1" },
      },
      { method: "thread/archive", params: { threadId: "task-1" } },
      {
        method: "review/start",
        params: {
          delivery: "inline",
          target: { type: "baseBranch", branch: "main" },
          threadId: "task-1",
        },
      },
      { method: "thread/compact/start", params: { threadId: "task-1" } },
      { method: "thread/fork", params: { threadId: "task-1" } },
      {
        method: "feedback/upload",
        params: {
          classification: "other",
          includeLogs: true,
          reason: "体验反馈",
          threadId: "task-1",
        },
      },
    ]);
  });

  it("keeps live review prompts hidden behind one stable review item", async () => {
    const reviewPrompt = {
      content: [
        {
          text: "Review the current code changes (staged, unstaged, and untracked files) and provide prioritized findings.",
          type: "text",
        },
      ],
      id: "review-prompt",
      type: "userMessage",
    };
    const runningTurn = {
      completedAt: null,
      durationMs: null,
      error: null,
      id: "review-live-turn",
      items: [reviewPrompt],
      itemsView: { type: "full" },
      startedAt: 1_753_228_800,
      status: "inProgress",
    };
    const rpc = new FakeRpcClient([
      { data: [nativeThread()], nextCursor: null },
      { reviewThreadId: "task-1", turn: runningTurn },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    const events: AgentProviderEvent[] = [];
    provider.subscribeEvents((event) => events.push(event));
    await provider.listTasks();
    await provider.startReview("task-1", { type: "uncommitted_changes" });

    rpc.emitNotification("turn/started", { threadId: "task-1", turn: runningTurn });
    rpc.emitNotification("item/completed", {
      item: reviewPrompt,
      threadId: "task-1",
      turnId: "review-live-turn",
    });
    rpc.emitNotification("item/started", {
      item: { id: "review-mode", review: "current changes", type: "enteredReviewMode" },
      threadId: "task-1",
      turnId: "review-live-turn",
    });
    rpc.emitNotification("item/completed", {
      item: {
        id: "review-result",
        review: "- [P1] 修复消息顺序。",
        type: "exitedReviewMode",
      },
      threadId: "task-1",
      turnId: "review-live-turn",
    });

    expect(events).toMatchObject([
      {
        payload: {
          turn: {
            items: [
              {
                id: "review-mode-review-live-turn",
                target: { type: "uncommitted_changes" },
                type: "review",
              },
            ],
          },
        },
        type: "turn.started",
      },
      {
        itemId: "review-mode-review-live-turn",
        payload: { item: { type: "review" } },
        type: "item.started",
      },
      {
        itemId: "review-result",
        payload: {
          item: {
            role: "assistant",
            text: "- [P1] 修复消息顺序。",
            type: "message",
          },
        },
        type: "item.completed",
      },
    ]);
  });

  it("projects live reviewer operations into one outer review turn", async () => {
    const outerTurn = {
      completedAt: null,
      durationMs: null,
      error: null,
      id: "review-outer-turn",
      items: [],
      itemsView: { type: "full" },
      startedAt: 1_753_228_800,
      status: "inProgress",
    };
    const nestedTurn = {
      ...outerTurn,
      id: "reviewer-nested-turn",
      items: [
        {
          content: [
            {
              text: "Review the current code changes (staged, unstaged, and untracked files).",
              type: "text",
            },
          ],
          id: "nested-review-prompt",
          type: "userMessage",
        },
      ],
    };
    const rpc = new FakeRpcClient([
      { data: [nativeThread()], nextCursor: null },
      { reviewThreadId: "task-1", turn: outerTurn },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    const events: AgentProviderEvent[] = [];
    provider.subscribeEvents((event) => events.push(event));
    await provider.listTasks();
    await provider.startReview("task-1", { type: "uncommitted_changes" });

    rpc.emitNotification("item/started", {
      item: { id: "review-mode", review: "current changes", type: "enteredReviewMode" },
      threadId: "task-1",
      turnId: "review-outer-turn",
    });
    rpc.emitNotification("thread/started", {
      thread: {
        id: "reviewer-thread",
        parentThreadId: "task-1",
        source: { subAgent: "review" },
      },
    });
    rpc.emitNotification("turn/started", { threadId: "reviewer-thread", turn: nestedTurn });
    rpc.emitNotification("item/completed", {
      item: {
        id: "review-commentary",
        phase: "commentary",
        text: "正在检查变更。",
        type: "agentMessage",
      },
      threadId: "reviewer-thread",
      turnId: "reviewer-nested-turn",
    });
    rpc.emitNotification("item/started", {
      item: {
        command: "git diff",
        cwd: "/workspace",
        id: "review-command",
        status: "inProgress",
        type: "commandExecution",
      },
      threadId: "reviewer-thread",
      turnId: "reviewer-nested-turn",
    });
    rpc.emitNotification("item/completed", {
      item: {
        aggregatedOutput: "diff --git a/a.ts b/a.ts",
        command: "git diff",
        cwd: "/workspace",
        exitCode: 0,
        id: "review-command",
        status: "completed",
        type: "commandExecution",
      },
      threadId: "reviewer-thread",
      turnId: "reviewer-nested-turn",
    });
    rpc.emitNotification("item/completed", {
      item: {
        id: "review-failed-placeholder",
        review: "Reviewer failed to output a response.",
        type: "exitedReviewMode",
      },
      threadId: "task-1",
      turnId: "review-outer-turn",
    });
    rpc.emitNotification("item/completed", {
      item: {
        id: "worker-review-result",
        phase: "final_answer",
        text: "- [P1] 修复消息顺序。",
        type: "agentMessage",
      },
      threadId: "reviewer-thread",
      turnId: "reviewer-nested-turn",
    });
    rpc.emitNotification("turn/completed", {
      threadId: "reviewer-thread",
      turn: { ...nestedTurn, completedAt: 1_753_228_810, status: "completed" },
    });
    rpc.emitNotification("item/completed", {
      item: {
        id: "review-result",
        review: "- [P1] 修复消息顺序。",
        type: "exitedReviewMode",
      },
      threadId: "task-1",
      turnId: "review-outer-turn",
    });
    rpc.emitNotification("item/completed", {
      item: {
        id: "duplicate-review-result",
        phase: "final_answer",
        text: "- [P1] 修复消息顺序。",
        type: "agentMessage",
      },
      threadId: "task-1",
      turnId: "review-outer-turn",
    });
    rpc.emitNotification("turn/completed", {
      threadId: "task-1",
      turn: {
        ...outerTurn,
        completedAt: 1_753_228_820,
        items: [
          { id: "review-mode", review: "current changes", type: "enteredReviewMode" },
          {
            id: "review-result",
            review: "- [P1] 修复消息顺序。",
            type: "exitedReviewMode",
          },
          {
            id: "duplicate-review-result",
            phase: "final_answer",
            text: "- [P1] 修复消息顺序。",
            type: "agentMessage",
          },
        ],
        status: "completed",
      },
    });

    expect(events.map((event) => [event.type, "turnId" in event ? event.turnId : null])).toEqual([
      ["item.started", "review-outer-turn"],
      ["turn.started", "review-outer-turn"],
      ["item.completed", "review-outer-turn"],
      ["item.started", "review-outer-turn"],
      ["item.completed", "review-outer-turn"],
      ["item.completed", "review-outer-turn"],
      ["turn.completed", "review-outer-turn"],
    ]);
    expect(events[1]).toMatchObject({
      payload: {
        turn: {
          id: "review-outer-turn",
          items: [{ id: "review-mode-review-outer-turn", type: "review" }],
          status: "running",
        },
      },
    });
    expect(events[4]).toMatchObject({ payload: { item: { id: "review-command" } } });
    expect(events[5]).toMatchObject({
      payload: {
        item: {
          id: "worker-review-result",
          text: "- [P1] 修复消息顺序。",
          type: "message",
        },
      },
    });
    expect(events[6]).toMatchObject({
      payload: {
        turn: {
          id: "review-outer-turn",
          items: [{ id: "review-mode-review-outer-turn", type: "review" }],
          status: "completed",
        },
      },
    });
  });

  it("restores a running review worker from its child thread", async () => {
    const outerTurn = {
      completedAt: null,
      error: null,
      id: "review-outer-turn",
      items: [{ id: "review-mode", review: "current changes", type: "enteredReviewMode" }],
      startedAt: null,
      status: "completed",
    };
    const workerTurn = {
      completedAt: null,
      error: null,
      id: "review-worker-turn",
      items: [
        {
          content: [
            {
              text: "Review the current code changes (staged, unstaged, and untracked files).",
              type: "text",
            },
          ],
          id: "review-prompt",
          type: "userMessage",
        },
        {
          aggregatedOutput: "diff --git a/a.ts b/a.ts",
          command: "git diff",
          cwd: "/workspace",
          exitCode: 0,
          id: "review-command",
          status: "completed",
          type: "commandExecution",
        },
      ],
      startedAt: 1_753_228_800,
      status: "inProgress",
    };
    const rpc = new FakeRpcClient([
      {
        thread: nativeThread({ status: { type: "active" }, turns: [outerTurn] }),
      },
      {
        data: [
          nativeThread({
            id: "reviewer-thread",
            parentThreadId: "task-1",
            source: { subAgent: "review" },
          }),
        ],
        nextCursor: null,
      },
      {
        thread: nativeThread({
          id: "reviewer-thread",
          parentThreadId: "task-1",
          source: { subAgent: "review" },
          status: { type: "active" },
          turns: [workerTurn],
        }),
      },
      {},
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });

    await expect(provider.readTask("task-1")).resolves.toMatchObject({
      status: "running",
      turns: [
        {
          id: "review-outer-turn",
          items: [{ type: "review" }, { id: "review-command", type: "command" }],
          status: "running",
        },
      ],
    });
    await expect(provider.interruptTurn("task-1", "review-outer-turn")).resolves.toBeUndefined();
    expect(rpc.calls).toEqual([
      { method: "thread/read", params: { includeTurns: true, threadId: "task-1" } },
      {
        method: "thread/list",
        params: {
          limit: 100,
          parentThreadId: "task-1",
          sortDirection: "asc",
          sortKey: "created_at",
          sourceKinds: ["subAgentReview"],
        },
      },
      {
        method: "thread/read",
        params: { includeTurns: true, threadId: "reviewer-thread" },
      },
      {
        method: "turn/interrupt",
        params: { threadId: "reviewer-thread", turnId: "review-worker-turn" },
      },
    ]);
  });

  it("keeps the outer review result when the worker has no final message", async () => {
    const outerTurn = {
      completedAt: null,
      error: null,
      id: "review-outer-turn",
      items: [],
      startedAt: 1_753_228_800,
      status: "inProgress",
    };
    const rpc = new FakeRpcClient([
      { data: [nativeThread()], nextCursor: null },
      { reviewThreadId: "task-1", turn: outerTurn },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    const events: AgentProviderEvent[] = [];
    provider.subscribeEvents((event) => events.push(event));
    await provider.listTasks();
    await provider.startReview("task-1", { type: "uncommitted_changes" });

    rpc.emitNotification("item/started", {
      item: { id: "review-mode", review: "current changes", type: "enteredReviewMode" },
      threadId: "task-1",
      turnId: "review-outer-turn",
    });
    rpc.emitNotification("thread/started", {
      thread: {
        id: "reviewer-thread",
        parentThreadId: "task-1",
        source: { subAgent: "review" },
      },
    });
    rpc.emitNotification("item/completed", {
      item: {
        id: "review-commentary",
        phase: "commentary",
        text: "正在检查变更。",
        type: "agentMessage",
      },
      threadId: "reviewer-thread",
      turnId: "review-worker-turn",
    });
    rpc.emitNotification("item/started", {
      item: {
        command: "git diff",
        cwd: "/workspace",
        id: "outer-review-command",
        status: "inProgress",
        type: "commandExecution",
      },
      threadId: "task-1",
      turnId: "review-outer-turn",
    });
    rpc.emitNotification("item/completed", {
      item: {
        id: "review-result",
        review: "- [P1] 保留外层审查结论。",
        type: "exitedReviewMode",
      },
      threadId: "task-1",
      turnId: "review-outer-turn",
    });

    expect(events.at(-1)).toMatchObject({
      payload: {
        item: {
          id: "review-result",
          text: "- [P1] 保留外层审查结论。",
          type: "message",
        },
      },
      turnId: "review-outer-turn",
      type: "item.completed",
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        itemId: "outer-review-command",
        turnId: "review-outer-turn",
        type: "item.started",
      }),
    );
  });

  it("rejects task metadata mutations outside the current project", async () => {
    const rpc = new FakeRpcClient([]);
    const provider = createCodexAgentProvider({ client: rpc, project });

    await expect(provider.renameTask("unknown-task", "新的任务名称")).rejects.toThrow(
      "does not belong to the active project",
    );
    await expect(provider.archiveTask("unknown-task")).rejects.toThrow(
      "does not belong to the active project",
    );
    expect(rpc.calls).toEqual([]);
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
    const startedSubagentItem = {
      agentsStates: {},
      id: "subagent-spawn",
      model: "gpt-5.6-sol",
      prompt: "理解前端项目",
      reasoningEffort: "high",
      receiverThreadIds: [],
      senderThreadId: "task-1",
      status: "inProgress",
      tool: "spawnAgent",
      type: "collabAgentToolCall",
    };
    const completedTurn = {
      ...runningTurn,
      completedAt: 1_753_228_801,
      items: [completedItem],
      status: "completed",
    };

    rpc.emitNotification("turn/started", { threadId: "task-1", turn: runningTurn });
    rpc.emitNotification("item/started", {
      item: startedSubagentItem,
      threadId: "task-1",
      turnId: "turn-1",
    });
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
        itemId: "subagent-spawn",
        payload: {
          item: {
            id: "subagent-spawn",
            input: {
              model: "gpt-5.6-sol",
              prompt: "理解前端项目",
              reasoningEffort: "high",
              receiverTaskIds: [],
              senderTaskId: "task-1",
            },
            name: "agent/spawn",
            output: { agents: [] },
            status: "running",
            type: "tool",
          },
        },
        taskId: "task-1",
        turnId: "turn-1",
        type: "item.started",
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
        payload: { delta: "分析", field: "summary", sectionIndex: 0 },
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
    expect(events).toHaveLength(10);
  });

  it("publishes generated images as readable realtime attachment metadata", async () => {
    const imageContent = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const encodedImage = imageContent.toString("base64");
    const rpc = new FakeRpcClient([{ data: [nativeThread()], nextCursor: null }]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    const events: AgentProviderEvent[] = [];
    provider.subscribeEvents((event) => events.push(event));
    await provider.listTasks();

    rpc.emitNotification("item/completed", {
      item: {
        id: "generated-image-live",
        result: encodedImage,
        revisedPrompt: null,
        status: "completed",
        type: "imageGeneration",
      },
      threadId: "task-1",
      turnId: "turn-1",
    });

    const event = events[0];
    const item = event?.type === "item.completed" ? event.payload.item : undefined;
    const attachmentId = item?.type === "message" ? item.attachments?.[0]?.id : undefined;
    expect(event).toEqual({
      itemId: "generated-image-live",
      payload: {
        item: {
          attachments: [
            {
              id: attachmentId,
              kind: "image",
              mediaType: "image/png",
              name: "生成图片-1.png",
              size: imageContent.byteLength,
            },
          ],
          id: "generated-image-live",
          role: "assistant",
          text: "",
          type: "message",
        },
      },
      taskId: "task-1",
      turnId: "turn-1",
      type: "item.completed",
    });
    expect(JSON.stringify(event)).not.toContain(encodedImage);
    await expect(provider.readTaskAttachment("task-1", attachmentId ?? "")).resolves.toMatchObject({
      content: imageContent,
      mediaType: "image/png",
    });
  });

  it("publishes structured item starts for live operation status", async () => {
    const rpc = new FakeRpcClient([{ data: [nativeThread()], nextCursor: null }]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    const events: AgentProviderEvent[] = [];
    provider.subscribeEvents((event) => events.push(event));
    await provider.listTasks();

    rpc.emitNotification("item/started", {
      item: {
        aggregatedOutput: null,
        command: "sed -n '1,240p' SKILL.md",
        commandActions: [],
        cwd: "/workspace/CodeAgent",
        durationMs: null,
        exitCode: null,
        id: "command-read-skill",
        processId: null,
        source: "agent",
        status: "inProgress",
        type: "commandExecution",
      },
      threadId: "task-1",
      turnId: "turn-1",
    });
    rpc.emitNotification("item/started", {
      item: {
        arguments: { query: "live operation status" },
        error: null,
        id: "tool-search",
        result: null,
        server: "fast-context",
        status: "inProgress",
        tool: "search",
        type: "mcpToolCall",
      },
      threadId: "task-1",
      turnId: "turn-1",
    });
    rpc.emitNotification("item/started", {
      item: { id: "image-view", path: "/workspace/CodeAgent/status.png", type: "imageView" },
      threadId: "task-1",
      turnId: "turn-1",
    });

    expect(events).toMatchObject([
      {
        itemId: "command-read-skill",
        payload: {
          item: {
            command: "sed -n '1,240p' SKILL.md",
            status: "running",
            type: "command",
          },
        },
        type: "item.started",
      },
      {
        itemId: "tool-search",
        payload: {
          item: { name: "fast-context/search", status: "running", type: "tool" },
        },
        type: "item.started",
      },
      {
        itemId: "image-view",
        payload: {
          item: { label: "查看图片", status: "running", type: "activity" },
        },
        type: "item.started",
      },
    ]);
  });

  it("streams commentary and final answers as normal assistant messages", async () => {
    const rpc = new FakeRpcClient([{ data: [nativeThread()], nextCursor: null }]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    const events: unknown[] = [];
    provider.subscribeEvents((event) => {
      events.push(event);
    });
    await provider.listTasks();

    const commentaryItem = {
      id: "commentary-1",
      memoryCitation: null,
      phase: "commentary",
      text: "正在扫描项目结构。",
      type: "agentMessage",
    };
    rpc.emitNotification("item/started", {
      item: { ...commentaryItem, text: "" },
      threadId: "task-1",
      turnId: "turn-1",
    });
    rpc.emitNotification("item/agentMessage/delta", {
      delta: "正在扫描项目结构。",
      itemId: "commentary-1",
      threadId: "task-1",
      turnId: "turn-1",
    });
    rpc.emitNotification("item/completed", {
      item: commentaryItem,
      threadId: "task-1",
      turnId: "turn-1",
    });

    const finalAnswerItem = {
      id: "answer-1",
      memoryCitation: null,
      phase: "final_answer",
      text: "项目已理解。",
      type: "agentMessage",
    };
    rpc.emitNotification("item/started", {
      item: { ...finalAnswerItem, text: "" },
      threadId: "task-1",
      turnId: "turn-1",
    });
    rpc.emitNotification("item/agentMessage/delta", {
      delta: "项目已理解。",
      itemId: "answer-1",
      threadId: "task-1",
      turnId: "turn-1",
    });
    rpc.emitNotification("item/completed", {
      item: finalAnswerItem,
      threadId: "task-1",
      turnId: "turn-1",
    });
    rpc.emitNotification("turn/completed", {
      threadId: "task-1",
      turn: {
        completedAt: 1_753_228_801,
        error: null,
        id: "turn-1",
        items: [commentaryItem, finalAnswerItem],
        startedAt: 1_753_228_800,
        status: "completed",
      },
    });

    expect(events).toEqual([
      {
        itemId: "commentary-1",
        payload: { delta: "正在扫描项目结构。" },
        taskId: "task-1",
        turnId: "turn-1",
        type: "message.delta",
      },
      {
        itemId: "commentary-1",
        payload: {
          item: {
            id: "commentary-1",
            phase: "commentary",
            role: "assistant",
            text: "正在扫描项目结构。",
            type: "message",
          },
        },
        taskId: "task-1",
        turnId: "turn-1",
        type: "item.completed",
      },
      {
        itemId: "answer-1",
        payload: { delta: "项目已理解。" },
        taskId: "task-1",
        turnId: "turn-1",
        type: "message.delta",
      },
      {
        itemId: "answer-1",
        payload: {
          item: {
            id: "answer-1",
            phase: "final_answer",
            role: "assistant",
            text: "项目已理解。",
            type: "message",
          },
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
            items: [
              {
                id: "commentary-1",
                phase: "commentary",
                role: "assistant",
                text: "正在扫描项目结构。",
                type: "message",
              },
              {
                id: "answer-1",
                phase: "final_answer",
                role: "assistant",
                text: "项目已理解。",
                type: "message",
              },
            ],
            startedAt: "2025-07-23T00:00:00.000Z",
            status: "completed",
          },
        },
        taskId: "task-1",
        turnId: "turn-1",
        type: "turn.completed",
      },
    ]);
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
    const rpc = new FakeRpcClient([
      { data: [nativeThread({ section: PINNED_THREAD_SECTION })], nextCursor: "next-cursor" },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });

    await expect(provider.getCapabilities()).resolves.toEqual({
      feedback: { upload: true },
      provider: "codex",
      skills: { list: true, use: true },
      tasks: { fork: true, list: true, read: true, start: true },
      turns: {
        compact: true,
        interrupt: true,
        review: true,
        start: true,
        steer: true,
      },
    });
    await expect(provider.listTasks({ cursor: "cursor", limit: 25 })).resolves.toEqual({
      data: [
        {
          id: "task-1",
          pinned: true,
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

  it("does not treat a custom Codex section as pinned", async () => {
    const rpc = new FakeRpcClient([
      {
        data: [
          nativeThread({ section: { id: "01984de2-8f74-7c91-a3b2-5c5e937cf999", name: "Later" } }),
        ],
        nextCursor: null,
      },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });

    await expect(provider.listTasks()).resolves.toMatchObject({
      data: [{ id: "task-1", pinned: false }],
    });
  });

  it.each([
    [true, null, PINNED_THREAD_SECTION],
    [false, PINNED_THREAD_SECTION, null],
  ])(
    "moves a task into the native pinned section when pinned is %s",
    async (pinned, before, after) => {
      const rpc = new FakeRpcClient([
        { data: [nativeThread({ section: before })], nextCursor: null },
        {},
        { thread: nativeThread({ section: after }) },
      ]);
      const provider = createCodexAgentProvider({ client: rpc, project });
      await provider.listTasks();

      await expect(provider.pinTask("task-1", pinned)).resolves.toMatchObject({
        id: "task-1",
        pinned,
        projectId: "code-agent",
      });
      expect(rpc.calls.slice(-2)).toEqual([
        {
          method: "thread/section/move",
          params: {
            sectionId: pinned ? PINNED_THREAD_SECTION.id : null,
            threadId: "task-1",
          },
        },
        {
          method: "thread/read",
          params: { includeTurns: false, threadId: "task-1" },
        },
      ]);
    },
  );

  it.each([
    ["another task", nativeThread({ id: "task-2", section: PINNED_THREAD_SECTION })],
    ["another project", nativeThread({ cwd: "/workspace/Other", section: PINNED_THREAD_SECTION })],
    ["another pinned state", nativeThread({ section: null })],
  ])("rejects pinned section state read for %s", async (_case, thread) => {
    const rpc = new FakeRpcClient([{ data: [nativeThread()], nextCursor: null }, {}, { thread }]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    await provider.listTasks();

    await expect(provider.pinTask("task-1", true)).rejects.toThrow(CodexProtocolMappingError);
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
                {
                  content: [
                    {
                      text: "$review-security",
                      type: "text",
                    },
                  ],
                  id: "i1",
                  type: "userMessage",
                },
                {
                  content: [
                    {
                      text: [
                        "<skill>",
                        "<name>review-security</name>",
                        "<path>/Users/test/.codex/skills/review-security/SKILL.md</path>",
                        "---",
                        "name: review-security",
                        "description: Security audit specialist",
                        "---",
                        "Review authentication boundaries.",
                        "</skill>",
                      ].join("\n"),
                      type: "text",
                    },
                  ],
                  id: "i1-skill",
                  type: "userMessage",
                },
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
            {
              id: "i1",
              role: "user",
              skills: [{ name: "review-security" }],
              text: "",
              type: "message",
            },
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

  it("maps Codex local images to metadata and reads their bytes on demand", async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "code-agent-image-"));
    const imagePath = join(temporaryDirectory, "diagram.png");
    const imageContent = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    writeFileSync(imagePath, imageContent);
    const rpc = new FakeRpcClient([
      {
        thread: nativeThread({
          turns: [
            {
              completedAt: 1_753_232_400,
              error: null,
              id: "turn-image",
              items: [
                {
                  content: [
                    { text: "分析这张图", type: "text" },
                    { path: imagePath, type: "localImage" },
                  ],
                  id: "message-image",
                  type: "userMessage",
                },
              ],
              startedAt: 1_753_228_800,
              status: "completed",
            },
          ],
        }),
      },
      { data: [], nextCursor: null },
      { status: "unsubscribed" },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });

    try {
      const snapshot = await provider.readTask("task-1");
      const item = snapshot?.turns[0]?.items[0];
      const attachmentId = item?.type === "message" ? item.attachments?.[0]?.id : undefined;
      if (attachmentId === undefined) {
        throw new Error("Expected historical attachment metadata");
      }

      expect(item).toEqual({
        attachments: [
          {
            id: attachmentId,
            kind: "image",
            mediaType: "image/png",
            name: "diagram.png",
            size: imageContent.byteLength,
          },
        ],
        id: "message-image",
        role: "user",
        text: "分析这张图",
        type: "message",
      });
      expect(attachmentId).not.toHaveLength(0);
      expect(JSON.stringify(snapshot)).not.toContain(imagePath);
      expect(JSON.stringify(snapshot)).not.toContain("data:image");
      await expect(provider.readTaskAttachment("task-1", attachmentId)).resolves.toMatchObject({
        content: imageContent,
        mediaType: "image/png",
        name: "diagram.png",
        size: imageContent.byteLength,
      });
      await expect(provider.unsubscribeTask("task-1")).resolves.toBe("unsubscribed");
      await expect(provider.readTaskAttachment("task-1", attachmentId)).resolves.toBeUndefined();
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });

  it("maps generated images to assistant attachment metadata without exposing Base64", async () => {
    const imageContent = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const encodedImage = imageContent.toString("base64");
    const rpc = new FakeRpcClient([
      {
        thread: nativeThread({
          turns: [
            {
              completedAt: 1_753_232_400,
              error: null,
              id: "turn-generated-image",
              items: [
                {
                  id: "generated-image-1",
                  result: encodedImage,
                  revisedPrompt: "一张架构图",
                  status: "completed",
                  type: "imageGeneration",
                },
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
    const item = snapshot?.turns[0]?.items[0];
    const attachmentId = item?.type === "message" ? item.attachments?.[0]?.id : undefined;
    if (attachmentId === undefined) {
      throw new Error("Expected generated image attachment metadata");
    }

    expect(item).toEqual({
      attachments: [
        {
          id: attachmentId,
          kind: "image",
          mediaType: "image/png",
          name: "生成图片-1.png",
          size: imageContent.byteLength,
        },
      ],
      id: "generated-image-1",
      role: "assistant",
      text: "",
      type: "message",
    });
    expect(JSON.stringify(snapshot)).not.toContain(encodedImage);
    await expect(provider.readTaskAttachment("task-1", attachmentId)).resolves.toMatchObject({
      content: imageContent,
      mediaType: "image/png",
      name: "生成图片-1.png",
      size: imageContent.byteLength,
    });
  });

  it("maps Codex text elements to attachments instead of exposing pasted content", async () => {
    const attachmentText = "第一行\n你好";
    const attachmentBytes = Buffer.from(attachmentText);
    const rpc = new FakeRpcClient([
      {
        thread: nativeThread({
          turns: [
            {
              completedAt: 1_753_232_400,
              error: null,
              id: "turn-pasted-text",
              items: [
                {
                  content: [
                    { text: "分析附件", type: "text" },
                    {
                      text: attachmentText,
                      text_elements: [
                        {
                          byteRange: { end: attachmentBytes.byteLength, start: 0 },
                          placeholder: "Pasted text.txt",
                        },
                      ],
                      type: "text",
                    },
                  ],
                  id: "message-pasted-text",
                  type: "userMessage",
                },
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
    const item = snapshot?.turns[0]?.items[0];
    const attachmentId = item?.type === "message" ? item.attachments?.[0]?.id : undefined;
    if (attachmentId === undefined) {
      throw new Error("Expected pasted text attachment metadata");
    }

    expect(item).toEqual({
      attachments: [
        {
          id: attachmentId,
          kind: "text",
          mediaType: "text/plain",
          name: "Pasted text.txt",
          size: attachmentBytes.byteLength,
        },
      ],
      id: "message-pasted-text",
      role: "user",
      text: "分析附件",
      type: "message",
    });
    await expect(provider.readTaskAttachment("task-1", attachmentId)).resolves.toMatchObject({
      content: attachmentBytes,
      mediaType: "text/plain",
      name: "Pasted text.txt",
      size: attachmentBytes.byteLength,
    });
  });

  it("keeps attachment authorization stable across repeated snapshot reads", async () => {
    const imageContent = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const imageUrl = `data:image/png;base64,${imageContent.toString("base64")}`;
    const thread = nativeThread({
      turns: [
        {
          completedAt: 1_753_232_400,
          error: null,
          id: "turn-image",
          items: [
            {
              content: [
                { text: "分析这张图", type: "text" },
                { name: "diagram.png", type: "image", url: imageUrl },
              ],
              id: "message-image",
              type: "userMessage",
            },
          ],
          startedAt: 1_753_228_800,
          status: "completed",
        },
      ],
    });
    const rpc = new FakeRpcClient([{ thread }, { thread }]);
    const provider = createCodexAgentProvider({ client: rpc, project });

    const firstSnapshot = await provider.readTask("task-1");
    const secondSnapshot = await provider.readTask("task-1");
    const firstItem = firstSnapshot?.turns[0]?.items[0];
    const secondItem = secondSnapshot?.turns[0]?.items[0];
    const firstAttachmentId =
      firstItem?.type === "message" ? firstItem.attachments?.[0]?.id : undefined;
    const secondAttachmentId =
      secondItem?.type === "message" ? secondItem.attachments?.[0]?.id : undefined;

    expect(firstAttachmentId).toBeDefined();
    expect(secondAttachmentId).toBe(firstAttachmentId);
    await expect(
      provider.readTaskAttachment("task-1", firstAttachmentId ?? ""),
    ).resolves.toMatchObject({ content: imageContent, mediaType: "image/png" });
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

  it("reads a newly started task before its first turn is materialized", async () => {
    const rpc = new FakeRpcClient([
      { thread: nativeThread() },
      new RpcResponseError({
        code: -32600,
        data: null,
        message:
          "thread task-1 is not materialized yet; includeTurns is unavailable before first user message",
      }),
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });

    await provider.startTask();

    await expect(provider.readTask("task-1")).resolves.toMatchObject({
      contextUsage: null,
      id: "task-1",
      pendingRequests: [],
      projectId: project.id,
      status: "idle",
      turns: [],
    });
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
