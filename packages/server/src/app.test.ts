import {
  PendingRequestResolutionError,
  type AgentProvider,
  type AgentProviderEvent,
  type AgentProviderTaskSnapshot,
  type AgentProviderTurnInput,
  type AgentRuntimeProvider,
} from "@code-agent/core";
import type {
  AgentBackgroundTerminalPage,
  AgentModelPage,
  AgentProjectDefaults,
  AgentTaskSettings,
  AgentTurn,
  PendingRequest,
} from "@code-agent/protocol";
import { Buffer } from "node:buffer";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createCodeAgentServer } from "./app.js";

const project = {
  createdAt: "2026-07-23T00:00:00.000Z",
  id: "code-agent",
  name: "CodeAgent",
  rootPath: "/workspace/CodeAgent",
} as const;

const pixelDataUrl =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const historicalImageContent = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const turnOptions = {
  approvalPolicy: "on-request",
  approvalsReviewer: "user",
  model: "gpt-5.6-sol",
  reasoningEffort: "high",
  sandboxMode: "workspace-write",
} as const;

const modelPage: AgentModelPage = {
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

function turnRequest(text: string) {
  return {
    input: { attachments: [], skills: [], text, type: "prompt" as const },
    options: turnOptions,
  };
}

const task = {
  id: "task-1",
  pinned: false,
  projectId: "code-agent",
  title: "结构化历史",
  updatedAt: "2026-07-23T00:01:00.000Z",
} as const;

const snapshot = {
  ...task,
  contextUsage: null,
  pendingRequests: [],
  status: "idle" as const,
  turns: [],
};

const pendingRequest = {
  availableDecisions: ["allow", "allow_for_session", "deny"],
  command: "pnpm check",
  createdAt: "2026-07-23T00:02:00.000Z",
  cwd: "/workspace/CodeAgent",
  expiresAt: null,
  itemId: "command-1",
  networkAccess: null,
  projectId: "code-agent",
  reason: "需要执行检查",
  requestId: "number:7",
  status: "pending",
  taskId: "task-1",
  turnId: "turn-1",
  type: "command_approval",
} as const satisfies PendingRequest;

const closeCallbacks: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closeCallbacks.splice(0).map((close) => close()));
});

function createProvider() {
  const eventListeners = new Set<(event: AgentProviderEvent) => void>();
  const getCapabilities = vi.fn(() =>
    Promise.resolve({
      feedback: { upload: true },
      provider: "codex",
      skills: { list: true, use: true },
      tasks: { fork: true, list: true, read: true, start: true },
      turns: { compact: true, interrupt: true, review: true, rollback: true, start: true },
    }),
  );
  const compactTask = vi.fn(() => Promise.resolve());
  const archiveTask = vi.fn(() => Promise.resolve());
  const forkTask = vi.fn(() => Promise.resolve({ ...task, id: "task-2", title: "续接任务" }));
  const listTasks = vi.fn(() => Promise.resolve({ data: [task], nextCursor: "next" }));
  const listModels = vi.fn(() => Promise.resolve(modelPage));
  const listSkills = vi.fn(() =>
    Promise.resolve({
      data: [
        {
          description: "审查认证、授权和敏感数据边界",
          displayName: "Security review",
          id: "skill_01J00000000000000000000000",
          name: "review-security",
          scope: "system" as const,
        },
      ],
      nextCursor: null,
    }),
  );
  const readTask = vi.fn<(taskId: string) => Promise<AgentProviderTaskSnapshot | undefined>>(
    (taskId) => Promise.resolve(taskId === task.id ? snapshot : undefined),
  );
  const readTaskAttachment = vi.fn((taskId: string, attachmentId: string) =>
    Promise.resolve(
      taskId === task.id && attachmentId === "history/image-1"
        ? {
            content: historicalImageContent,
            mediaType: "image/png" as const,
            name: "diagram.png",
            size: historicalImageContent.byteLength,
          }
        : undefined,
    ),
  );
  const resolvePendingRequest = vi.fn(() =>
    Promise.resolve({ ...pendingRequest, status: "resolved" as const }),
  );
  const rollbackLatestTurn = vi.fn(() => Promise.resolve());
  const renameTask = vi.fn(() => Promise.resolve());
  const startTask = vi.fn(() => Promise.resolve(task));
  const startTurn = vi.fn((taskId: string, input: AgentProviderTurnInput) =>
    Promise.resolve({
      completedAt: null,
      error: null,
      id: "turn-1",
      items: [{ id: "input-1", role: "user" as const, text: input.text, type: "message" as const }],
      startedAt: "2026-07-23T00:02:00.000Z",
      status: "running" as const,
    }),
  );
  const interruptTurn = vi.fn(() => Promise.resolve());
  const listBackgroundTerminals = vi.fn<() => Promise<AgentBackgroundTerminalPage>>(() =>
    Promise.resolve({ data: [] }),
  );
  const terminateBackgroundTerminal = vi.fn(() => Promise.resolve(true));
  const unsubscribeTask = vi.fn(() => Promise.resolve("unsubscribed" as const));
  const readSandboxMode = vi.fn(() => Promise.resolve("read-only" as const));
  const startReview = vi.fn(() =>
    Promise.resolve({
      completedAt: null,
      error: null,
      id: "review-turn",
      items: [],
      startedAt: "2026-07-25T00:00:00.000Z",
      status: "running" as const,
    }),
  );
  const uploadFeedback = vi.fn(() => Promise.resolve());
  const provider: AgentProvider = {
    archiveTask,
    compactTask,
    forkTask,
    getCapabilities,
    interruptTurn,
    listBackgroundTerminals,
    listModels,
    listSkills,
    listTasks,
    readSandboxMode,
    readTask,
    readTaskAttachment,
    renameTask,
    resolvePendingRequest,
    rollbackLatestTurn,
    startTask,
    startReview,
    startTurn,
    subscribeEvents(listener) {
      eventListeners.add(listener);
      return () => {
        eventListeners.delete(listener);
      };
    },
    terminateBackgroundTerminal,
    unsubscribeTask,
    uploadFeedback,
  };
  return {
    archiveTask,
    compactTask,
    emitEvent: (event: AgentProviderEvent) => {
      for (const listener of eventListeners) {
        listener(event);
      }
    },
    eventListeners,
    forkTask,
    listTasks,
    listModels,
    listSkills,
    interruptTurn,
    listBackgroundTerminals,
    provider,
    readSandboxMode,
    readTask,
    readTaskAttachment,
    renameTask,
    resolvePendingRequest,
    rollbackLatestTurn,
    startTask,
    startReview,
    startTurn,
    terminateBackgroundTerminal,
    unsubscribeTask,
    uploadFeedback,
  };
}

function createTaskMetadataRepository() {
  const pinnedTaskIds = new Map<string, Set<string>>();
  const listPinnedTaskIds = vi.fn((projectId: string) =>
    Promise.resolve([...(pinnedTaskIds.get(projectId) ?? [])]),
  );
  const writeTaskPinned = vi.fn((projectId: string, taskId: string, pinned: boolean) => {
    const current = pinnedTaskIds.get(projectId) ?? new Set<string>();
    if (pinned) {
      current.add(taskId);
    } else {
      current.delete(taskId);
    }
    pinnedTaskIds.set(projectId, current);
    return Promise.resolve(pinned);
  });
  return { listPinnedTaskIds, repository: { listPinnedTaskIds, writeTaskPinned }, writeTaskPinned };
}

function createSettingsRepository() {
  const readProjectDefaults = vi.fn(() =>
    Promise.resolve<AgentProjectDefaults | undefined>(undefined),
  );
  const readTaskSettings = vi.fn(() => Promise.resolve<AgentTaskSettings | undefined>(undefined));
  const writeProjectDefaults = vi.fn((_projectId: string, settings: AgentProjectDefaults) =>
    Promise.resolve(settings),
  );
  const writeTaskSettings = vi.fn(
    (_projectId: string, _taskId: string, settings: AgentTaskSettings) => Promise.resolve(settings),
  );
  return {
    readProjectDefaults,
    readTaskSettings,
    repository: {
      readProjectDefaults,
      readTaskSettings,
      writeProjectDefaults,
      writeTaskSettings,
    },
    writeProjectDefaults,
    writeTaskSettings,
  };
}

function createServerOptions(provider: AgentProvider, overrides: Record<string, unknown> = {}) {
  const orderedProjects = [project];
  const runtimeProvider: AgentRuntimeProvider = {
    forProject: () => provider,
    getCapabilities: () => provider.getCapabilities(),
    listModels: () => provider.listModels(),
  };
  return {
    handlerTimeoutMs: 0,
    loggerEnabled: false,
    projectRepository: {
      list: vi.fn(() => Promise.resolve(orderedProjects)),
      read: vi.fn((projectId: string) =>
        Promise.resolve(projectId === project.id ? project : undefined),
      ),
      register: vi.fn(() => Promise.resolve(project)),
      reorder: vi.fn((projectIds: readonly string[]) => {
        const reordered = projectIds.map((projectId) =>
          orderedProjects.find((currentProject) => currentProject.id === projectId),
        );
        return Promise.resolve(reordered.filter((item) => item !== undefined));
      }),
    },
    provider: runtimeProvider,
    selectProjectDirectory: vi.fn(() => Promise.resolve(undefined)),
    settingsRepository: createSettingsRepository().repository,
    taskMetadataRepository: createTaskMetadataRepository().repository,
    ...overrides,
  };
}

async function createHarness(
  options: Readonly<{
    idempotencyCacheSize?: number;
    modelCatalogCacheMaxBytes?: number;
    modelCatalogCacheTtlMs?: number;
  }> = {},
) {
  const {
    archiveTask,
    compactTask,
    emitEvent,
    eventListeners,
    forkTask,
    interruptTurn,
    listBackgroundTerminals,
    listTasks,
    listModels,
    listSkills,
    provider,
    readTask,
    readTaskAttachment,
    renameTask,
    resolvePendingRequest,
    rollbackLatestTurn,
    startTask,
    startReview,
    startTurn,
    terminateBackgroundTerminal,
    unsubscribeTask,
    uploadFeedback,
  } = createProvider();
  const settings = createSettingsRepository();
  const taskMetadata = createTaskMetadataRepository();
  const app = await createCodeAgentServer(
    createServerOptions(provider, {
      ...options,
      settingsRepository: settings.repository,
      taskMetadataRepository: taskMetadata.repository,
    }),
  );
  closeCallbacks.push(() => app.close());
  return {
    app,
    archiveTask,
    compactTask,
    emitEvent,
    eventListeners,
    forkTask,
    interruptTurn,
    listBackgroundTerminals,
    listTasks,
    listModels,
    listSkills,
    readTask,
    readTaskAttachment,
    renameTask,
    resolvePendingRequest,
    rollbackLatestTurn,
    startTask,
    startReview,
    startTurn,
    terminateBackgroundTerminal,
    unsubscribeTask,
    ...settings,
    ...taskMetadata,
    uploadFeedback,
  };
}

describe("server diagnostics", () => {
  it("enables bounded handlers and emits redacted request completion logs", async () => {
    const { provider } = createProvider();
    const slowProvider = {
      ...provider,
      listTasks: vi.fn(() => new Promise<never>(() => undefined)),
    };
    const logLines: string[] = [];
    const app = await createCodeAgentServer(
      createServerOptions(slowProvider, {
        handlerTimeoutMs: 10,
        loggerEnabled: true,
        logDestination: {
          write(message: string) {
            logLines.push(message);
          },
        },
      }),
    );
    closeCallbacks.push(() => app.close());

    const response = await app.inject({
      headers: {
        authorization: "Bearer secret-token",
        cookie: "session=secret-cookie",
        "x-api-key": "secret-api-key",
      },
      method: "GET",
      url: "/v1/health",
    });
    const timedOutResponse = await app.inject({
      method: "GET",
      url: "/v1/projects/code-agent/tasks",
    });

    expect(response.statusCode).toBe(200);
    expect(timedOutResponse.statusCode).toBe(503);
    const logs = logLines.map((line) => JSON.parse(line) as Record<string, unknown>);
    const healthLog = logs.find((entry) => entry["route"] === "/v1/health");
    expect(healthLog).toMatchObject({
      method: "GET",
      msg: "request completed",
      route: "/v1/health",
      statusCode: 200,
    });
    expect(typeof healthLog?.["durationMs"]).toBe("number");
    expect(typeof healthLog?.["requestId"]).toBe("string");
    expect(logLines.join("\n")).not.toContain("secret-token");
    expect(logLines.join("\n")).not.toContain("secret-cookie");
    expect(logLines.join("\n")).not.toContain("secret-api-key");
  });
});

describe("CodeAgent Server", () => {
  it("releases an invisible task through the provider safety boundary", async () => {
    const { app, unsubscribeTask } = await createHarness();

    const response = await app.inject({
      method: "POST",
      payload: {},
      url: "/v1/projects/code-agent/tasks/task-1/unsubscribe",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "unsubscribed", taskId: "task-1" });
    expect(unsubscribeTask).toHaveBeenCalledWith("task-1");
  });

  it("lists and idempotently terminates a running background terminal", async () => {
    const { app, listBackgroundTerminals, terminateBackgroundTerminal } = await createHarness();
    listBackgroundTerminals.mockResolvedValue({
      data: [
        {
          command: "pnpm dev",
          cwd: "/workspace/CodeAgent",
          id: "terminal-1",
          itemId: "command-1",
        },
      ],
    });

    const listResponse = await app.inject({
      method: "GET",
      url: "/v1/projects/code-agent/tasks/task-1/background-terminals",
    });
    const terminateRequest = {
      headers: { "idempotency-key": "stop-terminal-1" },
      method: "POST" as const,
      payload: {},
      url: "/v1/projects/code-agent/tasks/task-1/background-terminals/terminal-1/terminate",
    };
    const firstTerminateResponse = await app.inject(terminateRequest);
    const repeatedTerminateResponse = await app.inject(terminateRequest);

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toEqual({
      data: [
        {
          command: "pnpm dev",
          cwd: "/workspace/CodeAgent",
          id: "terminal-1",
          itemId: "command-1",
        },
      ],
    });
    expect(firstTerminateResponse.statusCode).toBe(200);
    expect(repeatedTerminateResponse.json()).toEqual({
      status: "terminated",
      terminalId: "terminal-1",
    });
    expect(terminateBackgroundTerminal).toHaveBeenCalledOnce();
    expect(terminateBackgroundTerminal).toHaveBeenCalledWith("task-1", "terminal-1");
  });

  it("serves health, capabilities, and projects", async () => {
    const { app } = await createHarness();

    const healthResponse = await app.inject({ method: "GET", url: "/v1/health" });
    const capabilitiesResponse = await app.inject({ method: "GET", url: "/v1/capabilities" });
    const projectsResponse = await app.inject({ method: "GET", url: "/v1/projects" });

    expect(healthResponse.json()).toEqual({
      status: "ok",
      version: 1,
    });
    expect(capabilitiesResponse.json()).toEqual({
      feedback: { upload: true },
      provider: "codex",
      skills: { list: true, use: true },
      tasks: { fork: true, list: true, read: true, start: true },
      turns: { compact: true, interrupt: true, review: true, rollback: true, start: true },
    });
    expect(projectsResponse.json()).toEqual({ data: [project], nextCursor: null });
  });

  it("validates and persists a complete project order idempotently", async () => {
    const provider = createProvider().provider;
    const secondProject = {
      ...project,
      createdAt: "2026-07-23T00:01:00.000Z",
      id: "superwork",
      name: "superwork",
      rootPath: "/workspace/superwork",
    };
    let orderedProjects = [project, secondProject];
    const reorder = vi.fn((projectIds: readonly string[]) => {
      orderedProjects = projectIds.map((projectId) => {
        const matchedProject = orderedProjects.find((item) => item.id === projectId);
        if (matchedProject === undefined) {
          throw new Error("Unknown project");
        }
        return matchedProject;
      });
      return Promise.resolve(orderedProjects);
    });
    const app = await createCodeAgentServer(
      createServerOptions(provider, {
        projectRepository: {
          list: () => Promise.resolve(orderedProjects),
          read: (projectId: string) =>
            Promise.resolve(orderedProjects.find((item) => item.id === projectId)),
          register: () => Promise.resolve(project),
          reorder,
        },
      }),
    );
    closeCallbacks.push(() => app.close());

    const request = {
      headers: { "idempotency-key": "project-order-key" },
      method: "PUT" as const,
      payload: { projectIds: [secondProject.id, project.id] },
      url: "/v1/projects/order",
    };
    const firstResponse = await app.inject(request);
    const repeatedResponse = await app.inject(request);
    const staleResponse = await app.inject({
      ...request,
      headers: { "idempotency-key": "stale-project-order-key" },
      payload: { projectIds: [project.id] },
    });

    expect(firstResponse.statusCode).toBe(200);
    expect(firstResponse.json()).toEqual({
      data: [secondProject, project],
      nextCursor: null,
    });
    expect(repeatedResponse.json()).toEqual(firstResponse.json());
    expect(reorder).toHaveBeenCalledOnce();
    expect(staleResponse.statusCode).toBe(409);
    expect(staleResponse.json()).toMatchObject({ code: "INVALID_REQUEST", retryable: false });
  });

  it("adds a project through the host directory selector", async () => {
    const { provider } = createProvider();
    const register = vi.fn(() => Promise.resolve(project));
    const app = await createCodeAgentServer(
      createServerOptions(provider, {
        projectRepository: {
          list: () => Promise.resolve([]),
          read: () => Promise.resolve(undefined),
          register,
        },
        selectProjectDirectory: () => Promise.resolve(project.rootPath),
      }),
    );
    closeCallbacks.push(() => app.close());

    const response = await app.inject({
      headers: { "idempotency-key": "add-project" },
      method: "POST",
      payload: {},
      url: "/v1/projects",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ project });
    expect(register).toHaveBeenCalledWith({ name: "CodeAgent", rootPath: project.rootPath });
  });

  it("serves the configured project's Git working tree status", async () => {
    const { provider } = createProvider();
    const readProjectGitStatus = vi.fn(() =>
      Promise.resolve({
        baseBranches: ["origin/main", "main"],
        branch: "feat/review",
        staged: [
          {
            diff: "--- a/staged.ts\n+++ b/staged.ts\n@@ -1 +1 @@\n-old\n+new",
            kind: "update" as const,
            path: "staged.ts",
          },
        ],
        unstaged: [],
      }),
    );
    const app = await createCodeAgentServer(
      createServerOptions(provider, { readProjectGitStatus }),
    );
    closeCallbacks.push(() => app.close());

    const response = await app.inject({
      method: "GET",
      url: "/v1/projects/code-agent/git/status",
    });
    const missingProjectResponse = await app.inject({
      method: "GET",
      url: "/v1/projects/other/git/status",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      baseBranches: ["origin/main", "main"],
      branch: "feat/review",
      staged: [{ path: "staged.ts" }],
      unstaged: [],
    });
    expect(readProjectGitStatus).toHaveBeenCalledWith(project.rootPath);
    expect(missingProjectResponse.statusCode).toBe(404);
    expect(readProjectGitStatus).toHaveBeenCalledTimes(1);
  });

  it("serves bounded source previews only for the configured project", async () => {
    const { provider } = createProvider();
    const readProjectSourceFile = vi.fn(() =>
      Promise.resolve({
        content: "### 11.7 认证\n",
        path: "docs/architecture-design.md",
        truncated: true,
      }),
    );
    const app = await createCodeAgentServer(
      createServerOptions(provider, { readProjectSourceFile }),
    );
    closeCallbacks.push(() => app.close());

    const response = await app.inject({
      method: "GET",
      url: "/v1/projects/code-agent/files/source?path=%2Fworkspace%2FCodeAgent%2Fdocs%2Farchitecture-design.md",
    });
    const missingProjectResponse = await app.inject({
      method: "GET",
      url: "/v1/projects/other/files/source?path=docs%2Farchitecture-design.md",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      content: "### 11.7 认证\n",
      path: "docs/architecture-design.md",
      truncated: true,
    });
    expect(readProjectSourceFile).toHaveBeenCalledWith(
      project.rootPath,
      "/workspace/CodeAgent/docs/architecture-design.md",
    );
    expect(missingProjectResponse.statusCode).toBe(404);
    expect(readProjectSourceFile).toHaveBeenCalledTimes(1);
  });

  it("serves models and resolves uploaded attachments before starting a turn", async () => {
    const { app, listModels, listSkills, startTurn, writeTaskSettings } = await createHarness();
    const models = await app.inject({ method: "GET", url: "/v1/models" });
    const skills = await app.inject({ method: "GET", url: "/v1/projects/code-agent/skills" });
    const uploadRequest = {
      headers: { "idempotency-key": "upload-1" },
      method: "POST" as const,
      payload: { dataUrl: pixelDataUrl, name: "screen.png" },
      url: "/v1/projects/code-agent/attachments",
    };
    const uploaded = await app.inject(uploadRequest);
    const repeatedUpload = await app.inject(uploadRequest);
    const attachment = uploaded.json<{ attachment: { id: string } }>().attachment;
    const turn = await app.inject({
      headers: { "idempotency-key": "attachment-turn" },
      method: "POST",
      payload: {
        input: { attachments: [{ id: attachment.id }], skills: [], text: "", type: "prompt" },
        options: turnOptions,
      },
      url: "/v1/projects/code-agent/tasks/task-1/turns",
    });
    const invalidTurn = await app.inject({
      headers: { "idempotency-key": "invalid-turn-settings" },
      method: "POST",
      payload: {
        ...turnRequest("无效设置"),
        options: { ...turnOptions, reasoningEffort: "low" },
      },
      url: "/v1/projects/code-agent/tasks/task-1/turns",
    });
    const consumed = await app.inject({
      headers: { "idempotency-key": "attachment-consumed" },
      method: "POST",
      payload: {
        input: { attachments: [{ id: attachment.id }], skills: [], text: "", type: "prompt" },
        options: turnOptions,
      },
      url: "/v1/projects/code-agent/tasks/task-1/turns",
    });

    expect(models.statusCode).toBe(200);
    expect(models.json()).toMatchObject({ data: [{ id: "gpt-5.6-sol", isDefault: true }] });
    expect(skills.statusCode).toBe(200);
    expect(skills.json()).toMatchObject({ data: [{ name: "review-security" }] });
    expect(listSkills).toHaveBeenCalledOnce();
    expect(listModels).toHaveBeenCalledOnce();
    expect(uploaded.statusCode).toBe(201);
    expect(repeatedUpload.json()).toEqual(uploaded.json());
    expect(uploaded.json()).toMatchObject({
      attachment: { mediaType: "image/png", name: "screen.png", size: 68 },
    });
    expect(turn.statusCode).toBe(201);
    expect(invalidTurn.statusCode).toBe(400);
    expect(startTurn).toHaveBeenCalledOnce();
    expect(writeTaskSettings).toHaveBeenCalledOnce();
    expect(startTurn).toHaveBeenCalledWith(
      "task-1",
      { images: [{ mediaType: "image/png", url: pixelDataUrl }], skills: [], text: "" },
      turnOptions,
    );
    expect(consumed.statusCode).toBe(404);
    expect(consumed.json()).toMatchObject({ code: "ATTACHMENT_NOT_FOUND" });
  });

  it("serves historical attachment bytes through the project task scope", async () => {
    const { app, readTaskAttachment } = await createHarness();

    const response = await app.inject({
      method: "GET",
      url: "/v1/projects/code-agent/tasks/task-1/attachments/history%2Fimage-1",
    });
    const missingAttachment = await app.inject({
      method: "GET",
      url: "/v1/projects/code-agent/tasks/task-1/attachments/missing",
    });
    const missingProject = await app.inject({
      method: "GET",
      url: "/v1/projects/missing/tasks/task-1/attachments/history%2Fimage-1",
    });

    expect(response.statusCode).toBe(200);
    expect(response.rawPayload).toEqual(historicalImageContent);
    expect(response.headers["content-type"]).toBe("image/png");
    expect(response.headers["cache-control"]).toBe("private, max-age=300");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(missingAttachment.statusCode).toBe(404);
    expect(missingProject.statusCode).toBe(404);
    expect(readTaskAttachment).toHaveBeenCalledTimes(2);
    expect(readTaskAttachment).toHaveBeenNthCalledWith(1, "task-1", "history/image-1");
  });

  it("lists project tasks with validated pagination", async () => {
    const { app, listTasks } = await createHarness();
    const response = await app.inject({
      method: "GET",
      url: "/v1/projects/code-agent/tasks?cursor=cursor&limit=25",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: [task], nextCursor: "next" });
    expect(listTasks).toHaveBeenCalledWith({ cursor: "cursor", limit: 25 });
  });

  it("reads a structured task snapshot", async () => {
    const { app } = await createHarness();
    const response = await app.inject({
      method: "GET",
      url: "/v1/projects/code-agent/tasks/task-1",
    });
    const body = response.json<{
      checkpoint: { sequence: number; sessionId: unknown };
      snapshot: typeof snapshot;
    }>();

    expect(response.statusCode).toBe(200);
    expect(body.checkpoint.sequence).toBe(0);
    expect(typeof body.checkpoint.sessionId).toBe("string");
    expect(body.snapshot).toEqual({
      ...snapshot,
      settings: { ...turnOptions, sandboxMode: "read-only" },
    });
  });

  it("deduplicates concurrent model catalog reads and reuses the cached catalog", async () => {
    const { app, listModels } = await createHarness();
    let resolveCatalog!: (page: AgentModelPage) => void;
    listModels.mockImplementationOnce(
      () =>
        new Promise<AgentModelPage>((resolve) => {
          resolveCatalog = resolve;
        }),
    );

    const modelsResponse = app.inject({ method: "GET", url: "/v1/models" });
    const snapshotResponse = app.inject({
      method: "GET",
      url: "/v1/projects/code-agent/tasks/task-1",
    });
    await vi.waitFor(() => {
      expect(listModels).toHaveBeenCalledOnce();
    });
    resolveCatalog(modelPage);

    expect((await modelsResponse).statusCode).toBe(200);
    expect((await snapshotResponse).statusCode).toBe(200);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/projects/code-agent/defaults",
        })
      ).statusCode,
    ).toBe(200);
    expect(listModels).toHaveBeenCalledOnce();
  });

  it("expires, bounds, and clears the model catalog cache with the Runtime lifecycle", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const cached = await createHarness({ modelCatalogCacheTtlMs: 100 });
    await cached.app.inject({ method: "GET", url: "/v1/models" });
    await cached.app.inject({ method: "GET", url: "/v1/models" });
    expect(cached.listModels).toHaveBeenCalledOnce();

    now.mockReturnValue(1_101);
    await cached.app.inject({ method: "GET", url: "/v1/models" });
    expect(cached.listModels).toHaveBeenCalledTimes(2);

    const bounded = await createHarness({ modelCatalogCacheMaxBytes: 1 });
    await bounded.app.inject({ method: "GET", url: "/v1/models" });
    await bounded.app.inject({ method: "GET", url: "/v1/models" });
    expect(bounded.listModels).toHaveBeenCalledTimes(2);

    const restartedProvider = createProvider();
    const firstRuntime = await createCodeAgentServer(
      createServerOptions(restartedProvider.provider),
    );
    await firstRuntime.inject({ method: "GET", url: "/v1/models" });
    await firstRuntime.close();
    const secondRuntime = await createCodeAgentServer(
      createServerOptions(restartedProvider.provider),
    );
    closeCallbacks.push(() => secondRuntime.close());
    await secondRuntime.inject({ method: "GET", url: "/v1/models" });
    expect(restartedProvider.listModels).toHaveBeenCalledTimes(2);
    now.mockRestore();
  });

  it("reads task settings and pinned metadata in parallel after ownership is confirmed", async () => {
    const { app, listPinnedTaskIds, readTask, readTaskSettings } = await createHarness();
    let resolveTask!: (value: AgentProviderTaskSnapshot) => void;
    let resolveSettings!: (value: AgentTaskSettings | undefined) => void;
    let resolvePinned!: (value: string[]) => void;
    readTask.mockImplementationOnce(
      () =>
        new Promise<AgentProviderTaskSnapshot>((resolve) => {
          resolveTask = resolve;
        }),
    );
    readTaskSettings.mockImplementationOnce(
      () =>
        new Promise<AgentTaskSettings | undefined>((resolve) => {
          resolveSettings = resolve;
        }),
    );
    listPinnedTaskIds.mockImplementationOnce(
      () =>
        new Promise<string[]>((resolve) => {
          resolvePinned = resolve;
        }),
    );

    const response = app.inject({
      method: "GET",
      url: "/v1/projects/code-agent/tasks/task-1",
    });
    await vi.waitFor(() => {
      expect(readTask).toHaveBeenCalledOnce();
    });
    expect(readTaskSettings).not.toHaveBeenCalled();
    expect(listPinnedTaskIds).not.toHaveBeenCalled();

    resolveTask(snapshot);
    await vi.waitFor(() => {
      expect(readTaskSettings).toHaveBeenCalledOnce();
      expect(listPinnedTaskIds).toHaveBeenCalledOnce();
    });
    resolveSettings(undefined);
    resolvePinned([task.id]);

    expect((await response).json()).toMatchObject({ snapshot: { pinned: true } });
  });

  it("returns effective settings and atomically validates complete updates", async () => {
    const {
      app,
      listModels,
      readProjectDefaults,
      readTaskSettings,
      writeProjectDefaults,
      writeTaskSettings,
    } = await createHarness();
    listModels.mockResolvedValue({
      data: [
        {
          defaultReasoningEffort: "high",
          description: "默认模型",
          displayName: "GPT-5.6 Sol",
          id: "gpt-5.6-sol",
          isDefault: true,
          supportedReasoningEfforts: [
            { description: "低", id: "low" },
            { description: "高", id: "high" },
          ],
        },
      ],
      nextCursor: null,
    });
    readProjectDefaults.mockResolvedValue({
      model: "removed-model",
      reasoningEffort: "ultra",
      sandboxMode: "read-only",
    });
    readTaskSettings.mockResolvedValue({
      approvalPolicy: "never",
      approvalsReviewer: "user",
      model: "removed-model",
      reasoningEffort: "ultra",
      sandboxMode: "danger-full-access",
    });

    const defaults = await app.inject({
      method: "GET",
      url: "/v1/projects/code-agent/defaults",
    });
    const taskSnapshot = await app.inject({
      method: "GET",
      url: "/v1/projects/code-agent/tasks/task-1",
    });
    const invalid = await app.inject({
      headers: { "idempotency-key": "invalid-defaults" },
      method: "PUT",
      payload: {
        model: "gpt-5.6-sol",
        reasoningEffort: "ultra",
        sandboxMode: "workspace-write",
      },
      url: "/v1/projects/code-agent/defaults",
    });
    const updated = await app.inject({
      headers: { "idempotency-key": "task-settings" },
      method: "PUT",
      payload: {
        approvalPolicy: "on-request",
        approvalsReviewer: "auto_review",
        model: "gpt-5.6-sol",
        reasoningEffort: "low",
        sandboxMode: "workspace-write",
      },
      url: "/v1/projects/code-agent/tasks/task-1/settings",
    });

    expect(defaults.json()).toEqual({
      settings: {
        model: "gpt-5.6-sol",
        reasoningEffort: "high",
        sandboxMode: "read-only",
      },
    });
    expect(taskSnapshot.json()).toMatchObject({
      snapshot: {
        settings: {
          approvalPolicy: "never",
          approvalsReviewer: "user",
          model: "gpt-5.6-sol",
          reasoningEffort: "high",
          sandboxMode: "danger-full-access",
        },
      },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ code: "INVALID_REQUEST" });
    expect(updated.json()).toEqual({
      settings: {
        approvalPolicy: "on-request",
        approvalsReviewer: "auto_review",
        model: "gpt-5.6-sol",
        reasoningEffort: "low",
        sandboxMode: "workspace-write",
      },
    });
    expect(writeProjectDefaults).toHaveBeenCalledWith("code-agent", {
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      sandboxMode: "read-only",
    });
    expect(writeTaskSettings).toHaveBeenCalledWith("code-agent", "task-1", {
      approvalPolicy: "never",
      approvalsReviewer: "user",
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      sandboxMode: "danger-full-access",
    });
  });

  it("starts new tasks with on-request and persists turn settings before Provider calls", async () => {
    const { app, readProjectDefaults, readTaskSettings, startTask, startTurn, writeTaskSettings } =
      await createHarness();
    readProjectDefaults.mockResolvedValue({
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      sandboxMode: "read-only",
    });
    readTaskSettings.mockResolvedValue({
      approvalPolicy: "never",
      approvalsReviewer: "user",
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      sandboxMode: "danger-full-access",
    });

    const created = await app.inject({
      headers: { "idempotency-key": "new-task-defaults" },
      method: "POST",
      payload: {},
      url: "/v1/projects/code-agent/tasks",
    });
    const turn = await app.inject({
      headers: { "idempotency-key": "persist-turn-settings" },
      method: "POST",
      payload: turnRequest("继续实现"),
      url: "/v1/projects/code-agent/tasks/task-1/turns",
    });

    expect(created.statusCode).toBe(201);
    expect(startTask).toHaveBeenCalledOnce();
    expect(writeTaskSettings).toHaveBeenCalledWith("code-agent", "task-1", {
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      sandboxMode: "read-only",
    });
    expect(turn.statusCode).toBe(201);
    expect(writeTaskSettings.mock.invocationCallOrder.at(-1)).toBeLessThan(
      startTurn.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  it("serves idempotent task and turn mutations", async () => {
    const { app, interruptTurn, readTask, startTask, startTurn } = await createHarness();
    const headers = { "idempotency-key": "mutation-1" };

    const created = await app.inject({
      headers,
      method: "POST",
      payload: {},
      url: "/v1/projects/code-agent/tasks",
    });
    const repeated = await app.inject({
      headers,
      method: "POST",
      payload: {},
      url: "/v1/projects/code-agent/tasks",
    });
    const turn = await app.inject({
      headers: { "idempotency-key": "turn-1" },
      method: "POST",
      payload: turnRequest("继续实现"),
      url: "/v1/projects/code-agent/tasks/task-1/turns",
    });
    const turnBody = turn.json<{ taskId: string; turn: AgentTurn }>();
    readTask.mockResolvedValueOnce({
      ...snapshot,
      status: "running",
      turns: [turnBody.turn],
    });
    const interrupted = await app.inject({
      headers: { "idempotency-key": "interrupt-1" },
      method: "POST",
      payload: { taskId: "task-1" },
      url: "/v1/projects/code-agent/tasks/task-1/turns/turn-1/interrupt",
    });

    expect(created.statusCode).toBe(201);
    expect(repeated.json()).toEqual(created.json());
    expect(startTask).toHaveBeenCalledTimes(1);
    expect(turn.statusCode).toBe(201);
    expect(turn.json()).toMatchObject({ taskId: "task-1", turn: { id: "turn-1" } });
    expect(startTurn).toHaveBeenCalledWith(
      "task-1",
      { images: [], skills: [], text: "继续实现" },
      turnOptions,
    );
    expect(interrupted.statusCode).toBe(202);
    expect(interrupted.json()).toEqual({
      status: "interrupting",
      taskId: "task-1",
      turnId: "turn-1",
    });
    expect(interruptTurn).toHaveBeenCalledWith("task-1", "turn-1");

    readTask.mockResolvedValueOnce({
      ...snapshot,
      turns: [{ ...turnBody.turn, completedAt: "2026-07-23T00:03:00.000Z", status: "interrupted" }],
    });
    const replayedInterrupt = await app.inject({
      headers: { "idempotency-key": "interrupt-1" },
      method: "POST",
      payload: { taskId: "task-1" },
      url: "/v1/projects/code-agent/tasks/task-1/turns/turn-1/interrupt",
    });

    expect(replayedInterrupt.statusCode).toBe(202);
    expect(replayedInterrupt.json()).toEqual(interrupted.json());
    expect(interruptTurn).toHaveBeenCalledTimes(1);
  });

  it("reuses a created task when settings persistence is retried", async () => {
    const { app, startTask, writeTaskSettings } = await createHarness();
    writeTaskSettings.mockRejectedValueOnce(new Error("database unavailable"));
    const request = {
      headers: { "idempotency-key": "retry-task-settings" },
      method: "POST" as const,
      payload: {},
      url: "/v1/projects/code-agent/tasks",
    };

    const failed = await app.inject(request);
    const retried = await app.inject(request);

    expect(failed.statusCode).toBe(502);
    expect(retried.statusCode).toBe(201);
    expect(startTask).toHaveBeenCalledOnce();
    expect(writeTaskSettings).toHaveBeenCalledTimes(2);
  });

  it("serves idempotent task command mutations", async () => {
    const { app, compactTask, forkTask, startReview, uploadFeedback } = await createHarness();
    const reviewRequest = {
      headers: { "idempotency-key": "review-key" },
      method: "POST" as const,
      payload: { target: { type: "base_branch", branch: "main" } },
      url: "/v1/projects/code-agent/tasks/task-1/review",
    };

    const review = await app.inject(reviewRequest);
    const repeatedReview = await app.inject(reviewRequest);
    const compact = await app.inject({
      headers: { "idempotency-key": "compact-key" },
      method: "POST",
      payload: {},
      url: "/v1/projects/code-agent/tasks/task-1/compact",
    });
    const fork = await app.inject({
      headers: { "idempotency-key": "fork-key" },
      method: "POST",
      payload: {},
      url: "/v1/projects/code-agent/tasks/task-1/fork",
    });
    const feedback = await app.inject({
      headers: { "idempotency-key": "feedback-key" },
      method: "POST",
      payload: { classification: "other", includeLogs: true, reason: "体验反馈" },
      url: "/v1/projects/code-agent/tasks/task-1/feedback",
    });

    expect(review.statusCode, review.body).toBe(201);
    expect(repeatedReview.json()).toEqual(review.json());
    expect(review.json()).toMatchObject({ taskId: "task-1", turn: { id: "review-turn" } });
    expect(startReview).toHaveBeenCalledTimes(1);
    expect(startReview).toHaveBeenCalledWith("task-1", {
      branch: "main",
      type: "base_branch",
    });
    expect(compact.statusCode).toBe(202);
    expect(compact.json()).toEqual({ status: "compacting", taskId: "task-1" });
    expect(compactTask).toHaveBeenCalledWith("task-1");
    expect(fork.statusCode).toBe(201);
    expect(fork.json()).toMatchObject({ task: { id: "task-2" } });
    expect(forkTask).toHaveBeenCalledWith("task-1");
    expect(feedback.statusCode).toBe(200);
    expect(feedback.json()).toEqual({ status: "sent", taskId: "task-1" });
    expect(uploadFeedback).toHaveBeenCalledWith("task-1", {
      classification: "other",
      includeLogs: true,
      reason: "体验反馈",
    });
  });

  it("pins locally and delegates rename and archive to the Provider", async () => {
    const { app, archiveTask, renameTask, writeTaskPinned } = await createHarness();

    const pinned = await app.inject({
      headers: { "idempotency-key": "pin-key" },
      method: "PUT",
      payload: { pinned: true },
      url: "/v1/projects/code-agent/tasks/task-1/pin",
    });
    const renamed = await app.inject({
      headers: { "idempotency-key": "rename-key" },
      method: "POST",
      payload: { title: "新的任务名称" },
      url: "/v1/projects/code-agent/tasks/task-1/rename",
    });
    const listed = await app.inject({ method: "GET", url: "/v1/projects/code-agent/tasks" });
    const archived = await app.inject({
      headers: { "idempotency-key": "archive-key" },
      method: "POST",
      payload: {},
      url: "/v1/projects/code-agent/tasks/task-1/archive",
    });

    expect(pinned.statusCode, pinned.body).toBe(200);
    expect(pinned.json()).toMatchObject({ task: { id: "task-1", pinned: true } });
    expect(writeTaskPinned).toHaveBeenCalledWith("code-agent", "task-1", true);
    expect(renamed.statusCode, renamed.body).toBe(200);
    expect(renamed.json()).toMatchObject({ task: { id: "task-1", title: "新的任务名称" } });
    expect(renameTask).toHaveBeenCalledWith("task-1", "新的任务名称");
    expect(listed.json()).toMatchObject({ data: [{ id: "task-1", pinned: true }] });
    expect(archived.statusCode, archived.body).toBe(200);
    expect(archived.json()).toEqual({ status: "archived", taskId: "task-1" });
    expect(archiveTask).toHaveBeenCalledWith("task-1");
  });

  it("isolates idempotent task command results by project", async () => {
    const primary = createProvider();
    const secondary = createProvider();
    const otherProject = {
      ...project,
      id: "other-project",
      name: "Other Project",
      rootPath: "/workspace/OtherProject",
    };
    secondary.readTask.mockResolvedValue({ ...snapshot, projectId: otherProject.id });
    secondary.startReview.mockResolvedValue({
      completedAt: null,
      error: null,
      id: "other-review-turn",
      items: [],
      startedAt: "2026-07-26T00:00:00.000Z",
      status: "running",
    });
    const runtimeProvider: AgentRuntimeProvider = {
      forProject: (activeProject) =>
        activeProject.id === otherProject.id ? secondary.provider : primary.provider,
      getCapabilities: () => primary.provider.getCapabilities(),
      listModels: () => primary.provider.listModels(),
    };
    const app = await createCodeAgentServer({
      projectRepository: {
        list: () => Promise.resolve([project, otherProject]),
        read: (projectId) =>
          Promise.resolve([project, otherProject].find((item) => item.id === projectId)),
        register: () => Promise.resolve(project),
        reorder: () => Promise.resolve([project, otherProject]),
      },
      provider: runtimeProvider,
      selectProjectDirectory: () => Promise.resolve(undefined),
      settingsRepository: createSettingsRepository().repository,
      taskMetadataRepository: createTaskMetadataRepository().repository,
    });
    closeCallbacks.push(() => app.close());
    const request = {
      headers: { "idempotency-key": "shared-review-key" },
      method: "POST" as const,
      payload: { target: { type: "uncommitted_changes" } },
    };

    const first = await app.inject({
      ...request,
      url: "/v1/projects/code-agent/tasks/task-1/review",
    });
    const second = await app.inject({
      ...request,
      url: "/v1/projects/other-project/tasks/task-1/review",
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json()).toMatchObject({ turn: { id: "other-review-turn" } });
    expect(primary.startReview).toHaveBeenCalledTimes(1);
    expect(secondary.startReview).toHaveBeenCalledTimes(1);
  });

  it("restores files and rolls back the latest completed turn idempotently", async () => {
    const { provider, readTask, rollbackLatestTurn } = createProvider();
    const fileChange = {
      diff: "--- a/src/index.ts\n+++ b/src/index.ts\n@@ -1 +1 @@\n-old\n+new",
      kind: "update" as const,
      path: "src/index.ts",
    };
    readTask.mockResolvedValue({
      ...snapshot,
      turns: [
        {
          completedAt: "2026-07-23T00:03:00.000Z",
          error: null,
          id: "turn-1",
          items: [
            {
              changes: [fileChange],
              id: "change-1",
              status: "completed",
              type: "file_change",
            },
          ],
          startedAt: "2026-07-23T00:02:00.000Z",
          status: "completed",
        },
      ],
    });
    const applyReverse = vi.fn(() => Promise.resolve());
    const applyForward = vi.fn(() => Promise.resolve());
    const prepareTurnFileRollback = vi.fn(() =>
      Promise.resolve({ applyForward, applyReverse, restoredFiles: ["src/index.ts"] }),
    );
    const app = await createCodeAgentServer(
      createServerOptions(provider, { prepareTurnFileRollback }),
    );
    closeCallbacks.push(() => app.close());
    const request = {
      headers: { "idempotency-key": "rollback-1" },
      method: "POST" as const,
      payload: { taskId: "task-1" },
      url: "/v1/projects/code-agent/tasks/task-1/turns/turn-1/rollback",
    };

    const first = await app.inject(request);
    const repeated = await app.inject(request);

    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({
      restoredFiles: ["src/index.ts"],
      status: "rolled_back",
      taskId: "task-1",
      turnId: "turn-1",
    });
    expect(repeated.json()).toEqual(first.json());
    expect(prepareTurnFileRollback).toHaveBeenCalledWith(project.rootPath, [fileChange]);
    expect(applyReverse).toHaveBeenCalledTimes(1);
    expect(applyForward).not.toHaveBeenCalled();
    expect(rollbackLatestTurn).toHaveBeenCalledTimes(1);
    expect(rollbackLatestTurn).toHaveBeenCalledWith("task-1");
  });

  it("compensates restored files when Codex rollback fails", async () => {
    const { provider, readTask, rollbackLatestTurn } = createProvider();
    readTask.mockResolvedValue({
      ...snapshot,
      turns: [
        {
          completedAt: "2026-07-23T00:03:00.000Z",
          error: null,
          id: "turn-1",
          items: [
            {
              changes: [{ diff: "content", kind: "create", path: "new.ts" }],
              id: "change-1",
              status: "completed",
              type: "file_change",
            },
          ],
          startedAt: "2026-07-23T00:02:00.000Z",
          status: "completed",
        },
      ],
    });
    rollbackLatestTurn.mockRejectedValue(new Error("Codex unavailable"));
    const applyReverse = vi.fn(() => Promise.resolve());
    const applyForward = vi.fn(() => Promise.resolve());
    const app = await createCodeAgentServer(
      createServerOptions(provider, {
        prepareTurnFileRollback: () =>
          Promise.resolve({ applyForward, applyReverse, restoredFiles: ["new.ts"] }),
      }),
    );
    closeCallbacks.push(() => app.close());

    const response = await app.inject({
      headers: { "idempotency-key": "rollback-failed" },
      method: "POST",
      payload: { taskId: "task-1" },
      url: "/v1/projects/code-agent/tasks/task-1/turns/turn-1/rollback",
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({ code: "PROVIDER_ERROR", retryable: true });
    expect(applyReverse).toHaveBeenCalledOnce();
    expect(applyForward).toHaveBeenCalledOnce();
  });

  it("resolves pending requests idempotently with complete identity validation", async () => {
    const { app, resolvePendingRequest, writeTaskSettings } = await createHarness();
    const request = {
      headers: { "idempotency-key": "resolve-1" },
      method: "POST" as const,
      payload: {
        itemId: pendingRequest.itemId,
        projectId: pendingRequest.projectId,
        resolution: { decision: "allow_for_session" },
        taskId: pendingRequest.taskId,
        turnId: pendingRequest.turnId,
        type: pendingRequest.type,
      },
      url: `/v1/projects/code-agent/tasks/task-1/pending-requests/${encodeURIComponent(pendingRequest.requestId)}/resolve`,
    };

    const first = await app.inject(request);
    const repeated = await app.inject(request);

    expect(first.statusCode).toBe(200);
    expect(repeated.json()).toEqual(first.json());
    expect(first.json()).toEqual({ request: { ...pendingRequest, status: "resolved" } });
    expect(resolvePendingRequest).toHaveBeenCalledTimes(1);
    expect(resolvePendingRequest).toHaveBeenCalledWith({
      ...request.payload,
      requestId: pendingRequest.requestId,
    });
    // 会话级授权只交给当前 Provider 进程，不能写入长期 Task 设置。
    expect(writeTaskSettings).not.toHaveBeenCalled();
  });

  it("rejects cross-project and stale pending request resolutions", async () => {
    const { app, resolvePendingRequest } = await createHarness();
    const request = {
      headers: { "idempotency-key": "resolve-invalid" },
      method: "POST" as const,
      payload: {
        itemId: pendingRequest.itemId,
        projectId: "other-project",
        resolution: { decision: "deny" },
        taskId: pendingRequest.taskId,
        turnId: pendingRequest.turnId,
        type: pendingRequest.type,
      },
      url: `/v1/projects/code-agent/tasks/task-1/pending-requests/${encodeURIComponent(pendingRequest.requestId)}/resolve`,
    };
    const crossProject = await app.inject(request);
    expect(crossProject.statusCode).toBe(409);
    expect(crossProject.json()).toMatchObject({ code: "PENDING_REQUEST_MISMATCH" });
    expect(resolvePendingRequest).not.toHaveBeenCalled();

    resolvePendingRequest.mockRejectedValueOnce(
      new PendingRequestResolutionError("mismatch", "identity mismatch"),
    );
    const mismatch = await app.inject({
      ...request,
      headers: { "idempotency-key": "resolve-mismatch" },
      payload: { ...request.payload, itemId: "other-item", projectId: pendingRequest.projectId },
    });
    expect(mismatch.statusCode).toBe(409);
    expect(mismatch.json()).toMatchObject({ code: "PENDING_REQUEST_MISMATCH" });

    resolvePendingRequest.mockRejectedValueOnce(
      new PendingRequestResolutionError("expired", "request expired"),
    );
    const expired = await app.inject({
      ...request,
      headers: { "idempotency-key": "resolve-expired" },
      payload: { ...request.payload, projectId: pendingRequest.projectId },
    });
    expect(expired.statusCode).toBe(409);
    expect(expired.json()).toMatchObject({ code: "PENDING_REQUEST_EXPIRED" });
  });

  it("reuses idempotent results for equivalent payload key orders", async () => {
    const { app, startTurn } = await createHarness();
    const headers = {
      "content-type": "application/json",
      "idempotency-key": "equivalent-payload",
    };
    const first = await app.inject({
      headers,
      method: "POST",
      payload:
        '{"input":{"attachments":[],"skills":[],"text":"继续实现","type":"prompt"},"options":{"approvalPolicy":"on-request","approvalsReviewer":"user","model":"gpt-5.6-sol","reasoningEffort":"high","sandboxMode":"workspace-write"}}',
      url: "/v1/projects/code-agent/tasks/task-1/turns",
    });
    const repeated = await app.inject({
      headers,
      method: "POST",
      payload:
        '{"options":{"sandboxMode":"workspace-write","reasoningEffort":"high","model":"gpt-5.6-sol","approvalsReviewer":"user","approvalPolicy":"on-request"},"input":{"type":"prompt","text":"继续实现","skills":[],"attachments":[]}}',
      url: "/v1/projects/code-agent/tasks/task-1/turns",
    });

    expect(first.statusCode).toBe(201);
    expect(repeated.statusCode).toBe(201);
    expect(repeated.json()).toEqual(first.json());
    expect(startTurn).toHaveBeenCalledTimes(1);
  });

  it("keeps idempotency scopes distinct when resource IDs and keys contain separators", async () => {
    const { app, readTask, startTurn } = await createHarness();
    readTask.mockImplementation((taskId) =>
      Promise.resolve({ ...snapshot, id: taskId, turns: [] }),
    );
    const payload = turnRequest("继续实现");

    const first = await app.inject({
      headers: { "idempotency-key": "b:c" },
      method: "POST",
      payload,
      url: "/v1/projects/code-agent/tasks/task%3Aa/turns",
    });
    const second = await app.inject({
      headers: { "idempotency-key": "c" },
      method: "POST",
      payload,
      url: "/v1/projects/code-agent/tasks/task%3Aa%3Ab/turns",
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(startTurn).toHaveBeenNthCalledWith(
      1,
      "task:a",
      { images: [], skills: [], text: payload.input.text },
      payload.options,
    );
    expect(startTurn).toHaveBeenNthCalledWith(
      2,
      "task:a:b",
      { images: [], skills: [], text: payload.input.text },
      payload.options,
    );
  });

  it("evicts completed idempotency entries when the cache reaches its limit", async () => {
    const { app, startTask } = await createHarness({ idempotencyCacheSize: 1 });
    const createTask = (key: string) =>
      app.inject({
        headers: { "idempotency-key": key },
        method: "POST",
        payload: {},
        url: "/v1/projects/code-agent/tasks",
      });

    await createTask("task-key-1");
    await createTask("task-key-2");
    await createTask("task-key-1");

    expect(startTask).toHaveBeenCalledTimes(3);
  });

  it("rejects interruption for a terminal or unrelated turn", async () => {
    const { app, interruptTurn, readTask } = await createHarness();
    readTask.mockResolvedValueOnce({
      ...snapshot,
      turns: [
        {
          completedAt: "2026-07-23T00:03:00.000Z",
          error: null,
          id: "turn-completed",
          items: [],
          startedAt: "2026-07-23T00:02:00.000Z",
          status: "completed" as const,
        },
      ],
    });
    const terminal = await app.inject({
      headers: { "idempotency-key": "terminal-turn" },
      method: "POST",
      payload: { taskId: "task-1" },
      url: "/v1/projects/code-agent/tasks/task-1/turns/turn-completed/interrupt",
    });
    readTask.mockResolvedValueOnce(snapshot);
    const missing = await app.inject({
      headers: { "idempotency-key": "missing-turn" },
      method: "POST",
      payload: { taskId: "task-1" },
      url: "/v1/projects/code-agent/tasks/task-1/turns/turn-missing/interrupt",
    });

    expect(terminal.statusCode).toBe(409);
    expect(terminal.json()).toMatchObject({ code: "TURN_NOT_RUNNING" });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ code: "TURN_NOT_FOUND" });
    expect(interruptTurn).not.toHaveBeenCalled();
  });

  it("validates idempotency keys and rejects conflicting payloads", async () => {
    const { app, startTurn } = await createHarness();
    const missingKey = await app.inject({
      method: "POST",
      payload: {},
      url: "/v1/projects/code-agent/tasks",
    });
    const first = await app.inject({
      headers: { "idempotency-key": "turn-conflict" },
      method: "POST",
      payload: turnRequest("第一次"),
      url: "/v1/projects/code-agent/tasks/task-1/turns",
    });
    const conflict = await app.inject({
      headers: { "idempotency-key": "turn-conflict" },
      method: "POST",
      payload: turnRequest("第二次"),
      url: "/v1/projects/code-agent/tasks/task-1/turns",
    });

    expect(missingKey.statusCode).toBe(400);
    expect(missingKey.json()).toMatchObject({
      code: "IDEMPOTENCY_KEY_REQUIRED",
      retryable: false,
    });
    expect(first.statusCode).toBe(201);
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ code: "IDEMPOTENCY_CONFLICT", retryable: false });
    expect(startTurn).toHaveBeenCalledTimes(1);
  });

  it("normalizes provider failures without caching them", async () => {
    const { app, startTask } = await createHarness();
    startTask.mockRejectedValueOnce(new Error("native RPC details"));
    const request = {
      headers: { "idempotency-key": "retry-task" },
      method: "POST" as const,
      payload: {},
      url: "/v1/projects/code-agent/tasks",
    };

    const failed = await app.inject(request);
    const retried = await app.inject(request);

    expect(failed.statusCode).toBe(502);
    expect(failed.json()).toEqual({
      code: "PROVIDER_ERROR",
      message: "Agent provider request failed",
      retryable: true,
    });
    expect(retried.statusCode).toBe(201);
    expect(startTask).toHaveBeenCalledTimes(2);
  });

  it("captures the checkpoint after reading a task snapshot", async () => {
    const harness = createProvider();
    const snapshotDuringRead = {
      ...snapshot,
      status: "running" as const,
      turns: [
        {
          completedAt: null,
          error: null,
          id: "turn-1",
          items: [
            {
              id: "item-1",
              role: "assistant" as const,
              text: "读取期间到达",
              type: "message" as const,
            },
          ],
          startedAt: "2026-07-23T00:01:00.000Z",
          status: "running" as const,
        },
      ],
    };
    const provider: AgentProvider = {
      ...harness.provider,
      readTask: vi.fn((taskId: string) => {
        harness.emitEvent({
          itemId: "item-1",
          payload: { delta: "读取期间到达" },
          taskId,
          turnId: "turn-1",
          type: "message.delta",
        });
        return Promise.resolve(snapshotDuringRead);
      }),
    };
    const app = await createCodeAgentServer(createServerOptions(provider));
    closeCallbacks.push(() => app.close());

    const response = await app.inject({
      method: "GET",
      url: "/v1/projects/code-agent/tasks/task-1",
    });

    expect(response.json()).toMatchObject({
      checkpoint: { sequence: 1 },
      snapshot: snapshotDuringRead,
    });
  });

  it("streams ready and realtime Agent Events over WebSocket", async () => {
    const { app, emitEvent } = await createHarness();
    const messages: unknown[] = [];
    const socket = await app.injectWS(
      "/v1/projects/code-agent/events?afterSequence=0",
      { headers: { host: "127.0.0.1:3210", origin: "http://127.0.0.1:3210" } },
      {
        onInit(webSocket) {
          webSocket.on("message", (data: { toString(): string }) => {
            messages.push(JSON.parse(data.toString()) as unknown);
          });
        },
      },
    );

    await vi.waitFor(() => {
      expect(messages).toHaveLength(1);
    });
    emitEvent({
      itemId: "item-1",
      payload: { delta: "实时" },
      taskId: "task-1",
      turnId: "turn-1",
      type: "message.delta",
    });
    emitEvent({
      itemId: "item-1",
      payload: { delta: "更新" },
      taskId: "task-1",
      turnId: "turn-1",
      type: "message.delta",
    });
    await vi.waitFor(() => {
      expect(messages).toHaveLength(2);
    });

    expect(messages[0]).toMatchObject({
      latestSequence: 0,
      type: "connection.ready",
      version: 2,
    });
    expect(typeof (messages[0] as { sessionId: unknown }).sessionId).toBe("string");
    expect(messages[1]).toMatchObject({
      payload: { delta: "实时更新" },
      sequence: 1,
      type: "message.delta",
      version: 2,
    });
    expect(typeof (messages[1] as { sessionId: unknown }).sessionId).toBe("string");

    const metricsResponse = await app.inject({ method: "GET", url: "/v1/metrics/events" });
    expect(metricsResponse.statusCode).toBe(200);
    expect(metricsResponse.json()).toEqual({
      projects: [
        {
          activeClients: 1,
          backpressureSignals: 0,
          coalescedEvents: 1,
          pendingDeltas: 0,
          projectId: "code-agent",
          providerEventsReceived: 2,
          publishedEvents: 1,
          retainedEvents: 1,
          retentionEvictions: 0,
          slowClientDisconnects: 0,
        },
      ],
      version: 1,
    });
    socket.terminate();
  });

  it("replays retained events and requests resync after retention expires", async () => {
    const harness = createProvider();
    const app = await createCodeAgentServer(
      createServerOptions(harness.provider, { eventBufferSize: 1 }),
    );
    closeCallbacks.push(() => app.close());
    const event = {
      itemId: "item-1",
      payload: { delta: "1" },
      taskId: "task-1",
      turnId: "turn-1",
      type: "message.delta",
    } as const;
    harness.emitEvent(event);
    harness.emitEvent({ ...event, itemId: "item-2", payload: { delta: "2" } });

    const replayed: unknown[] = [];
    const replaySocket = await app.injectWS(
      "/v1/projects/code-agent/events?afterSequence=1",
      { headers: { host: "localhost", origin: "http://localhost" } },
      {
        onInit(webSocket) {
          webSocket.on("message", (data: { toString(): string }) => {
            replayed.push(JSON.parse(data.toString()) as unknown);
          });
        },
      },
    );
    await vi.waitFor(() => {
      expect(replayed).toHaveLength(2);
    });
    expect(replayed[1]).toMatchObject({ payload: { delta: "2" }, sequence: 2 });
    replaySocket.terminate();

    const expired: unknown[] = [];
    const expiredSocket = await app.injectWS(
      "/v1/projects/code-agent/events?afterSequence=0",
      { headers: { host: "localhost", origin: "http://localhost" } },
      {
        onInit(webSocket) {
          webSocket.on("message", (data: { toString(): string }) => {
            expired.push(JSON.parse(data.toString()) as unknown);
          });
        },
      },
    );
    await vi.waitFor(() => {
      expect(expired).toHaveLength(1);
    });
    expect(expired[0]).toMatchObject({
      latestSequence: 2,
      reason: "event_retention_exceeded",
      type: "resync.required",
    });
    await vi.waitFor(() => {
      expect(expiredSocket.readyState).toBe(expiredSocket.CLOSED);
    });
  });

  it("rejects invalid event queries and cross-origin WebSockets", async () => {
    const { app } = await createHarness();

    await expect(app.injectWS("/v1/projects/code-agent/events?afterSequence=-1")).rejects.toThrow(
      /Unexpected server response: 400/u,
    );
    await expect(
      app.injectWS("/v1/projects/code-agent/events?afterSequence=0", {
        headers: { host: "localhost", origin: "http://attacker.example" },
      }),
    ).rejects.toThrow(/Unexpected server response: 403/u);
  });

  it("unsubscribes from Provider events when Fastify closes", async () => {
    const { app, eventListeners } = await createHarness();
    await app.inject({ method: "GET", url: "/v1/projects/code-agent/tasks" });
    expect(eventListeners.size).toBe(1);

    await app.close();

    expect(eventListeners.size).toBe(0);
  });

  it("returns 404 for unknown projects and tasks", async () => {
    const { app, listTasks } = await createHarness();
    const projectResponse = await app.inject({
      method: "GET",
      url: "/v1/projects/other/tasks",
    });
    const taskResponse = await app.inject({
      method: "GET",
      url: "/v1/projects/code-agent/tasks/missing",
    });

    expect(projectResponse.statusCode).toBe(404);
    expect(taskResponse.statusCode).toBe(404);
    expect(listTasks).not.toHaveBeenCalled();
    expect(taskResponse.json()).toEqual({ code: "TASK_NOT_FOUND", message: "Task not found" });
  });

  it("rejects invalid pagination before calling the provider", async () => {
    const { app, listTasks } = await createHarness();
    const response = await app.inject({
      method: "GET",
      url: "/v1/projects/code-agent/tasks?limit=0",
    });

    expect(response.statusCode).toBe(400);
    expect(listTasks).not.toHaveBeenCalled();
  });

  it("serves static assets and falls back to index.html for SPA routes", async () => {
    const staticRoot = await mkdtemp(join(tmpdir(), "code-agent-web-"));
    await writeFile(join(staticRoot, "index.html"), "<main>CodeAgent Web</main>", "utf8");
    await writeFile(join(staticRoot, "app.js"), "export {};", "utf8");
    const app = await createCodeAgentServer(
      createServerOptions(createProvider().provider, { staticRoot }),
    );
    closeCallbacks.push(() => app.close());

    const routeResponse = await app.inject({ method: "GET", url: "/p/code-agent/t/task-1" });
    const assetResponse = await app.inject({ method: "GET", url: "/app.js" });
    const apiResponse = await app.inject({ method: "GET", url: "/v1/missing" });

    expect(routeResponse.statusCode).toBe(200);
    expect(routeResponse.body).toContain("CodeAgent Web");
    expect(assetResponse.body).toBe("export {};");
    expect(apiResponse.statusCode).toBe(404);
    expect(apiResponse.headers["content-type"]).toContain("application/json");
  });
});
