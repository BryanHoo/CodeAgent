import { describe, expect, it, vi } from "vitest";

import { createAppQueryClient, navigateToTaskFromNotification } from "./providers.js";
import { router } from "./router.js";

describe("createAppQueryClient", () => {
  it("uses stable defaults for a local long-running project", () => {
    const queryClient = createAppQueryClient();
    const queryDefaults = queryClient.getDefaultOptions().queries;

    expect(queryDefaults?.gcTime).toBe(120_000);
    expect(queryDefaults?.retry).toBe(1);
    expect(queryDefaults?.staleTime).toBe(30_000);
    expect(queryDefaults?.refetchOnWindowFocus).toBe(false);
  });

  it("routes notification clicks inside the current application", () => {
    const navigate = vi.spyOn(router, "navigate").mockResolvedValue();

    navigateToTaskFromNotification("project / 1", "task / 1");

    expect(navigate).toHaveBeenCalledWith({
      params: { projectId: "project / 1", taskId: "task / 1" },
      to: "/p/$projectId/t/$taskId",
    });
    navigate.mockRestore();
  });
});
