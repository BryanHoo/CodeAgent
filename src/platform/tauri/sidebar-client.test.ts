import { describe, expect, it, vi } from "vitest";

import { TauriSidebarClient, type InvokeImplementation } from "./sidebar-client.js";

describe("TauriSidebarClient", () => {
  it("maps sidebar reads and project creation to direct Tauri commands", async () => {
    const ensureRuntime = vi.fn(async () => undefined);
    const invoke = vi.fn(async (command: string) => {
      if (command === "list_projects") return { data: [], nextCursor: null };
      if (command === "list_tasks") return { data: [], nextCursor: null };
      return {
        project: {
          createdAt: "2025-01-01T00:00:00Z",
          id: "project-a",
          name: "a",
          roots: [{ id: "root-a", path: "/work/a" }],
        },
      };
    });
    const client = new TauriSidebarClient({
      ensureRuntime,
      invoke: invoke as InvokeImplementation,
    });

    await client.listProjects();
    await client.listTasks("project-a", {
      archived: true,
      cursor: "cursor-a",
      limit: 20,
      pinned: true,
      searchTerm: "fix",
    });
    await client.addProject(["/work/a", "/work/shared"]);

    expect(ensureRuntime).toHaveBeenCalledTimes(3);
    expect(invoke).toHaveBeenNthCalledWith(1, "list_projects");
    expect(invoke).toHaveBeenNthCalledWith(2, "list_tasks", {
      input: {
        archived: true,
        cursor: "cursor-a",
        limit: 20,
        pinned: true,
        projectId: "project-a",
        searchTerm: "fix",
      },
    });
    expect(invoke).toHaveBeenNthCalledWith(3, "add_project", {
      rootPaths: ["/work/a", "/work/shared"],
    });
  });
});
