/// <reference types="node" />

import { memoryUsage } from "node:process";

import type { AgentEvent, AgentTaskSnapshotResponse } from "@code-agent/protocol";
import { describe, expect, it, vi } from "vitest";

import performanceBudgets from "../../../../../../tests/performance-budgets.json" with { type: "json" };
import { createTaskStore } from "./task-store.js";

const timestamp = "2026-08-02T00:00:00.000Z";

function createResponse(taskId = "task-performance"): AgentTaskSnapshotResponse {
  return {
    checkpoint: { sequence: 0, sessionId: "session-performance" },
    snapshot: {
      contextUsage: null,
      id: taskId,
      pendingRequests: [],
      pinned: false,
      projectId: "project-performance",
      settings: {
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        model: "gpt-5.6-sol",
        reasoningEffort: "high",
        sandboxMode: "workspace-write",
      },
      status: "running",
      title: "Delta performance",
      turns: [
        {
          completedAt: null,
          error: null,
          id: "turn-performance",
          items: [
            {
              id: "message-performance",
              role: "assistant",
              text: "",
              type: "message",
            },
          ],
          startedAt: timestamp,
          status: "running",
        },
      ],
      updatedAt: timestamp,
    },
  };
}

function createDeltaEvents(taskId: string, count: number): AgentEvent[] {
  return Array.from({ length: count }, (_, index) => ({
    itemId: "message-performance",
    payload: { delta: "x" },
    provider: "codex",
    sequence: index + 1,
    sessionId: "session-performance",
    taskId,
    timestamp,
    turnId: "turn-performance",
    type: "message.delta" as const,
    version: 2 as const,
  }));
}

function collectHeap(): number {
  const gc = (globalThis as typeof globalThis & { gc?: () => void }).gc;
  if (gc === undefined) {
    throw new Error("Performance tests require explicit GC");
  }
  gc();
  gc();
  return memoryUsage().heapUsed;
}

function exerciseStoreLifecycle(iteration: number, deltaCount: number): void {
  const taskId = `task-heap-${String(iteration)}`;
  const store = createTaskStore(
    { projectId: "project-performance", taskId },
    createResponse(taskId),
  );
  store.getState().applyEvents(createDeltaEvents(taskId, deltaCount));
  expect(store.getState().getItem("message-performance")).toMatchObject({
    text: "x".repeat(deltaCount),
  });
}

describe("TaskStore performance", () => {
  it("replays 50,000 deltas with one Item notification within budget", () => {
    const response = createResponse();
    const store = createTaskStore(
      { projectId: "project-performance", taskId: response.snapshot.id },
      response,
    );
    const itemStore = store.getState().itemStoresById.get("message-performance");
    if (itemStore === undefined) {
      throw new Error("Expected the performance message item store");
    }
    const listener = vi.fn();
    const unsubscribe = itemStore.subscribe(listener);
    const events = createDeltaEvents(response.snapshot.id, performanceBudgets.delta.clientEvents);

    const startedAt = performance.now();
    store.getState().applyEvents(events);
    const durationMs = performance.now() - startedAt;
    unsubscribe();

    expect(listener).toHaveBeenCalledOnce();
    expect(store.getState().getItem("message-performance")).toMatchObject({
      text: "x".repeat(performanceBudgets.delta.clientEvents),
    });
    expect(durationMs).toBeLessThan(performanceBudgets.delta.maxClientReplayMs);
  });

  it("releases repeated Store lifecycles without sustained Heap growth", () => {
    const { deltasPerIteration, iterations, maxGrowthBytes } = performanceBudgets.heap;
    // 先预热转换器和 JIT，避免一次性初始化被误判为生命周期泄漏。
    for (let iteration = 0; iteration < 5; iteration += 1) {
      exerciseStoreLifecycle(iteration, deltasPerIteration);
    }
    const heapBefore = collectHeap();

    for (let iteration = 0; iteration < iterations; iteration += 1) {
      exerciseStoreLifecycle(iteration + 5, deltasPerIteration);
    }

    const heapGrowth = collectHeap() - heapBefore;
    expect(heapGrowth).toBeLessThanOrEqual(maxGrowthBytes);
  });
});
