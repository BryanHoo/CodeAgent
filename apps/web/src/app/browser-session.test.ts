import { describe, expect, it, vi } from "vitest";

import { synchronizeBrowserSession } from "./browser-session.js";

describe("synchronizeBrowserSession", () => {
  it("refreshes the current page when the server instance changes", async () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const requestSession = vi
      .fn()
      .mockResolvedValueOnce({ instanceId: "runtime-1", version: 1 })
      .mockResolvedValueOnce({ instanceId: "runtime-2", version: 1 });
    const reload = vi.fn();

    await expect(synchronizeBrowserSession({ reload, requestSession, storage })).resolves.toBe(
      "initialized",
    );
    await expect(synchronizeBrowserSession({ reload, requestSession, storage })).resolves.toBe(
      "reloaded",
    );

    expect(reload).toHaveBeenCalledOnce();
  });
});
