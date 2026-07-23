import { describe, expect, it } from "vitest";

import type { AgentProvider } from "./agent-provider.js";

describe("AgentProvider", () => {
  it("defines a provider-independent read-only contract", async () => {
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
  });
});
