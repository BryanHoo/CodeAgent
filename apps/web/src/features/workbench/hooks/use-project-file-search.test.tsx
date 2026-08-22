import { describe, expect, it, vi } from "vitest";

import { projectFileSearchQueryOptions } from "./use-project-file-search.js";

describe("projectFileSearchQueryOptions", () => {
  it("scopes file search by Project and forwards query cancellation", async () => {
    const controller = new AbortController();
    const page = { data: [{ name: "main.tsx", path: "src/main.tsx" }] };
    const client = { searchProjectFiles: vi.fn(() => Promise.resolve(page)) };
    const options = projectFileSearchQueryOptions(
      client,
      "code-agent",
      "/workspace/CodeAgent",
      "main",
      true,
    );

    expect(options.queryKey).toEqual([
      "projects",
      "code-agent",
      "/workspace/CodeAgent",
      "file-search",
      "main",
    ]);
    expect(options.enabled).toBe(true);
    await expect(options.queryFn?.({ signal: controller.signal } as never)).resolves.toEqual(page);
    expect(client.searchProjectFiles).toHaveBeenCalledWith(
      "code-agent",
      "/workspace/CodeAgent",
      "main",
      {
        signal: controller.signal,
      },
    );
  });
});
