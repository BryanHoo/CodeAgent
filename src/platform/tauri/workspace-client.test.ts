import { describe, expect, it, vi } from "vitest";

import { NativeCommandError, type InvokeImplementation } from "./native-client.js";
import { TauriWorkspaceClient } from "./workspace-client.js";

describe("TauriWorkspaceClient", () => {
  it("routes guarded file operations through Tauri commands", async () => {
    const invoke = vi.fn(async () => ({}));
    const client = new TauriWorkspaceClient({
      ensureRuntime: vi.fn(async () => undefined),
      invoke: invoke as InvokeImplementation,
    });

    await client.listProjectFiles("project-a", "/work/a", "src");
    await client.searchProjectFiles("project-a", "/work/a", "main", "search-a");
    await client.renameProjectFile("project-a", "/work/a", {
      name: "lib.rs",
      path: "src/main.rs",
    });
    await client.deleteProjectFile("project-a", "/work/a", { path: "src/old.rs" });
    await client.readProjectSourceFile("project-a", "/work/a", "src/lib.rs", 10);

    expect(invoke).toHaveBeenNthCalledWith(1, "list_project_files", {
      directoryPath: "src",
      projectId: "project-a",
      rootPath: "/work/a",
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "search_project_files", {
      projectId: "project-a",
      query: "main",
      rootPath: "/work/a",
      sessionId: "search-a",
    });
    expect(invoke).toHaveBeenNthCalledWith(3, "rename_project_file", {
      input: { name: "lib.rs", path: "src/main.rs" },
      projectId: "project-a",
      rootPath: "/work/a",
    });
    expect(invoke).toHaveBeenNthCalledWith(4, "delete_project_file", {
      input: { path: "src/old.rs" },
      projectId: "project-a",
      rootPath: "/work/a",
    });
    expect(invoke).toHaveBeenNthCalledWith(5, "read_project_source_file", {
      cursor: 10,
      path: "src/lib.rs",
      projectId: "project-a",
      rootPath: "/work/a",
    });
  });

  it("routes Git reads through Tauri commands", async () => {
    const invoke = vi.fn(async () => ({}));
    const client = new TauriWorkspaceClient({
      ensureRuntime: vi.fn(async () => undefined),
      invoke: invoke as InvokeImplementation,
    });

    await client.getProjectGitStatus("project-a", { includeDiff: true, rootPath: "/work/a" });
    await client.getProjectGitHistory("project-a", { cursor: "20", rootPath: "/work/a" });
    await client.getProjectGitCommitFiles("project-a", {
      rootPath: "/work/a",
      sha: "a".repeat(40),
    });
    await client.getProjectGitCommitFileDiff("project-a", {
      path: "src/main.rs",
      rootPath: "/work/a",
      sha: "a".repeat(40),
    });

    expect(invoke).toHaveBeenNthCalledWith(1, "get_project_git_status", {
      input: { includeDiff: true, rootPath: "/work/a" },
      projectId: "project-a",
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "get_project_git_history", {
      input: { cursor: "20", rootPath: "/work/a" },
      projectId: "project-a",
    });
    expect(invoke).toHaveBeenNthCalledWith(3, "get_project_git_commit_files", {
      input: { rootPath: "/work/a", sha: "a".repeat(40) },
      projectId: "project-a",
    });
    expect(invoke).toHaveBeenNthCalledWith(4, "get_project_git_commit_file_diff", {
      input: { path: "src/main.rs", rootPath: "/work/a", sha: "a".repeat(40) },
      projectId: "project-a",
    });
  });

  it("adds native request ids to cancellable Git and directory reads", async () => {
    const invoke = vi.fn(async (_command: string, _args?: Record<string, unknown>) => ({}));
    const client = new TauriWorkspaceClient({
      ensureRuntime: vi.fn(async () => undefined),
      invoke: invoke as InvokeImplementation,
    });
    const signal = new AbortController().signal;
    const sha = "a".repeat(40);

    await client.getProjectGitStatus("project-a", { rootPath: "/work/a" }, { signal });
    await client.getProjectGitHistory("project-a", { rootPath: "/work/a" }, { signal });
    await client.getProjectGitCommitFiles("project-a", { rootPath: "/work/a", sha }, { signal });
    await client.getProjectGitCommitFileDiff(
      "project-a",
      { path: "src/main.rs", rootPath: "/work/a", sha },
      { signal },
    );
    await client.listProjectFiles("project-a", "/work/a", "src", { signal });

    for (const [, args] of invoke.mock.calls) {
      expect(args).toMatchObject({ requestId: expect.any(String) });
    }
  });

  it("stops an in-flight file search when its signal is aborted", async () => {
    let resolveSearch: (() => void) | undefined;
    const invoke = vi.fn(
      (command: string) =>
        new Promise<unknown>((resolve) => {
          if (command === "search_project_files") resolveSearch = () => resolve({ data: [] });
          else resolve({});
        }),
    );
    const client = new TauriWorkspaceClient({
      ensureRuntime: vi.fn(async () => undefined),
      invoke: invoke as InvokeImplementation,
    });
    const controller = new AbortController();

    const search = client.searchProjectFiles(
      "project-a",
      "/work/a",
      "main",
      "search-a",
      { signal: controller.signal },
    );
    await vi.waitFor(() => expect(resolveSearch).toBeTypeOf("function"));
    controller.abort();
    resolveSearch?.();
    await search;

    expect(invoke).toHaveBeenCalledWith("stop_project_file_search", {
      projectId: "project-a",
      rootPath: "/work/a",
      sessionId: "search-a",
    });
  });

  it("does not start a file search with an already aborted signal", async () => {
    const invoke = vi.fn(async () => ({ data: [] }));
    const client = new TauriWorkspaceClient({
      ensureRuntime: vi.fn(async () => undefined),
      invoke: invoke as InvokeImplementation,
    });
    const controller = new AbortController();
    controller.abort();

    await expect(
      client.searchProjectFiles("project-a", "/work/a", "main", "search-a", {
        signal: controller.signal,
      }),
    ).rejects.toHaveProperty("name", "AbortError");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("preserves structured workspace errors", async () => {
    const client = new TauriWorkspaceClient({
      ensureRuntime: vi.fn(async () => undefined),
      invoke: vi.fn(async () =>
        Promise.reject({
          code: "SNAPSHOT_MISMATCH",
          message: "workspace snapshot changed; refresh and retry",
        }),
      ) as InvokeImplementation,
    });

    await expect(
      client.switchProjectBranch("project-a", "/work/a", {
        branch: "main",
        expectedSnapshot: "a".repeat(64),
      }),
    ).rejects.toEqual(
      new NativeCommandError(
        "SNAPSHOT_MISMATCH",
        "workspace snapshot changed; refresh and retry",
      ),
    );
  });
});
