import { describe, expect, it, vi } from "vitest";
import type { PendingRequest } from "@code-agent/protocol";

import {
  buildProjectAttachmentUrl,
  buildProjectImageFileUrl,
  CodeAgentClient,
  CodeAgentHttpError,
  CodeAgentMutationError,
  CodeAgentResponseError,
} from "./http-client.js";

const task = {
  id: "task-1",
  pinned: false,
  projectId: "code-agent",
  title: "结构化历史",
  updatedAt: "2026-07-23T00:01:00.000Z",
};
const taskSettings = {
  approvalPolicy: "never" as const,
  approvalsReviewer: "user" as const,
  model: "gpt-5.6-sol",
  reasoningEffort: "high",
  sandboxMode: "workspace-write" as const,
};
const projectDefaults = {
  model: taskSettings.model,
  reasoningEffort: taskSettings.reasoningEffort,
  sandboxMode: taskSettings.sandboxMode,
};
const globalSettings = {
  ...taskSettings,
  commitMessageModel: "gpt-5.6-sol",
  commitMessagePrompt: "",
  commitMessageReasoningEffort: "high",
  defaultOpenAppId: "visual-studio-code" as const,
  followUpBehavior: "queue" as const,
};

const modelPage = {
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
};
const skill = {
  description: "审查认证、授权和敏感数据边界",
  displayName: "Security review",
  id: "skill_01J00000000000000000000000",
  name: "review-security",
  scope: "system" as const,
};
const skillPage = {
  data: [skill],
  nextCursor: null,
};
const mcpServerPage = {
  data: ["fast-context", "chrome-devtools"].map((name) => ({
    authStatus: "unsupported" as const,
    description: null,
    error: null,
    failureReason: null,
    name,
    status: "ready" as const,
    title: null,
    toolCount: 2,
    version: "1.0.0",
  })),
};
const pixelBytes = Uint8Array.from(
  globalThis.atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  ),
  (value) => value.charCodeAt(0),
);
const attachment = {
  id: "attachment-1",
  kind: "image",
  mediaType: "image/png",
  name: "screen.png",
  size: 68,
};

const pendingRequest: PendingRequest = {
  availableDecisions: ["allow", "deny"],
  command: "pnpm check",
  createdAt: "2026-07-23T00:02:00.000Z",
  cwd: "/workspace/CodeAgent",
  expiresAt: null,
  itemId: "command-1",
  networkAccess: null,
  projectId: "code-agent",
  reason: null,
  requestId: "number:7",
  status: "pending",
  taskId: "task-1",
  turnId: "turn-1",
  type: "command_approval",
};

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function parseJsonRequestBody(body: BodyInit | null | undefined): unknown {
  if (typeof body !== "string") {
    throw new Error("Expected a JSON string request body");
  }
  return JSON.parse(body) as unknown;
}

describe("CodeAgentClient", () => {
  it("builds encoded Project image preview URLs", () => {
    expect(
      buildProjectImageFileUrl(
        "http://127.0.0.1:3210/",
        "code agent",
        "/workspace/CodeAgent/design/result image.png",
      ),
    ).toBe(
      "http://127.0.0.1:3210/v1/projects/code%20agent/files/image?path=%2Fworkspace%2FCodeAgent%2Fdesign%2Fresult+image.png",
    );
  });

  it("builds opaque pending attachment preview URLs", () => {
    expect(buildProjectAttachmentUrl("http://127.0.0.1:3210/", "code agent", "image/1")).toBe(
      "http://127.0.0.1:3210/v1/projects/code%20agent/attachments/image%2F1",
    );
  });

  it("builds encoded historical attachment URLs from the configured base URL", () => {
    const client = new CodeAgentClient({ baseUrl: "http://127.0.0.1:3210/" });

    expect(client.getTaskAttachmentUrl("项目 / one", "task/1", "image?1")).toBe(
      "http://127.0.0.1:3210/v1/projects/%E9%A1%B9%E7%9B%AE%20%2F%20one/tasks/task%2F1/attachments/image%3F1",
    );
  });

  it("lists and terminates a task background terminal", async () => {
    const terminalPage = {
      data: [
        {
          command: "pnpm dev",
          cwd: "/workspace/CodeAgent",
          id: "terminal/1",
          itemId: "command-1",
        },
      ],
    };
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(terminalPage))
      .mockResolvedValueOnce(jsonResponse({ status: "terminated", terminalId: "terminal/1" }));
    const client = new CodeAgentClient({ fetch: fetchMock });

    await expect(client.listBackgroundTerminals("project one", "task one")).resolves.toEqual(
      terminalPage,
    );
    await expect(
      client.terminateBackgroundTerminal("project one", "task one", "terminal/1", {
        idempotencyKey: "stop-terminal",
      }),
    ).resolves.toEqual({ status: "terminated", terminalId: "terminal/1" });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/v1/projects/project%20one/tasks/task%20one/background-terminals",
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "/v1/projects/project%20one/tasks/task%20one/background-terminals/terminal%2F1/terminate",
    );
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get("idempotency-key")).toBe(
      "stop-terminal",
    );
  });

  it("browses host directories and registers the selected project path", async () => {
    const project = {
      createdAt: "2026-07-23T00:00:00.000Z",
      id: "code-agent",
      name: "CodeAgent",
      rootPath: "/Users/bryan/Develop/CodeAgent",
    };
    const listing = {
      entries: [{ name: "CodeAgent", path: project.rootPath }],
      parentPath: "/Users/bryan",
      path: "/Users/bryan/Develop",
    };
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(listing))
      .mockResolvedValueOnce(jsonResponse({ project }));
    const client = new CodeAgentClient({ fetch: fetchMock });

    await expect(client.listProjectDirectories(listing.path)).resolves.toEqual(listing);
    await expect(
      client.addProject(project.rootPath, { idempotencyKey: "project-key" }),
    ).resolves.toEqual({
      project,
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/v1/project-directories?path=%2FUsers%2Fbryan%2FDevelop",
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/v1/projects");
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      body: JSON.stringify({ rootPath: project.rootPath }),
      method: "POST",
    });
  });

  it("browses host attachment files and imports the selected host path", async () => {
    const selectedPath = "/Users/bryan/Pictures/screen image.png";
    const listing = {
      entries: [{ name: "screen image.png", path: selectedPath, type: "file" as const }],
      parentPath: "/Users/bryan",
      path: "/Users/bryan/Pictures",
    };
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(listing))
      .mockResolvedValueOnce(jsonResponse({ attachment }));
    const client = new CodeAgentClient({ fetch: fetchMock });

    await expect(client.listHostFiles("image", listing.path)).resolves.toEqual(listing);
    await expect(
      client.importHostAttachment("code agent", "image", selectedPath, {
        idempotencyKey: "host-image-key",
      }),
    ).resolves.toEqual({ attachment });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/v1/host-files?kind=image&path=%2FUsers%2Fbryan%2FPictures",
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/v1/projects/code%20agent/attachments/image/host");
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      body: JSON.stringify({ path: selectedPath }),
      method: "POST",
    });
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get("idempotency-key")).toBe(
      "host-image-key",
    );
  });

  it("renames and removes an encoded project id with idempotency keys", async () => {
    const renamedProject = {
      createdAt: "2026-07-23T00:00:00.000Z",
      id: "project / one",
      name: "工作区别名",
      rootPath: "/workspace/CodeAgent",
    };
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ project: renamedProject }))
      .mockResolvedValueOnce(jsonResponse({ projectId: renamedProject.id, status: "removed" }));
    const client = new CodeAgentClient({ fetch: fetchMock });

    await expect(
      client.renameProject(renamedProject.id, "工作区别名", {
        idempotencyKey: "rename-project-key",
      }),
    ).resolves.toEqual({ project: renamedProject });
    await expect(
      client.removeProject(renamedProject.id, { idempotencyKey: "remove-project-key" }),
    ).resolves.toEqual({ projectId: renamedProject.id, status: "removed" });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/v1/projects/project%20%2F%20one/rename");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      body: JSON.stringify({ name: "工作区别名" }),
      method: "POST",
    });
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("idempotency-key")).toBe(
      "rename-project-key",
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/v1/projects/project%20%2F%20one/remove");
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ body: "{}", method: "POST" });
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get("idempotency-key")).toBe(
      "remove-project-key",
    );
  });

  it("reads available project open targets and opens a selected target", async () => {
    const capabilities = {
      apps: [
        { id: "zed", kind: "editor", name: "Zed" },
        { id: "finder", kind: "file-manager", name: "Finder" },
      ],
      platform: "darwin",
    };
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(capabilities))
      .mockResolvedValueOnce(jsonResponse({ appId: "zed", path: "src/components/app.tsx" }));
    const client = new CodeAgentClient({ fetch: fetchMock });

    await expect(client.getProjectOpenCapabilities("project one")).resolves.toEqual(capabilities);
    await expect(
      client.openProject(
        "project one",
        { appId: "zed", path: "src/components/app.tsx" },
        { idempotencyKey: "open-project-key" },
      ),
    ).resolves.toEqual({ appId: "zed", path: "src/components/app.tsx" });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/v1/projects/project%20one/open-capabilities");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/v1/projects/project%20one/open");
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      body: JSON.stringify({ appId: "zed", path: "src/components/app.tsx" }),
      method: "POST",
    });
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get("idempotency-key")).toBe(
      "open-project-key",
    );
  });

  it("opens a task attachment with the host system application", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(
      jsonResponse({ attachmentId: "attachment/file-1", status: "opened" }),
    );
    const client = new CodeAgentClient({ fetch: fetchMock });

    await expect(
      client.openTaskAttachment("project one", "task/1", "attachment/file-1", {
        idempotencyKey: "open-attachment-key",
      }),
    ).resolves.toEqual({ attachmentId: "attachment/file-1", status: "opened" });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/v1/projects/project%20one/tasks/task%2F1/attachments/attachment%2Ffile-1/open",
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ body: "{}", method: "POST" });
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("idempotency-key")).toBe(
      "open-attachment-key",
    );
  });

  it("persists and validates a complete project order", async () => {
    const orderedProjects = [
      {
        createdAt: "2026-07-23T00:00:00.000Z",
        id: "superwork",
        name: "superwork",
        rootPath: "/workspace/superwork",
      },
    ];
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(jsonResponse({ data: orderedProjects, nextCursor: null }));
    const client = new CodeAgentClient({ fetch: fetchMock });

    await expect(
      client.reorderProjects(["superwork"], { idempotencyKey: "project-order-key" }),
    ).resolves.toEqual({ data: orderedProjects, nextCursor: null });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/v1/projects/order");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      body: JSON.stringify({ projectIds: ["superwork"] }),
      method: "PUT",
    });
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("idempotency-key")).toBe(
      "project-order-key",
    );
  });

  it("builds task pagination requests and validates successful responses", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(jsonResponse({ data: [task], nextCursor: null }));
    const client = new CodeAgentClient({ fetch: fetchMock });

    await expect(
      client.listTasks("project one", { cursor: "next/value", limit: 25 }),
    ).resolves.toEqual({ data: [task], nextCursor: null });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/v1/projects/project%20one/tasks?cursor=next%2Fvalue&limit=25",
    );
  });

  it("uses the public temporary scope without exposing an internal Project route", async () => {
    const temporaryTask = { ...task, projectId: "temporary" };
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: [temporaryTask], nextCursor: null }))
      .mockResolvedValueOnce(jsonResponse({ task: temporaryTask }));
    const client = new CodeAgentClient({ fetch: fetchMock });

    await client.listTasks("temporary");
    await client.startTask("temporary", { idempotencyKey: "temporary-task" });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/v1/temporary/tasks");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/v1/temporary/tasks");
  });

  it("reads the provider model catalog", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(jsonResponse(modelPage));
    const client = new CodeAgentClient({ fetch: fetchMock });

    await expect(client.listModels()).resolves.toEqual(modelPage);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/v1/models");
  });

  it("reads and mutates the provider connection with typed requests", async () => {
    const officialStatus = {
      account: null,
      customBaseUrl: null,
      mode: "official" as const,
      pendingLogin: null,
      state: "disconnected" as const,
    };
    const pendingStatus = {
      ...officialStatus,
      pendingLogin: { error: null, loginId: "login/1", state: "pending" as const },
      state: "pending" as const,
    };
    const customStatus = {
      account: { type: "apiKey" as const },
      customBaseUrl: "https://api.example.com/v1",
      mode: "custom" as const,
      pendingLogin: null,
      state: "connected" as const,
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(officialStatus))
      .mockResolvedValueOnce(
        jsonResponse({
          authUrl: "https://auth.openai.com/authorize",
          loginId: "login/1",
          status: pendingStatus,
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ status: officialStatus }))
      .mockResolvedValueOnce(jsonResponse({ models: modelPage, status: customStatus }))
      .mockResolvedValueOnce(jsonResponse({ status: { ...customStatus, state: "disconnected" } }));
    const client = new CodeAgentClient({ fetch: fetchMock });

    await expect(client.getProviderConnection()).resolves.toEqual(officialStatus);
    await client.startOfficialProviderLogin({ idempotencyKey: "official-login" });
    await client.cancelProviderLogin("login/1", { idempotencyKey: "cancel-login" });
    await client.configureCustomProvider(
      { apiKey: "custom-secret", baseUrl: "https://api.example.com/v1" },
      { idempotencyKey: "custom-provider" },
    );
    await client.logoutProvider({ idempotencyKey: "logout-provider" });

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/v1/provider-connection",
      "/v1/provider-connection/official-login",
      "/v1/provider-connection/official-login/cancel",
      "/v1/provider-connection/custom",
      "/v1/provider-connection/logout",
    ]);
    expect(parseJsonRequestBody(fetchMock.mock.calls[2]?.[1]?.body)).toEqual({
      loginId: "login/1",
    });
    expect(parseJsonRequestBody(fetchMock.mock.calls[3]?.[1]?.body)).toEqual({
      apiKey: "custom-secret",
      baseUrl: "https://api.example.com/v1",
    });
    expect(
      fetchMock.mock.calls
        .slice(1)
        .map((call) => new Headers(call[1]?.headers).get("idempotency-key")),
    ).toEqual(["official-login", "cancel-login", "custom-provider", "logout-provider"]);
  });

  it("reads and validates the current project skill catalog", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(jsonResponse(skillPage));
    const client = new CodeAgentClient({ fetch: fetchMock });

    await expect(client.listSkills("project one")).resolves.toEqual(skillPage);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/v1/projects/project%20one/skills");
  });

  it("reads and validates the MCP servers readable by the current task", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(jsonResponse(mcpServerPage));
    const client = new CodeAgentClient({ fetch: fetchMock });

    await expect(client.listMcpServers("project one", "task one")).resolves.toEqual(mcpServerPage);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/v1/projects/project%20one/tasks/task%20one/mcp-servers",
    );
  });

  it("preserves structured Codex errors while reading MCP servers", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          code: "PROVIDER_ERROR",
          message: "mcpServerStatus/list failed: MCP server `docs` executable was not found",
          retryable: true,
        },
        { status: 502, statusText: "Bad Gateway" },
      ),
    );
    const client = new CodeAgentClient({ fetch: fetchMock });

    await expect(client.listMcpServers("project one", "task one")).rejects.toMatchObject({
      code: "PROVIDER_ERROR",
      message: "mcpServerStatus/list failed: MCP server `docs` executable was not found",
      retryable: true,
      status: 502,
    });
  });

  it("manually reloads task MCP servers through an idempotent mutation", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(jsonResponse(mcpServerPage));
    const client = new CodeAgentClient({ fetch: fetchMock });

    await expect(
      client.retryMcpServers("project one", "task one", { idempotencyKey: "mcp-retry-1" }),
    ).resolves.toEqual(mcpServerPage);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/v1/projects/project%20one/tasks/task%20one/mcp-servers/retry",
    );
    const request = fetchMock.mock.calls[0]?.[1];
    expect(request).toMatchObject({
      body: "{}",
      method: "POST",
    });
    expect(new Headers(request?.headers).get("idempotency-key")).toBe("mcp-retry-1");
  });

  it("reads and validates a project's staged and unstaged Git changes", async () => {
    const gitStatus = {
      baseBranches: ["origin/main", "main"],
      branch: "feat/review",
      branches: ["feat/review", "main"],
      repositoryMode: "root",
      snapshot: "a".repeat(64),
      staged: [],
      unstaged: [
        {
          diff: "--- /dev/null\n+++ b/new.ts\n@@ -0,0 +1,1 @@\n+export {};",
          kind: "create",
          path: "new.ts",
        },
      ],
    };
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(jsonResponse(gitStatus));
    const client = new CodeAgentClient({ fetch: fetchMock });

    await expect(
      client.getProjectGitStatus("project one", { repository: "frontend" }),
    ).resolves.toEqual(gitStatus);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/v1/projects/project%20one/git/status?repository=frontend",
    );

    fetchMock.mockResolvedValueOnce(jsonResponse({ staged: [], unstaged: [] }));
    await expect(client.getProjectGitStatus("project one")).rejects.toThrow(
      "CodeAgent response does not match the protocol schema",
    );
  });

  it("reads and validates a paginated project Git history tab", async () => {
    const historyPage = {
      branch: "release/server",
      commits: [
        {
          authoredAt: "2026-08-06T08:30:00+08:00",
          authorEmail: "developer@example.com",
          authorName: "Developer",
          sha: "a".repeat(40),
          title: "feat(git): 添加历史记录",
        },
      ],
      nextCursor: "40",
      repositories: ["apps/web", "packages/server"],
      repository: "frontend",
      repositoryMode: "children",
    };
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(jsonResponse(historyPage));
    const client = new CodeAgentClient({ fetch: fetchMock });

    await expect(
      client.getProjectGitHistory("project one", {
        cursor: "20",
        repository: "packages/server",
      }),
    ).resolves.toEqual(historyPage);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/v1/projects/project%20one/git/history?cursor=20&repository=packages%2Fserver",
    );

    fetchMock.mockResolvedValueOnce(jsonResponse({ ...historyPage, commits: [{}] }));
    await expect(client.getProjectGitHistory("project one")).rejects.toThrow(
      "CodeAgent response does not match the protocol schema",
    );
  });

  it("reads and validates paginated commit files and one bounded diff", async () => {
    const filesPage = {
      files: [{ kind: "update", path: "src/index.ts" }],
      nextCursor: "100",
    };
    const diff = { diff: "@@ -1 +1 @@\n-old\n+new\n", truncated: false };
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(jsonResponse(filesPage));
    fetchMock.mockResolvedValueOnce(jsonResponse(diff));
    const client = new CodeAgentClient({ fetch: fetchMock });
    const sha = "a".repeat(40);

    await expect(
      client.getProjectGitCommitFiles("project one", {
        cursor: "100",
        repository: "packages/server",
        sha,
      }),
    ).resolves.toEqual(filesPage);
    await expect(
      client.getProjectGitCommitFileDiff("project one", {
        path: "src/index.ts",
        repository: "packages/server",
        sha,
      }),
    ).resolves.toEqual(diff);

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `/v1/projects/project%20one/git/commit-files?cursor=100&repository=packages%2Fserver&sha=${sha}`,
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      `/v1/projects/project%20one/git/commit-diff?path=src%2Findex.ts&repository=packages%2Fserver&sha=${sha}`,
    );

    fetchMock.mockResolvedValueOnce(jsonResponse({ files: [{ path: "src/index.ts" }] }));
    await expect(client.getProjectGitCommitFiles("project one", { sha })).rejects.toThrow(
      "CodeAgent response does not match the protocol schema",
    );
  });

  it("switches a project branch with a validated idempotent mutation", async () => {
    const gitStatus = {
      baseBranches: ["origin/main", "feat/review"],
      branch: "main",
      branches: ["main", "feat/review"],
      repositoryMode: "root",
      snapshot: "b".repeat(64),
      staged: [],
      unstaged: [],
    };
    const request = { branch: "main", expectedSnapshot: "a".repeat(64) };
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(jsonResponse(gitStatus));
    const client = new CodeAgentClient({ fetch: fetchMock });

    await expect(
      client.switchProjectBranch("project one", request, { idempotencyKey: "switch-key" }),
    ).resolves.toEqual(gitStatus);
    const switchCall = fetchMock.mock.calls[0];
    expect(switchCall?.[0]).toBe("/v1/projects/project%20one/git/branch");
    expect(switchCall?.[1]).toMatchObject({ body: JSON.stringify(request), method: "POST" });
    expect(new Headers(switchCall?.[1]?.headers).get("idempotency-key")).toBe("switch-key");

    fetchMock.mockResolvedValueOnce(jsonResponse({ branch: "main" }));
    await expect(client.switchProjectBranch("project one", request)).rejects.toThrow(
      "CodeAgent response does not match the protocol schema",
    );
  });

  it("creates a project branch with a validated idempotent mutation", async () => {
    const gitStatus = {
      baseBranches: ["origin/main", "main"],
      branch: "feat/new-branch",
      branches: ["feat/new-branch", "main"],
      repositoryMode: "root",
      snapshot: "b".repeat(64),
      staged: [],
      unstaged: [],
    };
    const request = { branch: "feat/new-branch", expectedSnapshot: "a".repeat(64) };
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(jsonResponse(gitStatus));
    const client = new CodeAgentClient({ fetch: fetchMock });

    await expect(
      client.createProjectBranch("project one", request, { idempotencyKey: "create-key" }),
    ).resolves.toEqual(gitStatus);
    const createCall = fetchMock.mock.calls[0];
    expect(createCall?.[0]).toBe("/v1/projects/project%20one/git/branches");
    expect(createCall?.[1]).toMatchObject({ body: JSON.stringify(request), method: "POST" });
    expect(new Headers(createCall?.[1]?.headers).get("idempotency-key")).toBe("create-key");

    fetchMock.mockResolvedValueOnce(jsonResponse({ branch: "feat/new-branch" }));
    await expect(client.createProjectBranch("project one", request)).rejects.toThrow(
      "CodeAgent response does not match the protocol schema",
    );
  });

  it("generates a commit message and commits selected files with idempotency", async () => {
    const snapshot = "a".repeat(64);
    const generationRequest = {
      expectedSnapshot: snapshot,
      paths: ["src/app.ts"],
      repository: "packages/server",
    };
    const commitRequest = {
      action: "commit_and_push" as const,
      expectedSnapshot: snapshot,
      message: "feat(git): 添加选择文件提交",
      paths: generationRequest.paths,
      repository: generationRequest.repository,
    };
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ message: "feat(git): 添加选择文件提交", snapshot }))
      .mockResolvedValueOnce(
        jsonResponse({
          branch: "feat/commit",
          commitSha: "0123456789abcdef0123456789abcdef01234567",
          message: commitRequest.message,
          pushStatus: "pushed",
        }),
      );
    const client = new CodeAgentClient({ fetch: fetchMock });

    await client.generateCommitMessage("project one", generationRequest, {
      idempotencyKey: "generate-key",
    });
    await client.commitProjectChanges("project one", commitRequest, {
      idempotencyKey: "commit-key",
    });

    const [generateCall, commitCall] = fetchMock.mock.calls;
    expect(generateCall?.[0]).toBe("/v1/projects/project%20one/git/commit-message");
    expect(generateCall?.[1]).toMatchObject({
      body: JSON.stringify(generationRequest),
      method: "POST",
    });
    expect(new Headers(generateCall?.[1]?.headers).get("idempotency-key")).toBe("generate-key");
    expect(commitCall?.[0]).toBe("/v1/projects/project%20one/git/commits");
    expect(commitCall?.[1]).toMatchObject({ body: JSON.stringify(commitRequest), method: "POST" });
    expect(new Headers(commitCall?.[1]?.headers).get("idempotency-key")).toBe("commit-key");
  });

  it("reads and validates a bounded project source preview", async () => {
    const sourceFile = {
      content: "### 11.7 认证\n",
      path: "docs/architecture-design.md",
      truncated: true,
    };
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(jsonResponse(sourceFile));
    const client = new CodeAgentClient({ fetch: fetchMock });

    await expect(
      client.readProjectSourceFile(
        "project one",
        "/workspace/CodeAgent/docs/architecture-design.md",
      ),
    ).resolves.toEqual(sourceFile);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/v1/projects/project%20one/files/source?path=%2Fworkspace%2FCodeAgent%2Fdocs%2Farchitecture-design.md",
    );
  });

  it("reads and validates a project file tree directory", async () => {
    const fileTree = {
      entries: [{ path: "src/components/app.tsx", type: "file" }],
      path: "src/components",
    };
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(jsonResponse(fileTree));
    const client = new CodeAgentClient({ fetch: fetchMock });

    await expect(client.listProjectFiles("project one", "src/components")).resolves.toEqual(
      fileTree,
    );
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/v1/projects/project%20one/files/tree?path=src%2Fcomponents",
    );

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ entries: [{ path: "/absolute.ts", type: "file" }], path: null }),
    );
    await expect(client.listProjectFiles("project one", null)).rejects.toThrow(
      "CodeAgent response does not match the protocol schema",
    );
  });

  it("searches and validates project file references", async () => {
    const page = { data: [{ name: "index.ts", path: "src/index.ts" }] };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(page));
    const client = new CodeAgentClient({ fetch: fetchMock });

    await expect(client.searchProjectFiles("project one", "index")).resolves.toEqual(page);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/v1/projects/project%20one/files/search?query=index",
    );

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: [{ name: "outside.ts", path: "/tmp/outside.ts" }] }),
    );
    await expect(client.searchProjectFiles("project one", "outside")).rejects.toThrow(
      "CodeAgent response does not match the protocol schema",
    );
  });

  it("uses the configured base URL for all read methods", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ status: "ok", version: 1 }))
      .mockResolvedValueOnce(
        jsonResponse({
          feedback: { upload: true },
          provider: "codex",
          skills: { list: true, use: true },
          tasks: { fork: true, list: true, read: true, start: true },
          turns: {
            compact: true,
            interrupt: true,
            review: true,
            start: true,
            steer: true,
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [], nextCursor: null }))
      .mockResolvedValueOnce(
        jsonResponse({
          checkpoint: { sequence: 0, sessionId: "runtime-1" },
          snapshot: {
            ...task,
            contextUsage: null,
            pendingRequests: [],
            plan: null,
            settings: taskSettings,
            status: "idle",
            turns: [],
          },
        }),
      );
    const client = new CodeAgentClient({ baseUrl: "http://127.0.0.1:3210/", fetch: fetchMock });

    await client.getHealth();
    await client.getCapabilities();
    await client.listProjects();
    await client.readTask("code-agent", "task-1");

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "http://127.0.0.1:3210/v1/health",
      "http://127.0.0.1:3210/v1/capabilities",
      "http://127.0.0.1:3210/v1/projects",
      "http://127.0.0.1:3210/v1/projects/code-agent/tasks/task-1",
    ]);
  });

  it("rejects non-success HTTP responses", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(jsonResponse({ message: "failed" }, { status: 500 }));
    const client = new CodeAgentClient({ fetch: fetchMock });

    await expect(client.getHealth()).rejects.toBeInstanceOf(CodeAgentHttpError);
  });

  it("reads and atomically updates project defaults and task settings", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ settings: projectDefaults }))
      .mockResolvedValueOnce(jsonResponse({ settings: projectDefaults }))
      .mockResolvedValueOnce(jsonResponse({ settings: taskSettings }))
      .mockResolvedValueOnce(jsonResponse({ settings: taskSettings }));
    const client = new CodeAgentClient({ fetch: fetchMock });

    await expect(client.getProjectDefaults("project one")).resolves.toEqual({
      settings: projectDefaults,
    });
    await expect(
      client.updateProjectDefaults("project one", projectDefaults, {
        idempotencyKey: "project-defaults-key",
      }),
    ).resolves.toEqual({ settings: projectDefaults });
    await expect(client.getTaskSettings("project one", "task/1")).resolves.toEqual({
      settings: taskSettings,
    });
    await expect(
      client.updateTaskSettings("project one", "task/1", taskSettings, {
        idempotencyKey: "task-settings-key",
      }),
    ).resolves.toEqual({ settings: taskSettings });

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/v1/projects/project%20one/defaults",
      "/v1/projects/project%20one/defaults",
      "/v1/projects/project%20one/tasks/task%2F1/settings",
      "/v1/projects/project%20one/tasks/task%2F1/settings",
    ]);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      body: JSON.stringify(projectDefaults),
      method: "PUT",
    });
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get("idempotency-key")).toBe(
      "project-defaults-key",
    );
    expect(fetchMock.mock.calls[3]?.[1]).toMatchObject({
      body: JSON.stringify(taskSettings),
      method: "PUT",
    });
  });

  it("reads and atomically updates global settings", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ settings: globalSettings }))
      .mockResolvedValueOnce(jsonResponse({ settings: globalSettings }));
    const client = new CodeAgentClient({ fetch: fetchMock });

    await expect(client.getGlobalSettings()).resolves.toEqual({ settings: globalSettings });
    await expect(
      client.updateGlobalSettings(globalSettings, { idempotencyKey: "global-settings-key" }),
    ).resolves.toEqual({ settings: globalSettings });

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual(["/v1/settings", "/v1/settings"]);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      body: JSON.stringify(globalSettings),
      method: "PUT",
    });
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get("idempotency-key")).toBe(
      "global-settings-key",
    );
  });

  it("reads application versions and installs a validated update", async () => {
    const available = {
      appVersion: "1.3.0",
      codexVersion: "0.147.0",
      latestVersion: "1.4.0",
      releaseNotes: "### 新增\n\n- 添加在线更新。",
      status: "available" as const,
      updateAvailable: true,
    };
    const installed = {
      appVersion: available.appVersion,
      codexVersion: available.codexVersion,
      latestVersion: available.latestVersion,
      releaseNotes: null,
      status: "restart-required" as const,
      updateAvailable: false as const,
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(available))
      .mockResolvedValueOnce(jsonResponse(installed));
    const client = new CodeAgentClient({ fetch: fetchMock });

    await expect(client.getAppInfo()).resolves.toEqual(available);
    await expect(
      client.installAppUpdate("1.4.0", { idempotencyKey: "app-update-key" }),
    ).resolves.toEqual(installed);

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual(["/v1/app-info", "/v1/app-update"]);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      body: JSON.stringify({ version: "1.4.0" }),
      method: "POST",
    });
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get("idempotency-key")).toBe(
      "app-update-key",
    );
  });

  it("rejects malformed application information", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        appVersion: "1.3.0",
        codexVersion: "0.147.0",
        latestVersion: "latest",
        releaseNotes: null,
        status: "available",
        updateAvailable: true,
      }),
    );
    const client = new CodeAgentClient({ fetch: fetchMock });

    await expect(client.getAppInfo()).rejects.toBeInstanceOf(CodeAgentResponseError);
  });

  it("rejects malformed settings responses", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(
      jsonResponse({ settings: { ...taskSettings, approvalPolicy: "allow_for_session" } }),
    );
    const client = new CodeAgentClient({ fetch: fetchMock });

    await expect(client.getTaskSettings("code-agent", "task-1")).rejects.toBeInstanceOf(
      CodeAgentResponseError,
    );
  });

  it("sends typed task and turn mutations with idempotency keys", async () => {
    const runningTurn = {
      completedAt: null,
      error: null,
      id: "turn-1",
      items: [],
      startedAt: "2026-07-23T00:02:00.000Z",
      status: "running",
    };
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ task }))
      .mockResolvedValueOnce(jsonResponse({ attachment }))
      .mockResolvedValueOnce(jsonResponse({ taskId: task.id, turn: runningTurn }))
      .mockResolvedValueOnce(
        jsonResponse({ status: "accepted", taskId: task.id, turnId: runningTurn.id }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ status: "interrupting", taskId: task.id, turnId: runningTurn.id }),
      );
    const client = new CodeAgentClient({ fetch: fetchMock });

    await client.startTask("code-agent", { idempotencyKey: "task-key" });
    await client.uploadAttachment(
      "code-agent",
      {
        content: new Blob([pixelBytes], { type: "image/png" }),
        kind: "image",
        name: attachment.name,
      },
      { idempotencyKey: "attachment-key" },
    );
    await client.startTurn(
      "code-agent",
      task.id,
      {
        attachments: [{ id: attachment.id }],
        skills: [{ id: skill.id, name: skill.name }],
        text: "继续实现",
        type: "prompt",
      },
      {
        approvalPolicy: "on-request",
        approvalsReviewer: "auto_review",
        model: "gpt-5.6-sol",
        reasoningEffort: "high",
        sandboxMode: "read-only",
      },
      { idempotencyKey: "turn-key" },
    );
    await client.steerTurn(
      "code-agent",
      task.id,
      runningTurn.id,
      { attachments: [], skills: [], text: "优先修复测试", type: "prompt" },
      { idempotencyKey: "steer-key" },
    );
    await client.interruptTurn("code-agent", task.id, runningTurn.id, {
      idempotencyKey: "interrupt-key",
    });
    const [taskCall, attachmentCall, turnCall, steerCall, interruptCall] = fetchMock.mock.calls;
    expect(taskCall?.[0]).toBe("/v1/projects/code-agent/tasks");
    expect(taskCall?.[1]).toMatchObject({ body: "{}", method: "POST" });
    expect(new Headers(taskCall?.[1]?.headers).get("idempotency-key")).toBe("task-key");
    expect(attachmentCall?.[0]).toBe("/v1/projects/code-agent/attachments/image");
    expect(attachmentCall?.[1]).toMatchObject({
      method: "POST",
    });
    expect(attachmentCall?.[1]?.body).toBeInstanceOf(FormData);
    const attachmentForm = attachmentCall?.[1]?.body as FormData;
    const attachmentFile = attachmentForm.get("attachment");
    expect(attachmentFile).toBeInstanceOf(File);
    expect(attachmentFile).toMatchObject({ name: "screen.png", size: 68, type: "image/png" });
    expect(new Headers(attachmentCall?.[1]?.headers).has("content-type")).toBe(false);
    expect(new Headers(attachmentCall?.[1]?.headers).get("idempotency-key")).toBe("attachment-key");
    expect(turnCall?.[0]).toBe("/v1/projects/code-agent/tasks/task-1/turns");
    expect(turnCall?.[1]).toMatchObject({
      body: JSON.stringify({
        input: {
          attachments: [{ id: "attachment-1" }],
          skills: [{ id: "skill_01J00000000000000000000000", name: "review-security" }],
          text: "继续实现",
          type: "prompt",
        },
        options: {
          approvalPolicy: "on-request",
          approvalsReviewer: "auto_review",
          model: "gpt-5.6-sol",
          reasoningEffort: "high",
          sandboxMode: "read-only",
        },
      }),
      method: "POST",
    });
    expect(steerCall?.[0]).toBe("/v1/projects/code-agent/tasks/task-1/turns/turn-1/steer");
    expect(steerCall?.[1]).toMatchObject({
      body: JSON.stringify({
        input: { attachments: [], skills: [], text: "优先修复测试", type: "prompt" },
        taskId: "task-1",
      }),
      method: "POST",
    });
    expect(new Headers(steerCall?.[1]?.headers).get("idempotency-key")).toBe("steer-key");
    expect(new Headers(turnCall?.[1]?.headers).get("idempotency-key")).toBe("turn-key");
    expect(interruptCall?.[0]).toBe("/v1/projects/code-agent/tasks/task-1/turns/turn-1/interrupt");
    expect(interruptCall?.[1]).toMatchObject({
      body: JSON.stringify({ taskId: "task-1" }),
      method: "POST",
    });
    expect(new Headers(interruptCall?.[1]?.headers).get("idempotency-key")).toBe("interrupt-key");
  });

  it("sends typed task command mutations with idempotency keys", async () => {
    const reviewTurn = {
      completedAt: null,
      error: null,
      id: "review-turn",
      items: [],
      startedAt: "2026-07-25T00:00:00.000Z",
      status: "running",
    };
    const forkedTask = { ...task, id: "task-2", title: "续接任务" };
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ taskId: task.id, turn: reviewTurn }))
      .mockResolvedValueOnce(jsonResponse({ status: "compacting", taskId: task.id }))
      .mockResolvedValueOnce(jsonResponse({ task: forkedTask }))
      .mockResolvedValueOnce(jsonResponse({ status: "sent", taskId: task.id }));
    const client = new CodeAgentClient({ fetch: fetchMock });

    await client.startReview(
      "code-agent",
      task.id,
      { target: { type: "uncommitted_changes" } },
      { idempotencyKey: "review-key" },
    );
    await client.compactTask("code-agent", task.id, { idempotencyKey: "compact-key" });
    await client.forkTask("code-agent", task.id, { idempotencyKey: "fork-key" });
    await client.uploadFeedback(
      "code-agent",
      task.id,
      { classification: "other", includeLogs: true, reason: "体验反馈" },
      { idempotencyKey: "feedback-key" },
    );

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/v1/projects/code-agent/tasks/task-1/review",
      "/v1/projects/code-agent/tasks/task-1/compact",
      "/v1/projects/code-agent/tasks/task-1/fork",
      "/v1/projects/code-agent/tasks/task-1/feedback",
    ]);
    expect(
      fetchMock.mock.calls.map((call) => new Headers(call[1]?.headers).get("idempotency-key")),
    ).toEqual(["review-key", "compact-key", "fork-key", "feedback-key"]);
  });

  it("sends typed task metadata mutations with idempotency keys", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ task: { ...task, pinned: true } }))
      .mockResolvedValueOnce(jsonResponse({ task: { ...task, title: "新的任务名称" } }))
      .mockResolvedValueOnce(jsonResponse({ status: "archived", taskId: task.id }));
    const client = new CodeAgentClient({ fetch: fetchMock });

    await expect(
      client.pinTask("code-agent", task.id, true, { idempotencyKey: "pin-key" }),
    ).resolves.toMatchObject({ task: { pinned: true } });
    await expect(
      client.renameTask("code-agent", task.id, "新的任务名称", {
        idempotencyKey: "rename-key",
      }),
    ).resolves.toMatchObject({ task: { title: "新的任务名称" } });
    await expect(
      client.archiveTask("code-agent", task.id, { idempotencyKey: "archive-key" }),
    ).resolves.toEqual({ status: "archived", taskId: task.id });

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/v1/projects/code-agent/tasks/task-1/pin",
      "/v1/projects/code-agent/tasks/task-1/rename",
      "/v1/projects/code-agent/tasks/task-1/archive",
    ]);
    expect(fetchMock.mock.calls.map((call) => call[1]?.method)).toEqual(["PUT", "POST", "POST"]);
    expect(fetchMock.mock.calls.map((call) => call[1]?.body)).toEqual([
      JSON.stringify({ pinned: true }),
      JSON.stringify({ title: "新的任务名称" }),
      "{}",
    ]);
    expect(
      fetchMock.mock.calls.map((call) => new Headers(call[1]?.headers).get("idempotency-key")),
    ).toEqual(["pin-key", "rename-key", "archive-key"]);
  });

  it("requests best-effort task unsubscribe without an idempotency cache entry", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: "unsubscribed", taskId: task.id }));
    const client = new CodeAgentClient({ fetch: fetchMock });

    await expect(client.unsubscribeTask("code-agent", task.id)).resolves.toEqual({
      status: "unsubscribed",
      taskId: task.id,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/v1/projects/code-agent/tasks/task-1/unsubscribe",
      expect.objectContaining({ body: "{}", method: "POST" }),
    );
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).has("idempotency-key")).toBe(false);
  });

  it("sends typed pending request resolutions with full identity", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ request: { ...pendingRequest, status: "resolved" } }),
    );
    const client = new CodeAgentClient({ fetch: fetchMock });

    await expect(
      client.resolvePendingRequest(
        pendingRequest,
        { decision: "allow" },
        { idempotencyKey: "resolve-key" },
      ),
    ).resolves.toMatchObject({ request: { status: "resolved" } });

    const call = fetchMock.mock.calls[0];
    expect(call?.[0]).toBe(
      "/v1/projects/code-agent/tasks/task-1/pending-requests/number%3A7/resolve",
    );
    expect(call?.[1]).toMatchObject({
      body: JSON.stringify({
        itemId: "command-1",
        projectId: "code-agent",
        resolution: { decision: "allow" },
        taskId: "task-1",
        turnId: "turn-1",
        type: "command_approval",
      }),
      method: "POST",
    });
    expect(new Headers(call?.[1]?.headers).get("idempotency-key")).toBe("resolve-key");
  });

  it("validates and exposes structured mutation errors", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { code: "PROVIDER_ERROR", message: "Agent provider request failed", retryable: true },
        { status: 502, statusText: "Bad Gateway" },
      ),
    );
    const client = new CodeAgentClient({ fetch: fetchMock });

    const error = await client.startTask("code-agent").catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(CodeAgentMutationError);
    expect(error).toMatchObject({
      code: "PROVIDER_ERROR",
      message: "Agent provider request failed",
      retryable: true,
      status: 502,
    });
  });

  it("applies separate query, read, and mutation cancellation policies", async () => {
    const timeoutValues: number[] = [];
    const timeoutControllers: AbortController[] = [];
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockImplementation((timeout) => {
      timeoutValues.push(timeout);
      const controller = new AbortController();
      timeoutControllers.push(controller);
      return controller.signal;
    });
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: [], nextCursor: null }))
      .mockResolvedValueOnce(jsonResponse({ data: [], nextCursor: null }))
      .mockResolvedValueOnce(jsonResponse({ task }));
    const client = new CodeAgentClient({ fetch: fetchMock });
    const queryController = new AbortController();

    await client.listProjects({ signal: queryController.signal });
    await client.listProjects();
    await client.startTask("code-agent", { idempotencyKey: "start-task" });

    expect(timeoutValues).toEqual([30_000, 15_000, 60_000]);
    const querySignal = fetchMock.mock.calls[0]?.[1]?.signal;
    expect(querySignal).toBeInstanceOf(AbortSignal);
    expect(querySignal).not.toBe(queryController.signal);
    expect(querySignal?.aborted).toBe(false);
    queryController.abort(new DOMException("Query cancelled", "AbortError"));
    expect(querySignal?.aborted).toBe(true);
    expect(timeoutControllers).toHaveLength(3);
    timeoutSpy.mockRestore();
  });

  it("rejects malformed mutation error responses at the protocol boundary", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ code: "PROVIDER_ERROR", message: "missing retryable" }, { status: 502 }),
    );
    const client = new CodeAgentClient({ fetch: fetchMock });

    await expect(client.startTask("code-agent")).rejects.toBeInstanceOf(CodeAgentResponseError);
  });

  it("rejects invalid JSON and schema mismatches at the boundary", async () => {
    const invalidJsonFetch = vi.fn<typeof fetch>();
    invalidJsonFetch.mockResolvedValue(new Response("{"));
    const invalidSchemaFetch = vi.fn<typeof fetch>();
    invalidSchemaFetch.mockResolvedValue(
      jsonResponse({ data: [{ ...task, pinned: undefined }], nextCursor: null }),
    );

    await expect(
      new CodeAgentClient({ fetch: invalidJsonFetch }).listProjects(),
    ).rejects.toBeInstanceOf(CodeAgentResponseError);
    await expect(
      new CodeAgentClient({ fetch: invalidSchemaFetch }).listTasks("code-agent"),
    ).rejects.toBeInstanceOf(CodeAgentResponseError);
  });

  it("uses same-origin credentials for access status, pairing, and logout", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ authenticated: false, mode: "lan", version: 1 }))
      .mockResolvedValueOnce(jsonResponse({ authenticated: true, mode: "lan", version: 1 }))
      .mockResolvedValueOnce(jsonResponse({ authenticated: false, mode: "lan", version: 1 }));
    const client = new CodeAgentClient({ fetch: fetchMock });

    await client.getAccessStatus();
    await client.pairAccess("secret-pairing-code");
    await client.logoutAccess();

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/v1/access",
      "/v1/access/pair",
      "/v1/access/logout",
    ]);
    expect(fetchMock.mock.calls.map((call) => call[1]?.credentials)).toEqual([
      "same-origin",
      "same-origin",
      "same-origin",
    ]);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      body: JSON.stringify({ code: "secret-pairing-code" }),
      method: "POST",
    });
  });

  it("notifies unauthorized subscribers without swallowing the request error", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 401, statusText: "Unauthorized" }),
    );
    const client = new CodeAgentClient({ fetch: fetchMock });
    const listener = vi.fn();
    const unsubscribe = client.subscribeUnauthorized(listener);

    await expect(client.listProjects()).rejects.toMatchObject({ status: 401 });
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
  });
});
