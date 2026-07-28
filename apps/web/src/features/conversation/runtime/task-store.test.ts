import type { AgentEvent, AgentTaskSnapshotResponse, PendingRequest } from "@code-agent/protocol";
import { describe, expect, it } from "vitest";

import { createTaskStore, createTaskStoreRegistry } from "./task-store.js";

const timestamp = "2026-07-28T00:00:00.000Z";

function createResponse(
  overrides: Partial<AgentTaskSnapshotResponse["snapshot"]> = {},
): AgentTaskSnapshotResponse {
  return {
    checkpoint: { sequence: 10, sessionId: "session-1" },
    snapshot: {
      contextUsage: null,
      id: "task-1",
      pendingRequests: [],
      pinned: false,
      projectId: "project-1",
      settings: {
        approvalPolicy: "on-request",
        model: "gpt-5.6-sol",
        reasoningEffort: "high",
        sandboxMode: "workspace-write",
      },
      status: "running",
      title: "归一化运行时",
      turns: [
        {
          completedAt: timestamp,
          error: null,
          id: "turn-completed",
          items: [
            {
              id: "message-completed",
              role: "assistant",
              text: "已完成",
              type: "message",
            },
          ],
          startedAt: timestamp,
          status: "completed",
        },
        {
          completedAt: null,
          error: null,
          id: "turn-running",
          items: [
            {
              id: "message-running",
              role: "assistant",
              text: "开始",
              type: "message",
            },
          ],
          startedAt: timestamp,
          status: "running",
        },
      ],
      updatedAt: timestamp,
      ...overrides,
    },
  };
}

function eventEnvelope(sequence: number) {
  return {
    provider: "codex",
    sequence,
    sessionId: "session-1",
    taskId: "task-1",
    timestamp: "2026-07-28T00:00:01.000Z",
    version: 1,
  } as const;
}

function createPendingRequest<Status extends PendingRequest["status"] = "pending">(
  status: Status = "pending" as Status,
): PendingRequest & Readonly<{ status: Status }> {
  return {
    availableDecisions: ["allow", "deny"],
    command: "pnpm test",
    createdAt: timestamp,
    cwd: "/workspace",
    expiresAt: null,
    itemId: "command-1",
    networkAccess: null,
    projectId: "project-1",
    reason: null,
    requestId: "request-1",
    status,
    taskId: "task-1",
    turnId: "turn-running",
    type: "command_approval",
  };
}

describe("task store", () => {
  it("normalizes hydration and reconstructs a compatibility snapshot", () => {
    const pendingRequest = createPendingRequest();
    const response = createResponse({ pendingRequests: [pendingRequest] });
    const store = createTaskStore({ projectId: "project-1", taskId: "task-1" });

    store.getState().hydrate(response);
    const state = store.getState();

    expect(state.turnIds).toEqual(["turn-completed", "turn-running"]);
    expect(state.turnsById["turn-running"]).not.toHaveProperty("items");
    expect(state.itemIdsByTurnId["turn-running"]).toEqual(["message-running"]);
    expect(state.itemsById["message-running"]).toMatchObject({ text: "开始" });
    expect(state.pendingRequestIds).toEqual(["request-1"]);
    expect(state.pendingRequestsById["request-1"]).toBe(pendingRequest);
    expect(state.reconstructSnapshot()).toEqual(response.snapshot);
  });

  it("updates one existing delta without replacing structural references", () => {
    const store = createTaskStore({ projectId: "project-1", taskId: "task-1" }, createResponse());
    const previousState = store.getState();
    const previousCompletedTurn = previousState.turnsById["turn-completed"];
    const previousRunningTurn = previousState.turnsById["turn-running"];
    const previousCompletedItem = previousState.itemsById["message-completed"];
    const previousRunningItemIds = previousState.itemIdsByTurnId["turn-running"];
    const previousStructureRevision = previousState.itemStructureRevision;

    store.getState().applyEvents([
      {
        ...eventEnvelope(11),
        itemId: "message-running",
        payload: { delta: "继续" },
        turnId: "turn-running",
        type: "message.delta",
      },
    ]);
    const nextState = store.getState();

    expect(nextState.turnsById["turn-completed"]).toBe(previousCompletedTurn);
    expect(nextState.turnsById["turn-running"]).toBe(previousRunningTurn);
    expect(nextState.itemsById["message-completed"]).toBe(previousCompletedItem);
    expect(nextState.itemIdsByTurnId["turn-running"]).toBe(previousRunningItemIds);
    expect(nextState.itemStructureRevision).toBe(previousStructureRevision);
    expect(nextState.itemsById["message-running"]).toMatchObject({ text: "开始继续" });
  });

  it("rejects item identifiers reused by another turn", () => {
    const duplicateItemResponse = createResponse({
      turns: [
        {
          completedAt: timestamp,
          error: null,
          id: "turn-first",
          items: [{ id: "shared-item", role: "assistant", text: "一", type: "message" }],
          startedAt: timestamp,
          status: "completed",
        },
        {
          completedAt: timestamp,
          error: null,
          id: "turn-second",
          items: [{ id: "shared-item", role: "assistant", text: "二", type: "message" }],
          startedAt: timestamp,
          status: "completed",
        },
      ],
    });

    expect(() =>
      createTaskStore({ projectId: "project-1", taskId: "task-1" }, duplicateItemResponse),
    ).toThrow(/multiple turns/);
  });

  it("creates delta items and keeps command output UTF-8 safe within both bounds", () => {
    const store = createTaskStore({ projectId: "project-1", taskId: "task-1" }, createResponse());
    const oversizedOutput = `${"一".repeat(400_000)}\n${"line\n".repeat(10_001)}`;

    store.getState().applyEvents([
      {
        ...eventEnvelope(11),
        itemId: "reasoning-new",
        payload: { delta: "摘要", field: "summary" },
        turnId: "turn-running",
        type: "reasoning.delta",
      },
      {
        ...eventEnvelope(12),
        itemId: "command-new",
        payload: { delta: oversizedOutput },
        turnId: "turn-running",
        type: "command.output_delta",
      },
    ]);

    const state = store.getState();
    const commandItem = state.itemsById["command-new"];
    expect(state.itemsById["reasoning-new"]).toMatchObject({ summary: "摘要" });
    expect(commandItem).toMatchObject({ outputTruncated: true, type: "command" });
    if (commandItem?.type !== "command") {
      throw new Error("Expected normalized command item");
    }
    expect(new TextEncoder().encode(commandItem.output ?? "").byteLength).toBeLessThanOrEqual(
      1_048_576,
    );
    expect(commandItem.output).not.toContain("�");
    expect((commandItem.output?.match(/\n/g) ?? []).length).toBeLessThanOrEqual(9_999);
  });

  it("uses terminal entities as authoritative while preserving confirmed errors", () => {
    const store = createTaskStore({ projectId: "project-1", taskId: "task-1" }, createResponse());
    const events: AgentEvent[] = [
      {
        ...eventEnvelope(11),
        payload: { message: "上游服务不可用", willRetry: false },
        turnId: "turn-running",
        type: "provider.error",
      },
      {
        ...eventEnvelope(12),
        itemId: "message-running",
        payload: {
          item: {
            id: "message-running",
            role: "assistant",
            text: "Item 权威终态",
            type: "message",
          },
        },
        turnId: "turn-running",
        type: "item.completed",
      },
      {
        ...eventEnvelope(13),
        payload: {
          turn: {
            completedAt: "2026-07-28T00:00:02.000Z",
            error: null,
            id: "turn-running",
            items: [
              {
                id: "message-running",
                role: "assistant",
                text: "Turn 权威终态",
                type: "message",
              },
            ],
            startedAt: timestamp,
            status: "failed",
          },
        },
        turnId: "turn-running",
        type: "turn.completed",
      },
    ];

    store.getState().applyEvents(events);
    const snapshot = store.getState().reconstructSnapshot();

    expect(snapshot?.status).toBe("failed");
    expect(snapshot?.turns[1]).toMatchObject({
      error: "上游服务不可用",
      items: [{ text: "Turn 权威终态" }],
      status: "failed",
    });
  });

  it("preserves streamed assistant content when an interrupted terminal payload is partial", () => {
    const store = createTaskStore({ projectId: "project-1", taskId: "task-1" }, createResponse());

    store.getState().applyEvents([
      {
        ...eventEnvelope(11),
        itemId: "message-running",
        payload: { delta: "，但保留这段回复" },
        turnId: "turn-running",
        type: "message.delta",
      },
      {
        ...eventEnvelope(12),
        payload: {
          turn: {
            completedAt: "2026-07-28T00:00:02.000Z",
            error: null,
            id: "turn-running",
            items: [],
            startedAt: timestamp,
            status: "interrupted",
          },
        },
        turnId: "turn-running",
        type: "turn.completed",
      },
    ]);

    expect(store.getState().reconstructSnapshot()?.turns[1]).toMatchObject({
      items: [{ id: "message-running", text: "开始，但保留这段回复" }],
      status: "interrupted",
    });
  });

  it("replaces a submitted user placeholder when the provider item starts", () => {
    const submittedUserItemId = "submitted-user-turn-running";
    const store = createTaskStore(
      { projectId: "project-1", taskId: "task-1" },
      createResponse({
        turns: [
          {
            completedAt: null,
            error: null,
            id: "turn-running",
            items: [
              {
                id: submittedUserItemId,
                role: "user",
                text: "执行检查",
                type: "message",
              },
            ],
            startedAt: timestamp,
            status: "running",
          },
        ],
      }),
    );

    store.getState().applyEvents([
      {
        ...eventEnvelope(11),
        itemId: "provider-user-item",
        payload: {
          item: {
            id: "provider-user-item",
            role: "user",
            text: "执行检查",
            type: "message",
          },
        },
        turnId: "turn-running",
        type: "item.started",
      },
    ]);

    expect(store.getState().itemIdsByTurnId["turn-running"]).toEqual(["provider-user-item"]);
    expect(store.getState().itemsById[submittedUserItemId]).toBeUndefined();
  });

  it("tracks usage and pending request lifecycle without reordering requests", () => {
    const store = createTaskStore({ projectId: "project-1", taskId: "task-1" }, createResponse());
    const pendingRequest = createPendingRequest();
    const resolvedRequest = createPendingRequest("resolved");

    store.getState().applyEvents([
      {
        ...eventEnvelope(11),
        payload: { usage: { contextWindow: 200_000, usedTokens: 25_000 } },
        turnId: "turn-running",
        type: "usage.updated",
      },
      {
        ...eventEnvelope(12),
        itemId: pendingRequest.itemId,
        payload: { request: pendingRequest },
        turnId: pendingRequest.turnId,
        type: "pending_request.created",
      },
      {
        ...eventEnvelope(13),
        itemId: resolvedRequest.itemId,
        payload: { request: resolvedRequest },
        turnId: resolvedRequest.turnId,
        type: "pending_request.resolved",
      },
    ]);

    const state = store.getState();
    expect(state.snapshotMetadata?.contextUsage).toEqual({
      contextWindow: 200_000,
      usedTokens: 25_000,
    });
    expect(state.pendingRequestIds).toEqual(["request-1"]);
    expect(state.pendingRequestsById["request-1"]?.status).toBe("resolved");
  });

  it("rejects wrong identities and deduplicates old sequences", () => {
    const store = createTaskStore({ projectId: "project-1", taskId: "task-1" }, createResponse());
    const validEvent: AgentEvent = {
      ...eventEnvelope(11),
      itemId: "message-running",
      payload: { delta: "一次" },
      turnId: "turn-running",
      type: "message.delta",
    };
    const wrongTaskEvent = { ...validEvent, sequence: 12, taskId: "task-other" };
    const wrongSessionEvent = { ...validEvent, sequence: 13, sessionId: "session-other" };

    store.getState().applyEvents([validEvent, validEvent, wrongTaskEvent, wrongSessionEvent]);

    expect(store.getState().itemsById["message-running"]).toMatchObject({ text: "开始一次" });
    expect(store.getState().checkpoint?.sequence).toBe(11);
    expect(() => {
      store.getState().hydrate(createResponse({ id: "task-other" }));
    }).toThrow(/identity/);
  });

  it("updates connection and error state independently", () => {
    const store = createTaskStore({ projectId: "project-1", taskId: "task-1" });
    const connectionError = new Error("连接中断");

    store.getState().setConnectionState("reconnecting");
    store.getState().setError(connectionError);

    expect(store.getState()).toMatchObject({
      connectionState: "reconnecting",
      error: connectionError,
    });
  });
});

describe("task store registry", () => {
  it("reuses a composite identity and isolates equal task ids across projects", () => {
    const registry = createTaskStoreRegistry({ maxRetainedStores: 3 });

    const firstStore = registry.acquire("project-1", "task-1");
    const reusedStore = registry.acquire("project-1", "task-1");
    const otherProjectStore = registry.acquire("project-2", "task-1");

    expect(reusedStore).toBe(firstStore);
    expect(otherProjectStore).not.toBe(firstStore);
  });

  it("evicts only the least-recently-used safe store and recreates it later", () => {
    const registry = createTaskStoreRegistry({ maxRetainedStores: 1 });
    const firstStore = registry.acquire("project-1", "task-1");
    firstStore.getState().hydrate(createResponse({ status: "idle" }));
    registry.release("project-1", "task-1");

    const secondStore = registry.acquire("project-1", "task-2");
    expect(registry.peek("project-1", "task-1")).toBe(firstStore);
    secondStore.getState().hydrate(createResponse({ id: "task-2", status: "idle" }));
    registry.release("project-1", "task-2");

    expect(registry.peek("project-1", "task-1")).toBeUndefined();
    expect(registry.acquire("project-1", "task-1")).not.toBe(firstStore);
    expect(secondStore).not.toBe(firstStore);
  });

  it("retains consumed stores and evicts every inactive store when retention is disabled", () => {
    const registry = createTaskStoreRegistry({ maxRetainedStores: 0 });

    const consumedStore = registry.acquire("project-1", "task-consumed");
    expect(registry.peek("project-1", "task-consumed")).toBe(consumedStore);

    registry.acquire("project-1", "task-unhydrated");
    registry.release("project-1", "task-unhydrated");
    expect(registry.peek("project-1", "task-unhydrated")).toBeUndefined();

    const runningStore = registry.acquire("project-1", "task-running");
    runningStore.getState().hydrate(createResponse({ id: "task-running", status: "running" }));
    registry.release("project-1", "task-running");
    expect(registry.peek("project-1", "task-running")).toBeUndefined();

    const pendingStore = registry.acquire("project-1", "task-pending");
    const pendingRequest = {
      ...createPendingRequest(),
      taskId: "task-pending",
      status: "pending" as const,
    } as PendingRequest & Readonly<{ status: "pending" }>;
    pendingStore.getState().hydrate(
      createResponse({
        id: "task-pending",
        pendingRequests: [pendingRequest],
        status: "idle",
      }),
    );
    registry.release("project-1", "task-pending");
    expect(registry.peek("project-1", "task-pending")).toBeUndefined();
  });
});
