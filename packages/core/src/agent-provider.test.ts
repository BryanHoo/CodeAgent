import { describe, expect, it } from "vitest";

import type { AgentProvider, AgentProviderEvent } from "./agent-provider.js";

describe("AgentProvider", () => {
  it("defines a provider-independent read-only contract", async () => {
    const listeners = new Set<(event: AgentProviderEvent) => void>();
    const provider: AgentProvider = {
      getCapabilities() {
        return Promise.resolve({ provider: "fake", tasks: { list: true, read: true } });
      },
      listTasks() {
        return Promise.resolve({ data: [], nextCursor: null });
      },
      readTask() {
        return Promise.resolve(undefined);
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
      tasks: { list: true, read: true },
    });
    await expect(provider.listTasks({ limit: 25 })).resolves.toEqual({
      data: [],
      nextCursor: null,
    });
    await expect(provider.readTask("missing-task")).resolves.toBeUndefined();

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
