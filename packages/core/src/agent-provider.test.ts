import { describe, expect, it } from "vitest";

import type { AgentProvider, AgentProviderEvent } from "./agent-provider.js";

describe("AgentProvider", () => {
  it("defines provider-independent read and mutation contracts", async () => {
    const listeners = new Set<(event: AgentProviderEvent) => void>();
    const provider: AgentProvider = {
      getCapabilities() {
        return Promise.resolve({
          provider: "fake",
          tasks: { list: true, read: true, start: true },
          turns: { interrupt: true, rollback: true, start: true },
        });
      },
      listTasks() {
        return Promise.resolve({ data: [], nextCursor: null });
      },
      listModels() {
        return Promise.resolve({
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
        });
      },
      readTask() {
        return Promise.resolve(undefined);
      },
      rollbackLatestTurn(taskId) {
        expect(taskId).toBe("task-1");
        return Promise.resolve();
      },
      resolvePendingRequest(input) {
        return Promise.resolve({
          availableDecisions: ["allow", "deny"],
          command: "pnpm check",
          createdAt: "2026-07-23T00:00:00.000Z",
          cwd: "/workspace/CodeAgent",
          expiresAt: null,
          itemId: input.itemId,
          networkAccess: null,
          projectId: input.projectId,
          reason: null,
          requestId: input.requestId,
          status: "resolved",
          taskId: input.taskId,
          turnId: input.turnId,
          type: "command_approval",
        });
      },
      startTask() {
        return Promise.resolve({
          id: "task-1",
          pinned: false,
          projectId: "project-1",
          title: "新任务",
          updatedAt: "2026-07-23T00:00:00.000Z",
        });
      },
      startTurn(taskId, input, options) {
        expect(options).toEqual({
          approvalPolicy: "on-request",
          model: "gpt-5.6-sol",
          reasoningEffort: "high",
        });
        return Promise.resolve({
          completedAt: null,
          error: null,
          id: `${taskId}-turn`,
          items: [{ id: "input-1", role: "user", text: input.text, type: "message" }],
          startedAt: "2026-07-23T00:00:00.000Z",
          status: "running",
        });
      },
      interruptTurn(taskId, turnId) {
        expect(taskId).toBe("task-1");
        expect(turnId).toBe("turn-1");
        return Promise.resolve();
      },
      subscribeEvents(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    };

    await expect(provider.getCapabilities()).resolves.toEqual({
      provider: "fake",
      tasks: { list: true, read: true, start: true },
      turns: { interrupt: true, rollback: true, start: true },
    });
    await expect(provider.listTasks({ limit: 25 })).resolves.toEqual({
      data: [],
      nextCursor: null,
    });
    await expect(provider.listModels()).resolves.toMatchObject({
      data: [{ id: "gpt-5.6-sol", isDefault: true }],
    });
    await expect(provider.readTask("missing-task")).resolves.toBeUndefined();
    await expect(
      provider.resolvePendingRequest({
        itemId: "item-1",
        projectId: "project-1",
        requestId: "number:7",
        resolution: { decision: "allow" },
        taskId: "task-1",
        turnId: "turn-1",
        type: "command_approval",
      }),
    ).resolves.toMatchObject({ requestId: "number:7", status: "resolved" });
    await expect(provider.startTask()).resolves.toMatchObject({ id: "task-1" });
    await expect(
      provider.startTurn(
        "task-1",
        {
          images: [{ mediaType: "image/png", url: "data:image/png;base64,aW1hZ2U=" }],
          text: "继续",
        },
        { approvalPolicy: "on-request", model: "gpt-5.6-sol", reasoningEffort: "high" },
      ),
    ).resolves.toMatchObject({ id: "task-1-turn", status: "running" });
    await expect(provider.interruptTurn("task-1", "turn-1")).resolves.toBeUndefined();
    await expect(provider.rollbackLatestTurn("task-1")).resolves.toBeUndefined();

    const received: AgentProviderEvent[] = [];
    const unsubscribe = provider.subscribeEvents((event) => {
      received.push(event);
    });
    const event: AgentProviderEvent = {
      itemId: "item-1",
      payload: { delta: "实时" },
      taskId: "task-1",
      turnId: "turn-1",
      type: "message.delta",
    };
    for (const listener of listeners) {
      listener(event);
    }
    unsubscribe();
    for (const listener of listeners) {
      listener(event);
    }

    expect(received).toEqual([event]);
  });
});
