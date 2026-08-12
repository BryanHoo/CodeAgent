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
  AgentGlobalSettings,
  AgentModelPage,
  AgentProviderConnectionRecord,
  AgentProviderConnectionStatus,
  ConfigureCustomProviderResponse,
  AgentProjectDefaults,
  AgentTaskSettings,
  AgentTurn,
  PendingRequest,
  Project,
} from "@code-agent/protocol";
import { MAX_AGENT_IMAGE_BYTES } from "@code-agent/protocol";
import { Buffer } from "node:buffer";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createCodeAgentServer } from "./app.js";
import { AgentEventStream } from "./agent-event-stream.js";
import { GitBranchError } from "./git-branch.js";
import type { ProjectOpenService } from "./project-open.js";
import { normalizeAllowedHost } from "./server-delivery.js";

const project = {
  createdAt: "2026-07-23T00:00:00.000Z",
  id: "code-agent",
  name: "CodeAgent",
  rootPath: "/workspace/CodeAgent",
} as const;

const temporaryProject = {
  createdAt: "2026-08-06T00:00:00.000Z",
  id: "temporary",
  name: "Temporary",
  rootPath: "/code-agent/temporary-workspace",
} as const;

const pixelDataUrl =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const pastedTextDataUrl = "data:text/plain;base64,5L2g5aW9IENvZGVBZ2VudA==";
const historicalImageContent = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const turnOptions = {
  approvalPolicy: "on-request",
  approvalsReviewer: "user",
  model: "gpt-5.6-sol",
  reasoningEffort: "high",
  sandboxMode: "workspace-write",
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function multipartAttachment(
  kind: "file" | "image" | "text",
  name: string,
  mediaType: string,
  content: Uint8Array,
  idempotencyKey: string,
) {
  const form = new FormData();
  form.set("attachment", new File([content], name, { type: mediaType }));
  const request = new Request("http://code-agent.local", { body: form, method: "POST" });
  return {
    headers: {
      "content-type": request.headers.get("content-type") ?? "",
      "idempotency-key": idempotencyKey,
    },
    method: "POST" as const,
    payload: Buffer.from(await request.arrayBuffer()),
    url: `/v1/projects/code-agent/attachments/${kind}`,
  };
}

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
  plan: null,
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
      turns: {
        compact: true,
        interrupt: true,
        review: true,
        start: true,
        steer: true,
      },
    }),
  );
  const compactTask = vi.fn(() => Promise.resolve());
  const archiveTask = vi.fn(() => Promise.resolve());
  const forkTask = vi.fn(() => Promise.resolve({ ...task, id: "task-2", title: "续接任务" }));
  const listTasks = vi.fn(() => Promise.resolve({ data: [task], nextCursor: "next" }));
  const listModels = vi.fn(() => Promise.resolve(modelPage));
  const listMcpServers = vi.fn(() =>
    Promise.resolve({
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
    }),
  );
  const reloadMcpServers = vi.fn(() =>
    Promise.resolve({
      data: [
        {
          authStatus: null,
          description: null,
          error: null,
          failureReason: null,
          name: "fast-context",
          status: "starting" as const,
          title: null,
          toolCount: 0,
          version: null,
        },
      ],
    }),
  );
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
  const renameTask = vi.fn(() => Promise.resolve());
  const pinTask = vi.fn((taskId: string, pinned: boolean) =>
    Promise.resolve({ ...task, id: taskId, pinned }),
  );
  const startTask = vi.fn(() => Promise.resolve(task));
  const startTurn = vi.fn<AgentProvider["startTurn"]>(
    (taskId: string, input: AgentProviderTurnInput) =>
      Promise.resolve({
        completedAt: null,
        error: null,
        id: "turn-1",
        items: [
          { id: "input-1", role: "user" as const, text: input.text, type: "message" as const },
        ],
        startedAt: "2026-07-23T00:02:00.000Z",
        status: "running" as const,
      }),
  );
  const steerTurn = vi.fn<AgentProvider["steerTurn"]>(() => Promise.resolve());
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
    listMcpServers,
    listModels,
    listSkills,
    listTasks,
    pinTask,
    readSandboxMode,
    readTask,
    readTaskAttachment,
    reloadMcpServers,
    renameTask,
    resolvePendingRequest,
    startTask,
    startReview,
    startTurn,
    steerTurn,
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
    listMcpServers,
    listModels,
    listSkills,
    interruptTurn,
    listBackgroundTerminals,
    pinTask,
    provider,
    readSandboxMode,
    readTask,
    readTaskAttachment,
    reloadMcpServers,
    renameTask,
    resolvePendingRequest,
    startTask,
    startReview,
    startTurn,
    steerTurn,
    terminateBackgroundTerminal,
    unsubscribeTask,
    uploadFeedback,
  };
}

function createSettingsRepository() {
  let providerConnection: AgentProviderConnectionRecord | undefined;
  const readGlobalSettings = vi.fn(() =>
    Promise.resolve<AgentGlobalSettings | undefined>(undefined),
  );
  const readProjectDefaults = vi.fn(() =>
    Promise.resolve<AgentProjectDefaults | undefined>(undefined),
  );
  const readTaskSettings = vi.fn(() => Promise.resolve<AgentTaskSettings | undefined>(undefined));
  const writeProjectDefaults = vi.fn((_projectId: string, settings: AgentProjectDefaults) =>
    Promise.resolve(settings),
  );
  const writeGlobalSettings = vi.fn((_settings: AgentGlobalSettings) => Promise.resolve(_settings));
  const writeTaskSettings = vi.fn(
    (_projectId: string, _taskId: string, settings: AgentTaskSettings) => Promise.resolve(settings),
  );
  const readProviderConnection = vi.fn(() => Promise.resolve(providerConnection));
  const writeProviderConnection = vi.fn((record: AgentProviderConnectionRecord) => {
    providerConnection = record;
    return Promise.resolve(record);
  });
  return {
    readProviderConnection,
    readGlobalSettings,
    readProjectDefaults,
    readTaskSettings,
    repository: {
      readProviderConnection,
      readGlobalSettings,
      readProjectDefaults,
      readTaskSettings,
      writeGlobalSettings,
      writeProviderConnection,
      writeProjectDefaults,
      writeTaskSettings,
    },
    writeGlobalSettings,
    writeProviderConnection,
    writeProjectDefaults,
    writeTaskSettings,
  };
}

function createRuntimeConnectionMethods(): Pick<
  AgentRuntimeProvider,
  | "cancelProviderLogin"
  | "configureCustomProvider"
  | "logoutProvider"
  | "readProviderConnection"
  | "startOfficialProviderLogin"
> {
  const status: AgentProviderConnectionStatus = {
    account: null,
    customBaseUrl: null,
    mode: "official",
    pendingLogin: null,
    state: "disconnected",
  };
  return {
    cancelProviderLogin: vi.fn(() => Promise.resolve({ status })),
    configureCustomProvider: vi.fn(() => Promise.reject(new Error("Not configured"))),
    logoutProvider: vi.fn(() => Promise.resolve({ status })),
    readProviderConnection: vi.fn(() => Promise.resolve(status)),
    startOfficialProviderLogin: vi.fn(() => Promise.reject(new Error("Not configured"))),
  };
}

function createServerOptions(
  provider: AgentProvider,
  overrides: Record<string, unknown> = {},
  readDefaultSettings = vi.fn(() => Promise.resolve({})),
) {
  const orderedProjects: Project[] = [project];
  const runtimeProvider: AgentRuntimeProvider = {
    ...createRuntimeConnectionMethods(),
    forProject: () => provider,
    getCapabilities: () => provider.getCapabilities(),
    listModels: () => provider.listModels(),
    readDefaultSettings,
    releaseProject: () => Promise.resolve(),
  };
  const stateRepository = createSettingsRepository().repository;
  return {
    handlerTimeoutMs: 0,
    installAppUpdate: vi.fn(() => Promise.reject(new Error("No update available"))),
    loggerEnabled: false,
    projectRepository: {
      ensureTemporaryProject: vi.fn(() => Promise.resolve(temporaryProject)),
      list: vi.fn(() => Promise.resolve(orderedProjects)),
      read: vi.fn((projectId: string) =>
        Promise.resolve(
          projectId === project.id
            ? project
            : projectId === temporaryProject.id
              ? temporaryProject
              : undefined,
        ),
      ),
      register: vi.fn(() => Promise.resolve(project)),
      remove: vi.fn((projectId: string) => {
        const projectIndex = orderedProjects.findIndex((item) => item.id === projectId);
        if (projectIndex < 0) {
          return Promise.resolve(false);
        }
        orderedProjects.splice(projectIndex, 1);
        return Promise.resolve(true);
      }),
      rename: vi.fn((projectId: string, name: string) => {
        const projectIndex = orderedProjects.findIndex((item) => item.id === projectId);
        const currentProject = orderedProjects[projectIndex];
        if (currentProject === undefined) {
          return Promise.resolve(undefined);
        }
        const renamedProject = { ...currentProject, name };
        orderedProjects[projectIndex] = renamedProject;
        return Promise.resolve(renamedProject);
      }),
      reorder: vi.fn((projectIds: readonly string[]) => {
        const reordered = projectIds.map((projectId) =>
          orderedProjects.find((currentProject) => currentProject.id === projectId),
        );
        return Promise.resolve(reordered.filter((item) => item !== undefined));
      }),
    },
    providerConnectionRepository: stateRepository,
    provider: runtimeProvider,
    readAppInfo: vi.fn(() =>
      Promise.resolve({
        appVersion: "1.3.0",
        codexVersion: "0.147.0",
        latestVersion: "1.3.0",
        releaseNotes: null,
        status: "current" as const,
        updateAvailable: false,
      }),
    ),
    settingsRepository: stateRepository,
    ...overrides,
  };
}

async function createHarness(
  options: Readonly<{
    idempotencyCacheSize?: number;
    modelCatalogCacheMaxBytes?: number;
    modelCatalogCacheTtlMs?: number;
    projectOpenService?: ProjectOpenService;
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
    listMcpServers,
    listModels,
    listSkills,
    pinTask,
    provider,
    readTask,
    readTaskAttachment,
    reloadMcpServers,
    renameTask,
    resolvePendingRequest,
    startTask,
    startReview,
    startTurn,
    steerTurn,
    terminateBackgroundTerminal,
    unsubscribeTask,
    uploadFeedback,
  } = createProvider();
  const settings = createSettingsRepository();
  const readDefaultSettings = vi.fn(() => Promise.resolve({}));
  const app = await createCodeAgentServer(
    createServerOptions(
      provider,
      {
        ...options,
        settingsRepository: settings.repository,
      },
      readDefaultSettings,
    ),
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
    listMcpServers,
    listModels,
    listSkills,
    pinTask,
    readTask,
    readTaskAttachment,
    readDefaultSettings,
    reloadMcpServers,
    renameTask,
    resolvePendingRequest,
    startTask,
    startReview,
    startTurn,
    steerTurn,
    terminateBackgroundTerminal,
    unsubscribeTask,
    ...settings,
    uploadFeedback,
  };
}

describe("server diagnostics", () => {
  it("only emits redacted warning and error logs", async () => {
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
    const timeoutLog = logs.find((entry) => entry["statusCode"] === 503);
    expect(timeoutLog).toMatchObject({
      level: 50,
      method: "GET",
      msg: "request completed",
      statusCode: 503,
    });
    expect(typeof timeoutLog?.["durationMs"]).toBe("number");
    expect(typeof timeoutLog?.["requestId"]).toBe("string");
    expect(logs.every((entry) => Number(entry["level"]) >= 40)).toBe(true);
    expect(logs.some((entry) => entry["route"] === "/v1/health")).toBe(false);
    expect(logLines.join("\n")).not.toContain("secret-token");
    expect(logLines.join("\n")).not.toContain("secret-cookie");
    expect(logLines.join("\n")).not.toContain("secret-api-key");
  });
});

describe("CodeAgent Server", () => {
  it("switches provider modes without persisting the custom API key", async () => {
    const providerHarness = createProvider();
    const state = createSettingsRepository();
    const customModels: ConfigureCustomProviderResponse["models"] = {
      data: [
        {
          defaultReasoningEffort: "medium",
          description: "",
          displayName: "custom-model",
          id: "custom-model",
          isDefault: true,
          supportedReasoningEfforts: [{ description: "", id: "medium" }],
        },
      ],
      nextCursor: null,
    };
    const customStatus: AgentProviderConnectionStatus = {
      account: { type: "apiKey" as const },
      customBaseUrl: "https://api.example.com/v1",
      mode: "custom" as const,
      pendingLogin: null,
      state: "connected" as const,
    };
    const configureCustomProvider = vi.fn(() =>
      Promise.resolve({ models: customModels, status: customStatus }),
    );
    const cancelProviderLogin = vi.fn(() =>
      Promise.resolve({
        status: { ...customStatus, pendingLogin: null, state: "connected" as const },
      }),
    );
    const startOfficialProviderLogin = vi.fn(() =>
      Promise.resolve({
        authUrl: "https://auth.openai.com/authorize",
        loginId: "login-1",
        status: {
          account: null,
          customBaseUrl: null,
          mode: "official" as const,
          pendingLogin: { error: null, loginId: "login-1", state: "pending" as const },
          state: "pending" as const,
        },
      }),
    );
    const runtimeProvider: AgentRuntimeProvider = {
      ...createRuntimeConnectionMethods(),
      cancelProviderLogin,
      configureCustomProvider,
      forProject: () => providerHarness.provider,
      getCapabilities: () => providerHarness.provider.getCapabilities(),
      listModels: () => providerHarness.provider.listModels(),
      readDefaultSettings: () => Promise.resolve({}),
      readProviderConnection: vi.fn(() => Promise.resolve(customStatus)),
      releaseProject: () => Promise.resolve(),
      startOfficialProviderLogin,
    };
    const app = await createCodeAgentServer(
      createServerOptions(providerHarness.provider, {
        provider: runtimeProvider,
        providerConnectionRepository: state.repository,
        settingsRepository: state.repository,
      }),
    );
    closeCallbacks.push(() => app.close());

    const customResponse = await app.inject({
      headers: { "idempotency-key": "custom-provider" },
      method: "PUT",
      payload: { apiKey: "custom-secret", baseUrl: "https://api.example.com/v1" },
      url: "/v1/provider-connection/custom",
    });
    const modelsResponse = await app.inject({ method: "GET", url: "/v1/models" });
    configureCustomProvider.mockRejectedValueOnce(new Error("custom endpoint unavailable"));
    const failedCustomResponse = await app.inject({
      headers: { "idempotency-key": "failed-custom-provider" },
      method: "PUT",
      payload: { apiKey: "another-secret", baseUrl: "https://invalid.example.com/v1" },
      url: "/v1/provider-connection/custom",
    });
    const officialResponse = await app.inject({
      headers: { "idempotency-key": "official-login" },
      method: "POST",
      payload: {},
      url: "/v1/provider-connection/official-login",
    });
    const repeatedOfficialResponse = await app.inject({
      headers: { "idempotency-key": "official-login" },
      method: "POST",
      payload: {},
      url: "/v1/provider-connection/official-login",
    });
    const cancelResponse = await app.inject({
      headers: { "idempotency-key": "cancel-login" },
      method: "POST",
      payload: { loginId: "login-1" },
      url: "/v1/provider-connection/official-login/cancel",
    });

    expect(customResponse.statusCode, customResponse.body).toBe(200);
    expect(modelsResponse.json()).toEqual(customModels);
    expect(failedCustomResponse.statusCode).toBe(502);
    // 自定义失败不覆盖旧目录；第二次写入来自随后成功切换的官方模式。
    expect(state.writeProviderConnection).toHaveBeenCalledTimes(2);
    expect(configureCustomProvider).toHaveBeenCalledWith({
      apiKey: "custom-secret",
      baseUrl: "https://api.example.com/v1",
    });
    expect(JSON.stringify(state.writeProviderConnection.mock.calls)).not.toContain("custom-secret");
    expect(officialResponse.statusCode, officialResponse.body).toBe(200);
    expect(repeatedOfficialResponse.json()).toEqual(officialResponse.json());
    expect(cancelResponse.statusCode, cancelResponse.body).toBe(200);
    expect(startOfficialProviderLogin).toHaveBeenCalledOnce();
    expect(cancelProviderLogin).toHaveBeenCalledWith("login-1");
  });

  it("serves temporary conversations without exposing the internal Project", async () => {
    const providerHarness = createProvider();
    const temporaryTask = { ...task, projectId: temporaryProject.id, title: "临时任务" };
    const temporarySnapshot = { ...snapshot, ...temporaryTask };
    const startTemporaryTask = vi.fn(() => Promise.resolve(temporaryTask));
    const temporaryProvider: AgentProvider = {
      ...providerHarness.provider,
      listTasks: vi.fn(() => Promise.resolve({ data: [temporaryTask], nextCursor: null })),
      readTask: vi.fn(() => Promise.resolve(temporarySnapshot)),
      startTask: startTemporaryTask,
    };
    const settings = createSettingsRepository();
    const app = await createCodeAgentServer(
      createServerOptions(temporaryProvider, { settingsRepository: settings.repository }),
    );
    closeCallbacks.push(() => app.close());

    const listed = await app.inject({ method: "GET", url: "/v1/temporary/tasks?limit=25" });
    const created = await app.inject({
      headers: { "idempotency-key": "temporary-task" },
      method: "POST",
      payload: {},
      url: "/v1/temporary/tasks",
    });
    const turn = await app.inject({
      headers: { "idempotency-key": "temporary-turn" },
      method: "POST",
      payload: turnRequest("解释这段代码"),
      url: "/v1/temporary/tasks/task-1/turns",
    });
    const settingsUpdate = await app.inject({
      headers: { "idempotency-key": "temporary-settings" },
      method: "PUT",
      payload: turnOptions,
      url: "/v1/temporary/tasks/task-1/settings",
    });
    const internalProject = await app.inject({
      method: "GET",
      url: "/v1/projects/temporary/tasks",
    });
    const projectTool = await app.inject({ method: "GET", url: "/v1/temporary/git/status" });
    const skills = await app.inject({ method: "GET", url: "/v1/temporary/skills" });

    expect(listed.statusCode).toBe(200);
    expect(created.statusCode).toBe(201);
    expect(turn.statusCode).toBe(201);
    expect(settingsUpdate.statusCode).toBe(200);
    expect(internalProject.statusCode).toBe(404);
    expect(projectTool.statusCode).toBe(404);
    expect(skills.statusCode).toBe(200);
    expect(skills.json()).toMatchObject({ data: [{ name: "review-security" }] });
    expect(startTemporaryTask).toHaveBeenCalledWith();
    const temporaryTurnOptions = {
      ...turnOptions,
      sandboxMode: "danger-full-access",
    };
    expect(settingsUpdate.json()).toEqual({ settings: temporaryTurnOptions });
    expect(settings.writeTaskSettings).toHaveBeenNthCalledWith(
      1,
      temporaryProject.id,
      temporaryTask.id,
      temporaryTurnOptions,
    );
    expect(settings.writeTaskSettings).toHaveBeenLastCalledWith(
      temporaryProject.id,
      temporaryTask.id,
      temporaryTurnOptions,
    );
    expect(providerHarness.startTurn).toHaveBeenCalledWith(
      temporaryTask.id,
      expect.any(Object),
      temporaryTurnOptions,
    );
  });

  it("keeps local access open and protects LAN business routes", async () => {
    const local = await createCodeAgentServer(createServerOptions(createProvider().provider));
    closeCallbacks.push(() => local.close());
    const lan = await createCodeAgentServer(
      createServerOptions(createProvider().provider, {
        access: { pairingCode: "test-pairing-code", sessionTtlMs: 86_400_000 },
      }),
    );
    closeCallbacks.push(() => lan.close());

    const localStatus = await local.inject({ method: "GET", url: "/v1/access" });
    const lanStatus = await lan.inject({ method: "GET", url: "/v1/access" });
    const health = await lan.inject({ method: "GET", url: "/v1/health" });
    const protectedResponse = await lan.inject({ method: "GET", url: "/v1/projects" });

    expect(localStatus.json()).toEqual({ authenticated: true, mode: "local", version: 1 });
    expect(lanStatus.json()).toEqual({ authenticated: false, mode: "lan", version: 1 });
    expect(health.statusCode).toBe(200);
    expect(protectedResponse.statusCode).toBe(401);
    expect(protectedResponse.json()).toEqual({
      code: "ACCESS_DENIED",
      message: "Access denied",
      retryable: false,
    });
    expect(protectedResponse.headers["cache-control"]).toBe("no-store");
    expect(protectedResponse.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(protectedResponse.headers["content-security-policy"]).toContain(
      "style-src 'self' 'unsafe-inline'",
    );
    expect(protectedResponse.headers["content-security-policy"]).toContain(
      "img-src 'self' blob: data:",
    );
    expect(protectedResponse.headers["x-frame-options"]).toBe("DENY");
    expect(protectedResponse.headers["strict-transport-security"]).toBeUndefined();
  });

  it("rejects DNS rebinding hosts and cross-origin local browser mutations", async () => {
    const local = await createCodeAgentServer(createServerOptions(createProvider().provider));
    closeCallbacks.push(() => local.close());
    const lan = await createCodeAgentServer(
      createServerOptions(createProvider().provider, {
        access: { pairingCode: "test-pairing-code", sessionTtlMs: 86_400_000 },
      }),
    );
    closeCallbacks.push(() => lan.close());

    const reboundRead = await local.inject({
      headers: { host: "attacker.example:3210", origin: "http://attacker.example:3210" },
      method: "GET",
      url: "/v1/projects",
    });
    const crossOriginWrite = await local.inject({
      headers: { host: "127.0.0.1:3210", origin: "http://attacker.example:3210" },
      method: "POST",
      payload: {},
      url: "/v1/projects/code-agent/tasks/task-1/unsubscribe",
    });
    const reboundPair = await lan.inject({
      headers: { host: "attacker.example:3210", origin: "http://attacker.example:3210" },
      method: "POST",
      payload: { code: "test-pairing-code" },
      url: "/v1/access/pair",
    });

    expect(reboundRead.statusCode).toBe(403);
    expect(crossOriginWrite.statusCode).toBe(403);
    expect(reboundPair.statusCode).toBe(403);
    await expect(
      local.injectWS("/v1/projects/code-agent/events?afterSequence=0", {
        headers: { host: "attacker.example:3210", origin: "http://attacker.example:3210" },
      }),
    ).rejects.toThrow(/Unexpected server response: 403/u);
  });

  it("allows only explicitly configured reverse proxy domains", async () => {
    const app = await createCodeAgentServer(
      createServerOptions(createProvider().provider, {
        allowedHosts: [normalizeAllowedHost("Code.Example.com")],
      }),
    );
    closeCallbacks.push(() => app.close());

    const allowedRead = await app.inject({
      headers: { host: "code.example.com" },
      method: "GET",
      url: "/v1/projects",
    });
    const allowedWrite = await app.inject({
      headers: { host: "code.example.com", origin: "https://code.example.com" },
      method: "POST",
      url: "/v1/access/logout",
    });
    const unknownHost = await app.inject({
      headers: { host: "other.example.com" },
      method: "GET",
      url: "/v1/projects",
    });
    const subdomain = await app.inject({
      headers: { host: "child.code.example.com" },
      method: "GET",
      url: "/v1/projects",
    });

    expect(allowedRead.statusCode).toBe(200);
    expect(allowedWrite.statusCode).toBe(200);
    expect(unknownHost.statusCode).toBe(403);
    expect(subdomain.statusCode).toBe(403);
  });

  it("rejects non-domain allowed Host values", () => {
    for (const invalid of [
      "*.example.com",
      "https://code.example.com",
      "code.example.com:443",
      "127.0.0.1",
      "bad..example.com",
    ]) {
      expect(() => normalizeAllowedHost(invalid)).toThrow(/allowed Host/u);
    }
  });

  it("does not expose unknown server error details", async () => {
    const app = await createCodeAgentServer(
      createServerOptions(createProvider().provider, {
        readProjectDirectory: vi.fn(() =>
          Promise.reject(new Error("sensitive path /Users/example/private.txt")),
        ),
      }),
    );
    closeCallbacks.push(() => app.close());

    const response = await app.inject({ method: "GET", url: "/v1/project-directories" });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      code: "INTERNAL_ERROR",
      message: "Internal server error",
      retryable: false,
    });
    expect(response.body).not.toContain("/Users/example/private.txt");
  });

  it("pairs browsers, enforces origin, and logs out the exact session", async () => {
    const app = await createCodeAgentServer(
      createServerOptions(createProvider().provider, {
        access: { pairingCode: "test-pairing-code", sessionTtlMs: 86_400_000 },
      }),
    );
    closeCallbacks.push(() => app.close());

    const invalid = await app.inject({
      method: "POST",
      payload: { code: "" },
      url: "/v1/access/pair",
    });
    const failed = await app.inject({
      method: "POST",
      payload: { code: "wrong" },
      url: "/v1/access/pair",
    });
    const paired = await app.inject({
      method: "POST",
      payload: { code: "test-pairing-code" },
      url: "/v1/access/pair",
    });
    const cookie = paired.cookies[0];

    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ code: "INVALID_REQUEST", retryable: false });
    expect(failed.statusCode).toBe(403);
    expect(failed.json()).toMatchObject({ code: "PAIRING_FAILED", retryable: false });
    expect(paired.json()).toEqual({ authenticated: true, mode: "lan", version: 1 });
    expect(cookie).toMatchObject({ httpOnly: true, name: "codeagent_session", sameSite: "Strict" });
    expect(cookie?.secure).toBeUndefined();
    expect(cookie?.["path"]).toBe("/");
    expect(cookie?.maxAge).toBe(86_400);

    const authenticated = await app.inject({
      cookies: { codeagent_session: cookie?.value ?? "" },
      method: "GET",
      url: "/v1/projects",
    });
    const missingOrigin = await app.inject({
      cookies: { codeagent_session: cookie?.value ?? "" },
      method: "POST",
      payload: {},
      url: "/v1/access/logout",
    });
    const wrongOrigin = await app.inject({
      cookies: { codeagent_session: cookie?.value ?? "" },
      headers: { host: "192.168.1.20", origin: "http://attacker.local" },
      method: "POST",
      payload: {},
      url: "/v1/access/logout",
    });
    const loggedOut = await app.inject({
      cookies: { codeagent_session: cookie?.value ?? "" },
      headers: { host: "192.168.1.20", origin: "http://192.168.1.20" },
      method: "POST",
      payload: {},
      url: "/v1/access/logout",
    });
    const afterLogout = await app.inject({
      cookies: { codeagent_session: cookie?.value ?? "" },
      method: "GET",
      url: "/v1/projects",
    });

    expect(authenticated.statusCode).toBe(200);
    expect(missingOrigin.statusCode).toBe(403);
    expect(wrongOrigin.statusCode).toBe(403);
    expect(loggedOut.json()).toEqual({ authenticated: false, mode: "lan", version: 1 });
    expect(loggedOut.cookies[0]).toMatchObject({ name: "codeagent_session", value: "" });
    expect(afterLogout.statusCode).toBe(401);
  });

  it("uses a session Cookie without an expiry when no TTL is configured", async () => {
    const app = await createCodeAgentServer(
      createServerOptions(createProvider().provider, {
        access: { pairingCode: "test-pairing-code" },
      }),
    );
    closeCallbacks.push(() => app.close());

    const paired = await app.inject({
      method: "POST",
      payload: { code: "test-pairing-code" },
      url: "/v1/access/pair",
    });
    const cookie = paired.cookies[0];

    expect(paired.statusCode).toBe(200);
    expect(cookie?.expires).toBeUndefined();
    expect(cookie?.maxAge).toBeUndefined();
  });

  it("rejects unauthenticated and cross-origin LAN WebSockets", async () => {
    const app = await createCodeAgentServer(
      createServerOptions(createProvider().provider, {
        access: { pairingCode: "test-pairing-code", sessionTtlMs: 86_400_000 },
      }),
    );
    closeCallbacks.push(() => app.close());

    await expect(
      app.injectWS("/v1/projects/code-agent/events?afterSequence=0", {
        headers: { host: "192.168.1.20", origin: "http://192.168.1.20" },
      }),
    ).rejects.toThrow(/Unexpected server response: 401/u);
  });

  it("closes an authenticated LAN WebSocket at the absolute session expiry", async () => {
    const app = await createCodeAgentServer(
      createServerOptions(createProvider().provider, {
        access: { pairingCode: "test-pairing-code", sessionTtlMs: 50 },
      }),
    );
    closeCallbacks.push(() => app.close());
    const paired = await app.inject({
      method: "POST",
      payload: { code: "test-pairing-code" },
      url: "/v1/access/pair",
    });
    const cookie = paired.cookies[0];
    const socket = await app.injectWS("/v1/projects/code-agent/events?afterSequence=0", {
      headers: {
        cookie: `${cookie?.name ?? ""}=${cookie?.value ?? ""}`,
        host: "192.168.1.20",
        origin: "http://192.168.1.20",
      },
    });

    await vi.waitFor(() => {
      expect(socket.readyState).toBe(socket.CLOSED);
    });
  });

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
    const { app, listBackgroundTerminals, readTask, terminateBackgroundTerminal } =
      await createHarness();
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
    const repeatedListResponse = await app.inject({
      method: "GET",
      url: "/v1/projects/code-agent/tasks/task-1/background-terminals",
    });
    expect(readTask).not.toHaveBeenCalled();
    const terminateRequest = {
      headers: { "idempotency-key": "stop-terminal-1" },
      method: "POST" as const,
      payload: {},
      url: "/v1/projects/code-agent/tasks/task-1/background-terminals/terminal-1/terminate",
    };
    const firstTerminateResponse = await app.inject(terminateRequest);
    const repeatedTerminateResponse = await app.inject(terminateRequest);

    expect(listResponse.statusCode).toBe(200);
    expect(repeatedListResponse.statusCode).toBe(200);
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
    expect(listBackgroundTerminals).toHaveBeenCalledTimes(2);
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
      turns: {
        compact: true,
        interrupt: true,
        review: true,
        start: true,
        steer: true,
      },
    });
    expect(projectsResponse.json()).toEqual({ data: [project], nextCursor: null });
  });

  it("serves application versions and installs an update idempotently", async () => {
    const provider = createProvider().provider;
    const readAppInfo = vi.fn(() =>
      Promise.resolve({
        appVersion: "1.3.0",
        codexVersion: "0.147.0",
        latestVersion: "1.4.0",
        releaseNotes: "### 新增\n\n- 添加在线更新。",
        status: "available" as const,
        updateAvailable: true,
      }),
    );
    const installAppUpdate = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return {
        appVersion: "1.3.0",
        codexVersion: "0.147.0",
        latestVersion: "1.4.0",
        releaseNotes: null,
        status: "restart-required" as const,
        updateAvailable: false,
      };
    });
    const app = await createCodeAgentServer(
      createServerOptions(provider, { handlerTimeoutMs: 10, installAppUpdate, readAppInfo }),
    );
    closeCallbacks.push(() => app.close());

    const infoResponse = await app.inject({ method: "GET", url: "/v1/app-info" });
    const request = {
      headers: { "idempotency-key": "install-update-1" },
      method: "POST" as const,
      payload: { version: "1.4.0" },
      url: "/v1/app-update",
    };
    const firstResponse = await app.inject(request);
    const repeatedResponse = await app.inject(request);

    expect(infoResponse.statusCode).toBe(200);
    expect(infoResponse.json()).toEqual({
      appVersion: "1.3.0",
      codexVersion: "0.147.0",
      latestVersion: "1.4.0",
      releaseNotes: "### 新增\n\n- 添加在线更新。",
      status: "available",
      updateAvailable: true,
    });
    expect(firstResponse.statusCode).toBe(200);
    expect(repeatedResponse.json()).toEqual(firstResponse.json());
    expect(installAppUpdate).toHaveBeenCalledOnce();
    expect(installAppUpdate).toHaveBeenCalledWith("1.4.0");
  });

  it("opens only a registered project through a supported host app idempotently", async () => {
    const provider = createProvider().provider;
    const open = vi.fn(() => Promise.resolve());
    const app = await createCodeAgentServer(
      createServerOptions(provider, {
        projectOpenService: {
          getCapabilities: () =>
            Promise.resolve({
              apps: [
                { id: "zed" as const, kind: "editor" as const, name: "Zed" },
                { id: "finder" as const, kind: "file-manager" as const, name: "Finder" },
              ],
              platform: "darwin" as const,
            }),
          open,
        },
      }),
    );
    closeCallbacks.push(() => app.close());

    const capabilitiesResponse = await app.inject({
      method: "GET",
      url: "/v1/projects/code-agent/open-capabilities",
    });
    const request = {
      headers: { "idempotency-key": "open-project-key" },
      method: "POST" as const,
      payload: { appId: "zed", path: "src/components/app.tsx" },
      url: "/v1/projects/code-agent/open",
    };
    const firstResponse = await app.inject(request);
    const repeatedResponse = await app.inject(request);

    expect(capabilitiesResponse.json()).toEqual({
      apps: [
        { id: "zed", kind: "editor", name: "Zed" },
        { id: "finder", kind: "file-manager", name: "Finder" },
      ],
      platform: "darwin",
    });
    expect(firstResponse.statusCode).toBe(200);
    expect(firstResponse.json()).toEqual({ appId: "zed", path: "src/components/app.tsx" });
    expect(repeatedResponse.json()).toEqual({ appId: "zed", path: "src/components/app.tsx" });
    expect(open).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledWith("/workspace/CodeAgent", "zed", "src/components/app.tsx");
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

  it("browses host directories and adds the explicitly selected project", async () => {
    const { provider } = createProvider();
    const selectedPath = "/Users/bryan/Develop/CodeAgent";
    const selectedProject = { ...project, rootPath: selectedPath };
    const register = vi.fn(() => Promise.resolve(selectedProject));
    const readProjectDirectory = vi.fn(() =>
      Promise.resolve({
        entries: [{ name: "CodeAgent", path: selectedPath }],
        parentPath: "/Users/bryan",
        path: "/Users/bryan/Develop",
        roots: [],
      }),
    );
    const resolveProjectDirectory = vi.fn(() => Promise.resolve(selectedPath));
    const app = await createCodeAgentServer(
      createServerOptions(provider, {
        projectRepository: {
          list: () => Promise.resolve([]),
          read: () => Promise.resolve(undefined),
          register,
        },
        readProjectDirectory,
        resolveProjectDirectory,
      }),
    );
    closeCallbacks.push(() => app.close());

    const listing = await app.inject({
      method: "GET",
      url: "/v1/project-directories?path=%2FUsers%2Fbryan%2FDevelop",
    });
    const response = await app.inject({
      headers: { "idempotency-key": "add-project" },
      method: "POST",
      payload: { rootPath: selectedPath },
      url: "/v1/projects",
    });

    expect(listing.statusCode).toBe(200);
    expect(listing.json()).toMatchObject({ path: "/Users/bryan/Develop" });
    expect(readProjectDirectory).toHaveBeenCalledWith("/Users/bryan/Develop");
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ project: selectedProject });
    expect(resolveProjectDirectory).toHaveBeenCalledWith(selectedPath);
    expect(register).toHaveBeenCalledWith({ name: "CodeAgent", rootPath: selectedPath });
  });

  it("browses supported host files and imports a selected file idempotently", async () => {
    const { provider } = createProvider();
    const selectedPath = "/Users/bryan/Pictures/screen.png";
    const listing = {
      entries: [
        { name: "design", path: "/Users/bryan/Pictures/design", type: "directory" as const },
        { name: "screen.png", path: selectedPath, type: "file" as const },
      ],
      parentPath: "/Users/bryan",
      path: "/Users/bryan/Pictures",
      roots: [],
    };
    const readHostFileDirectory = vi.fn(() => Promise.resolve(listing));
    const resolveHostAttachment = vi.fn(() =>
      Promise.resolve({
        content: Readable.from(Buffer.from(pixelDataUrl.split(",")[1] ?? "", "base64")),
        kind: "image" as const,
        mediaType: "image/png" as const,
        name: "screen.png",
      }),
    );
    const app = await createCodeAgentServer(
      createServerOptions(provider, { readHostFileDirectory, resolveHostAttachment }),
    );
    closeCallbacks.push(() => app.close());

    const files = await app.inject({
      method: "GET",
      url: "/v1/host-files?kind=image&path=%2FUsers%2Fbryan%2FPictures",
    });
    const importRequest = {
      headers: { "idempotency-key": "import-host-image" },
      method: "POST" as const,
      payload: { path: selectedPath },
      url: "/v1/projects/code-agent/attachments/image/host",
    };
    const imported = await app.inject(importRequest);
    const repeated = await app.inject(importRequest);
    const importedBody: unknown = imported.json();
    const importedAttachment = isRecord(importedBody) ? importedBody["attachment"] : undefined;
    const importedAttachmentId =
      isRecord(importedAttachment) && typeof importedAttachment["id"] === "string"
        ? importedAttachment["id"]
        : undefined;
    if (importedAttachmentId === undefined) {
      throw new Error("Imported host attachment response is invalid");
    }
    const preview = await app.inject({
      method: "GET",
      url: `/v1/projects/code-agent/attachments/${encodeURIComponent(importedAttachmentId)}`,
    });
    const missingPreview = await app.inject({
      method: "GET",
      url: "/v1/projects/code-agent/attachments/missing",
    });
    const resolveCallsBeforeMissingProject = resolveHostAttachment.mock.calls.length;
    const missingProject = await app.inject({
      ...importRequest,
      headers: { "idempotency-key": "missing-project-host-image" },
      url: "/v1/projects/missing/attachments/image/host",
    });

    expect(files.statusCode).toBe(200);
    expect(files.json()).toEqual(listing);
    expect(readHostFileDirectory).toHaveBeenCalledWith("image", "/Users/bryan/Pictures");
    expect(imported.statusCode).toBe(201);
    expect(imported.json()).toMatchObject({
      attachment: { kind: "image", mediaType: "image/png", name: "screen.png", size: 68 },
    });
    expect(repeated.json()).toEqual(imported.json());
    expect(preview.statusCode).toBe(200);
    expect(preview.headers["content-type"]).toBe("image/png");
    expect(preview.headers["cache-control"]).toBe("no-store");
    expect(preview.rawPayload).toEqual(Buffer.from(pixelDataUrl.split(",")[1] ?? "", "base64"));
    expect(missingPreview.statusCode).toBe(404);
    expect(resolveHostAttachment).toHaveBeenCalledWith("image", selectedPath);
    expect(missingProject.statusCode).toBe(404);
    expect(resolveHostAttachment).toHaveBeenCalledTimes(resolveCallsBeforeMissingProject);
  });

  it("renames and removes only the registered project idempotently", async () => {
    const providerHarness = createProvider();
    let storedProject: Project | undefined = project;
    const read = vi.fn((projectId: string) =>
      Promise.resolve(storedProject?.id === projectId ? storedProject : undefined),
    );
    const rename = vi.fn((_projectId: string, name: string) => {
      storedProject = storedProject === undefined ? undefined : { ...storedProject, name };
      return Promise.resolve(storedProject);
    });
    const remove = vi.fn((projectId: string) => {
      if (storedProject?.id !== projectId) {
        return Promise.resolve(false);
      }
      storedProject = undefined;
      return Promise.resolve(true);
    });
    const app = await createCodeAgentServer(
      createServerOptions(providerHarness.provider, {
        projectRepository: {
          list: () => Promise.resolve(storedProject === undefined ? [] : [storedProject]),
          read,
          register: () => Promise.resolve(project),
          remove,
          rename,
          reorder: () => Promise.resolve(storedProject === undefined ? [] : [storedProject]),
        },
      }),
    );
    closeCallbacks.push(() => app.close());
    await app.inject({ method: "GET", url: "/v1/projects/code-agent/skills" });
    const readsAfterContextCreation = read.mock.calls.length;
    const cachedContextResponse = await app.inject({
      method: "GET",
      url: "/v1/projects/code-agent/tasks",
    });
    expect(providerHarness.eventListeners.size).toBe(1);
    expect(cachedContextResponse.statusCode).toBe(200);
    expect(read).toHaveBeenCalledTimes(readsAfterContextCreation);

    const renameRequest = {
      headers: { "idempotency-key": "rename-project-key" },
      method: "POST" as const,
      payload: { name: "  工作区别名  " },
      url: "/v1/projects/code-agent/rename",
    };
    const firstRenameResponse = await app.inject(renameRequest);
    const repeatedRenameResponse = await app.inject(renameRequest);
    const renamedContextResponse = await app.inject({
      method: "GET",
      url: "/v1/projects/code-agent/tasks",
    });
    expect(renamedContextResponse.statusCode).toBe(200);
    expect(read).toHaveBeenCalledTimes(readsAfterContextCreation);
    const invalidRenameResponse = await app.inject({
      ...renameRequest,
      headers: { "idempotency-key": "invalid-project-name" },
      payload: { name: "   " },
    });
    const removeRequest = {
      headers: { "idempotency-key": "remove-project-key" },
      method: "POST" as const,
      payload: {},
      url: "/v1/projects/code-agent/remove",
    };
    const firstRemoveResponse = await app.inject(removeRequest);
    const repeatedRemoveResponse = await app.inject(removeRequest);
    const missingRemoveResponse = await app.inject({
      ...removeRequest,
      headers: { "idempotency-key": "missing-project-key" },
    });
    const removedContextResponse = await app.inject({
      method: "GET",
      url: "/v1/projects/code-agent/tasks",
    });

    expect(firstRenameResponse.json()).toEqual({
      project: { ...project, name: "工作区别名" },
    });
    expect(repeatedRenameResponse.json()).toEqual(firstRenameResponse.json());
    expect(rename).toHaveBeenCalledOnce();
    expect(rename).toHaveBeenCalledWith(project.id, "工作区别名");
    expect(invalidRenameResponse.statusCode).toBe(400);
    expect(firstRemoveResponse.json()).toEqual({ projectId: project.id, status: "removed" });
    expect(repeatedRemoveResponse.json()).toEqual(firstRemoveResponse.json());
    // 成功请求只执行一次；第二次调用来自使用新 Key 的缺失资源验证。
    expect(remove).toHaveBeenCalledTimes(2);
    expect(providerHarness.eventListeners.size).toBe(0);
    expect(missingRemoveResponse.statusCode).toBe(404);
    expect(removedContextResponse.statusCode).toBe(404);
    expect(read).toHaveBeenCalledTimes(readsAfterContextCreation + 1);
  });

  it("releases runtime and uploaded attachment state when removing a project", async () => {
    const providerHarness = createProvider();
    let storedProject: Project | undefined = project;
    const releaseProject = vi.fn(() => Promise.resolve());
    const runtimeProvider: AgentRuntimeProvider = {
      ...createRuntimeConnectionMethods(),
      forProject: () => providerHarness.provider,
      getCapabilities: () => providerHarness.provider.getCapabilities(),
      listModels: () => providerHarness.provider.listModels(),
      readDefaultSettings: () => Promise.resolve({}),
      releaseProject,
    };
    const app = await createCodeAgentServer(
      createServerOptions(providerHarness.provider, {
        projectRepository: {
          list: () => Promise.resolve(storedProject === undefined ? [] : [storedProject]),
          read: (projectId: string) =>
            Promise.resolve(storedProject?.id === projectId ? storedProject : undefined),
          register: () => Promise.resolve(project),
          remove: (projectId: string) => {
            if (storedProject?.id !== projectId) {
              return Promise.resolve(false);
            }
            storedProject = undefined;
            return Promise.resolve(true);
          },
          rename: () => Promise.resolve(undefined),
          reorder: () => Promise.resolve(storedProject === undefined ? [] : [storedProject]),
        },
        provider: runtimeProvider,
      }),
    );
    closeCallbacks.push(() => app.close());
    const upload = await app.inject(
      await multipartAttachment(
        "image",
        "screen.png",
        "image/png",
        Buffer.from(pixelDataUrl.split(",")[1] ?? "", "base64"),
        "release-project-upload",
      ),
    );
    const attachmentId = upload.json<{ attachment: { id: string } }>().attachment.id;

    const removed = await app.inject({
      headers: { "idempotency-key": "release-project" },
      method: "POST",
      payload: {},
      url: "/v1/projects/code-agent/remove",
    });
    storedProject = project;
    const reuse = await app.inject({
      headers: { "idempotency-key": "reuse-released-attachment" },
      method: "POST",
      payload: {
        input: { attachments: [{ id: attachmentId }], skills: [], text: "", type: "prompt" },
        options: turnOptions,
      },
      url: "/v1/projects/code-agent/tasks/task-1/turns",
    });

    expect(removed.statusCode).toBe(200);
    expect(releaseProject).toHaveBeenCalledOnce();
    expect(releaseProject).toHaveBeenCalledWith(project.id);
    expect(reuse.statusCode).toBe(404);
    expect(reuse.json()).toMatchObject({ code: "ATTACHMENT_NOT_FOUND" });
    expect(providerHarness.startTurn).not.toHaveBeenCalled();
  });

  it("serves the configured project's Git working tree status", async () => {
    const { provider } = createProvider();
    const readProjectGitStatus = vi.fn(() =>
      Promise.resolve({
        baseBranches: ["origin/main", "main"],
        branch: "feat/review",
        branches: ["feat/review", "main"],
        repositoryMode: "root" as const,
        snapshot: "c".repeat(64),
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
      url: "/v1/projects/code-agent/git/status?repository=frontend",
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
    expect(readProjectGitStatus).toHaveBeenCalledWith(project.rootPath, {
      repository: "frontend",
    });
    expect(missingProjectResponse.statusCode).toBe(404);
    expect(readProjectGitStatus).toHaveBeenCalledTimes(1);
  });

  it("serves paginated Git history for the selected repository tab", async () => {
    const { provider } = createProvider();
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
      repository: "packages/server",
      repositoryMode: "children" as const,
    };
    const readProjectGitHistory = vi.fn(() => Promise.resolve(historyPage));
    const app = await createCodeAgentServer(
      createServerOptions(provider, { readProjectGitHistory }),
    );
    closeCallbacks.push(() => app.close());

    const response = await app.inject({
      method: "GET",
      url: "/v1/projects/code-agent/git/history?repository=packages%2Fserver&cursor=20",
    });
    const missingProjectResponse = await app.inject({
      method: "GET",
      url: "/v1/projects/other/git/history",
    });
    const invalidQueryResponse = await app.inject({
      method: "GET",
      url: "/v1/projects/code-agent/git/history?cursor=sha",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(historyPage);
    expect(readProjectGitHistory).toHaveBeenCalledWith(project.rootPath, {
      cursor: "20",
      repository: "packages/server",
    });
    expect(missingProjectResponse.statusCode).toBe(404);
    expect(invalidQueryResponse.statusCode).toBe(400);
    expect(readProjectGitHistory).toHaveBeenCalledTimes(1);
  });

  it("serves bounded commit files and a selected file diff", async () => {
    const { provider } = createProvider();
    const readProjectGitCommitFiles = vi.fn(() =>
      Promise.resolve({
        files: [{ kind: "update" as const, path: "src/index.ts" }],
        nextCursor: "100",
      }),
    );
    const readProjectGitCommitFileDiff = vi.fn(() =>
      Promise.resolve({ diff: "@@ -1 +1 @@\n-old\n+new\n", truncated: false }),
    );
    const app = await createCodeAgentServer(
      createServerOptions(provider, {
        readProjectGitCommitFileDiff,
        readProjectGitCommitFiles,
      }),
    );
    closeCallbacks.push(() => app.close());
    const sha = "a".repeat(40);

    const filesResponse = await app.inject({
      method: "GET",
      url: `/v1/projects/code-agent/git/commit-files?sha=${sha}&repository=packages%2Fserver&cursor=100`,
    });
    const diffResponse = await app.inject({
      method: "GET",
      url: `/v1/projects/code-agent/git/commit-diff?sha=${sha}&path=src%2Findex.ts&repository=packages%2Fserver`,
    });
    const invalidResponse = await app.inject({
      method: "GET",
      url: "/v1/projects/code-agent/git/commit-files?sha=HEAD",
    });
    const missingProjectResponse = await app.inject({
      method: "GET",
      url: `/v1/projects/missing/git/commit-files?sha=${sha}`,
    });

    expect(filesResponse.statusCode).toBe(200);
    expect(filesResponse.json()).toEqual({
      files: [{ kind: "update", path: "src/index.ts" }],
      nextCursor: "100",
    });
    expect(diffResponse.statusCode).toBe(200);
    expect(diffResponse.json()).toMatchObject({ truncated: false });
    expect(invalidResponse.statusCode).toBe(400);
    expect(missingProjectResponse.statusCode).toBe(404);
    expect(readProjectGitCommitFiles).toHaveBeenCalledWith(project.rootPath, {
      cursor: "100",
      repository: "packages/server",
      sha,
    });
    expect(readProjectGitCommitFileDiff).toHaveBeenCalledWith(project.rootPath, {
      path: "src/index.ts",
      repository: "packages/server",
      sha,
    });
  });

  it("switches a local project branch idempotently through the fixed Git mutation", async () => {
    const { provider } = createProvider();
    const expectedSnapshot = "c".repeat(64);
    const switchedStatus = {
      baseBranches: ["origin/main", "feat/review"],
      branch: "main",
      branches: ["main", "feat/review"],
      repositoryMode: "root" as const,
      snapshot: "d".repeat(64),
      staged: [],
      unstaged: [],
    };
    const switchProjectBranch = vi.fn(() => Promise.resolve(switchedStatus));
    const app = await createCodeAgentServer(createServerOptions(provider, { switchProjectBranch }));
    closeCallbacks.push(() => app.close());
    const request = { branch: "main", expectedSnapshot };

    const first = await app.inject({
      headers: { "idempotency-key": "switch-main" },
      method: "POST",
      payload: request,
      url: "/v1/projects/code-agent/git/branch",
    });
    const repeated = await app.inject({
      headers: { "idempotency-key": "switch-main" },
      method: "POST",
      payload: request,
      url: "/v1/projects/code-agent/git/branch",
    });
    const invalid = await app.inject({
      headers: { "idempotency-key": "switch-invalid" },
      method: "POST",
      payload: { ...request, branch: "" },
      url: "/v1/projects/code-agent/git/branch",
    });

    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual(switchedStatus);
    expect(repeated.json()).toEqual(switchedStatus);
    expect(invalid.statusCode).toBe(400);
    expect(switchProjectBranch).toHaveBeenCalledOnce();
    expect(switchProjectBranch).toHaveBeenCalledWith(project.rootPath, request);
  });

  it("maps branch-switch conflicts and command failures to bounded mutation errors", async () => {
    const { provider } = createProvider();
    const switchProjectBranch = vi
      .fn()
      .mockRejectedValueOnce(
        new GitBranchError("SNAPSHOT_MISMATCH", "Git working tree snapshot changed"),
      )
      .mockRejectedValueOnce(new GitBranchError("SWITCH_FAILED", "Git branch switch failed"));
    const app = await createCodeAgentServer(createServerOptions(provider, { switchProjectBranch }));
    closeCallbacks.push(() => app.close());

    const stale = await app.inject({
      headers: { "idempotency-key": "switch-stale" },
      method: "POST",
      payload: { branch: "main", expectedSnapshot: "a".repeat(64) },
      url: "/v1/projects/code-agent/git/branch",
    });
    const failed = await app.inject({
      headers: { "idempotency-key": "switch-failed" },
      method: "POST",
      payload: { branch: "main", expectedSnapshot: "b".repeat(64) },
      url: "/v1/projects/code-agent/git/branch",
    });

    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ code: "GIT_STATUS_CHANGED" });
    expect(failed.statusCode).toBe(502);
    expect(failed.json()).toEqual({
      code: "GIT_BRANCH_SWITCH_FAILED",
      message: "Git branch switch failed",
      retryable: true,
    });
  });

  it("creates and switches to a local branch idempotently", async () => {
    const { provider } = createProvider();
    const expectedSnapshot = "a".repeat(64);
    const createdStatus = {
      baseBranches: ["origin/main", "main"],
      branch: "feat/new-branch",
      branches: ["feat/new-branch", "main"],
      repositoryMode: "root" as const,
      snapshot: "b".repeat(64),
      staged: [],
      unstaged: [],
    };
    const createProjectBranch = vi.fn(() => Promise.resolve(createdStatus));
    const app = await createCodeAgentServer(createServerOptions(provider, { createProjectBranch }));
    closeCallbacks.push(() => app.close());
    const request = { branch: "feat/new-branch", expectedSnapshot };

    const first = await app.inject({
      headers: { "idempotency-key": "create-new-branch" },
      method: "POST",
      payload: request,
      url: "/v1/projects/code-agent/git/branches",
    });
    const repeated = await app.inject({
      headers: { "idempotency-key": "create-new-branch" },
      method: "POST",
      payload: request,
      url: "/v1/projects/code-agent/git/branches",
    });

    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual(createdStatus);
    expect(repeated.json()).toEqual(createdStatus);
    expect(createProjectBranch).toHaveBeenCalledOnce();
    expect(createProjectBranch).toHaveBeenCalledWith(project.rootPath, request);
  });

  it("generates a selected-file commit message through an ephemeral read-only turn", async () => {
    const providerHarness = createProvider();
    const settings = createSettingsRepository();
    providerHarness.listModels.mockResolvedValue({
      data: [
        ...modelPage.data,
        {
          defaultReasoningEffort: "medium",
          description: "适合日常任务",
          displayName: "GPT-5.6 Terra",
          id: "gpt-5.6-terra",
          isDefault: false,
          supportedReasoningEfforts: [
            { description: "低", id: "low" },
            { description: "中", id: "medium" },
          ],
        },
      ],
      nextCursor: null,
    });
    settings.readGlobalSettings.mockResolvedValue({
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      commitMessageModel: "gpt-5.6-terra",
      commitMessagePrompt: "优先说明行为变化，不要罗列文件名。",
      commitMessageReasoningEffort: "low",
      defaultOpenAppId: null,
      followUpBehavior: "queue",
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      sandboxMode: "workspace-write",
    });
    const snapshot = "a".repeat(64);
    const readProjectGitStatus = vi.fn(() =>
      Promise.resolve({
        baseBranches: ["main"],
        branch: "feat/commit",
        branches: ["feat/commit", "main"],
        repositoryMode: "root" as const,
        snapshot,
        staged: [],
        unstaged: [
          {
            diff: "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new",
            kind: "update" as const,
            path: "src/app.ts",
          },
        ],
      }),
    );
    const app = await createCodeAgentServer(
      createServerOptions(providerHarness.provider, {
        readProjectGitStatus,
        settingsRepository: settings.repository,
      }),
    );
    closeCallbacks.push(() => app.close());

    const responsePromise = app.inject({
      headers: { "idempotency-key": "generate-message" },
      method: "POST",
      payload: {
        expectedSnapshot: snapshot,
        paths: ["src/app.ts"],
        repository: "frontend",
      },
      url: "/v1/projects/code-agent/git/commit-message",
    });
    await vi.waitFor(() => {
      expect(providerHarness.startTurn).toHaveBeenCalledOnce();
    });
    providerHarness.emitEvent({
      itemId: "message-1",
      payload: {
        item: {
          id: "message-1",
          role: "assistant",
          text: JSON.stringify({ message: "feat(git): 生成提交信息" }),
          type: "message",
        },
      },
      taskId: "task-1",
      turnId: "turn-1",
      type: "item.completed",
    });
    providerHarness.emitEvent({
      payload: {
        turn: {
          completedAt: "2026-08-01T00:00:01.000Z",
          error: null,
          id: "turn-1",
          items: [],
          startedAt: "2026-08-01T00:00:00.000Z",
          status: "completed",
        },
      },
      taskId: "task-1",
      turnId: "turn-1",
      type: "turn.completed",
    });
    const response = await responsePromise;

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ message: "feat(git): 生成提交信息", snapshot });
    expect(readProjectGitStatus).toHaveBeenCalledWith(project.rootPath, {
      repository: "frontend",
    });
    expect(providerHarness.startTask).toHaveBeenCalledWith({ ephemeral: true });
    const startTurnCall = providerHarness.startTurn.mock.calls[0];
    expect(startTurnCall?.[0]).toBe("task-1");
    expect(startTurnCall?.[1].outputSchema).toMatchObject({ type: "object" });
    expect(startTurnCall?.[1].text).toContain(
      "Generate the commit message only from the exact Git diff in this prompt. Do not read files or run commands.",
    );
    expect(startTurnCall?.[1].text).toContain("Current branch: feat/commit");
    expect(startTurnCall?.[1].text).toContain(
      "<selected-diff>\n\n[unstaged] src/app.ts\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new\n\n</selected-diff>",
    );
    expect(startTurnCall?.[1].text).toContain(
      "<user-preferences>\n优先说明行为变化，不要罗列文件名。\n</user-preferences>",
    );
    expect(startTurnCall?.[1].text).toContain(
      "The following user preferences define the commit message format and language.",
    );
    expect(startTurnCall?.[1].text).not.toContain("Conventional Commits");
    expect(startTurnCall?.[1].text).not.toContain("简体中文");
    expect(startTurnCall?.[1].text).not.toContain("scope 必填");
    expect(startTurnCall?.[2]).toMatchObject({
      approvalPolicy: "never",
      approvalsReviewer: "user",
      model: "gpt-5.6-terra",
      reasoningEffort: "low",
      sandboxMode: "read-only",
    });
    expect(providerHarness.archiveTask).not.toHaveBeenCalled();
    expect(providerHarness.unsubscribeTask).toHaveBeenCalledWith("task-1");
  });

  it("rejects stale commit-message snapshots before starting Codex", async () => {
    const providerHarness = createProvider();
    const readProjectGitStatus = vi.fn(() =>
      Promise.resolve({
        baseBranches: ["main"],
        branch: "feat/commit",
        branches: ["feat/commit", "main"],
        repositoryMode: "root" as const,
        snapshot: "d".repeat(64),
        staged: [],
        unstaged: [{ diff: "+new", kind: "update" as const, path: "src/app.ts" }],
      }),
    );
    const app = await createCodeAgentServer(
      createServerOptions(providerHarness.provider, { readProjectGitStatus }),
    );
    closeCallbacks.push(() => app.close());

    const response = await app.inject({
      headers: { "idempotency-key": "stale-message" },
      method: "POST",
      payload: { expectedSnapshot: "e".repeat(64), paths: ["src/app.ts"] },
      url: "/v1/projects/code-agent/git/commit-message",
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "GIT_STATUS_CHANGED" });
    expect(providerHarness.startTask).not.toHaveBeenCalled();
  });

  it("uses bounded change summaries and diff excerpts for oversized commit-message input", async () => {
    const providerHarness = createProvider();
    const snapshot = "f".repeat(64);
    const oversizedChanges = Array.from({ length: 120 }, (_, index) => {
      const path = `src/file-${String(index).padStart(3, "0")}.ts`;
      return {
        diff: [
          `diff --git a/${path} b/${path}`,
          `--- a/${path}`,
          `+++ b/${path}`,
          "@@ -1 +1 @@",
          `-old behavior ${String(index)}`,
          `+new behavior ${String(index)}`,
          `+${index === 0 ? "x".repeat(70_000) : "x".repeat(600)}`,
          ...(index === 0 ? ["+END_OF_LARGE_DIFF"] : []),
        ].join("\n"),
        kind: "update" as const,
        path,
      };
    });
    const readProjectGitStatus = vi.fn(() =>
      Promise.resolve({
        baseBranches: ["main"],
        branch: "feat/commit",
        branches: ["feat/commit", "main"],
        repositoryMode: "root" as const,
        snapshot,
        staged: [],
        unstaged: oversizedChanges,
      }),
    );
    const app = await createCodeAgentServer(
      createServerOptions(providerHarness.provider, { readProjectGitStatus }),
    );
    closeCallbacks.push(() => app.close());

    const responsePromise = app.inject({
      headers: { "idempotency-key": "failed-message" },
      method: "POST",
      payload: { expectedSnapshot: snapshot, paths: oversizedChanges.map((change) => change.path) },
      url: "/v1/projects/code-agent/git/commit-message",
    });
    await vi.waitFor(() => {
      expect(providerHarness.startTurn).toHaveBeenCalledOnce();
    });
    const prompt = providerHarness.startTurn.mock.calls[0]?.[1].text;
    expect(prompt).toContain(
      "Generate the commit message only from the following change summary and representative diff excerpts.",
    );
    expect(prompt).toContain("Do not read files or run commands.");
    expect(prompt).toContain("[unstaged] update src/file-000.ts (+3 -1");
    expect(prompt).toContain("[unstaged] update src/file-119.ts (+2 -1");
    expect(prompt).toContain("<selected-diff-excerpts>");
    expect(prompt).toContain("+new behavior 0");
    expect(prompt).toContain("+new behavior 119");
    expect(prompt).toContain("END_OF_LARGE_DIFF");
    expect(prompt).not.toContain("<selected-diff>");
    expect(prompt).not.toMatch(/[\u3400-\u9fff]/u);
    expect(Buffer.byteLength(prompt ?? "", "utf8")).toBeLessThanOrEqual(70 * 1_024);
    providerHarness.emitEvent({
      payload: { message: "model failed", willRetry: false },
      taskId: "task-1",
      turnId: "turn-1",
      type: "provider.error",
    });
    const response = await responsePromise;

    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({ code: "COMMIT_MESSAGE_GENERATION_FAILED" });
    expect(providerHarness.interruptTurn).toHaveBeenCalledWith("task-1", "turn-1");
    expect(providerHarness.archiveTask).not.toHaveBeenCalled();
    expect(providerHarness.unsubscribeTask).toHaveBeenCalledWith("task-1");
  });

  it("commits selected files idempotently and preserves push partial success", async () => {
    const { provider } = createProvider();
    const snapshot = "b".repeat(64);
    const commitProjectChanges = vi.fn(() =>
      Promise.resolve({
        branch: "feat/commit",
        commitSha: "0123456789abcdef0123456789abcdef01234567",
        message: "feat(git): 提交选择文件",
        pushStatus: "failed" as const,
      }),
    );
    const app = await createCodeAgentServer(
      createServerOptions(provider, { commitProjectChanges }),
    );
    closeCallbacks.push(() => app.close());
    const request = {
      action: "commit_and_push",
      expectedSnapshot: snapshot,
      message: "feat(git): 提交选择文件",
      paths: ["src/app.ts"],
    } as const;

    const first = await app.inject({
      headers: { "idempotency-key": "commit-selected" },
      method: "POST",
      payload: request,
      url: "/v1/projects/code-agent/git/commits",
    });
    const repeated = await app.inject({
      headers: { "idempotency-key": "commit-selected" },
      method: "POST",
      payload: request,
      url: "/v1/projects/code-agent/git/commits",
    });

    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ pushStatus: "failed" });
    expect(repeated.json()).toEqual(first.json());
    expect(commitProjectChanges).toHaveBeenCalledOnce();
    expect(commitProjectChanges).toHaveBeenCalledWith(project.rootPath, request);
  });

  it("rejects concurrent Git mutations for the same project", async () => {
    const { provider } = createProvider();
    let resolveCommit!: (result: {
      branch: string;
      commitSha: string;
      message: string;
      pushStatus: "not_requested";
    }) => void;
    const commitProjectChanges = vi.fn(
      () =>
        new Promise<{
          branch: string;
          commitSha: string;
          message: string;
          pushStatus: "not_requested";
        }>((resolve) => {
          resolveCommit = resolve;
        }),
    );
    const app = await createCodeAgentServer(
      createServerOptions(provider, { commitProjectChanges }),
    );
    closeCallbacks.push(() => app.close());
    const payload = {
      action: "commit",
      expectedSnapshot: "1".repeat(64),
      message: "feat(git): 提交选择文件",
      paths: ["src/app.ts"],
    } as const;

    const firstResponse = app.inject({
      headers: { "idempotency-key": "first-commit" },
      method: "POST",
      payload,
      url: "/v1/projects/code-agent/git/commits",
    });
    await vi.waitFor(() => {
      expect(commitProjectChanges).toHaveBeenCalledOnce();
    });
    const concurrentResponse = await app.inject({
      headers: { "idempotency-key": "concurrent-commit" },
      method: "POST",
      payload,
      url: "/v1/projects/code-agent/git/commits",
    });
    resolveCommit({
      branch: "feat/commit",
      commitSha: "0123456789abcdef0123456789abcdef01234567",
      message: payload.message,
      pushStatus: "not_requested",
    });

    expect(concurrentResponse.statusCode).toBe(409);
    expect(concurrentResponse.json()).toMatchObject({ code: "GIT_MUTATION_IN_PROGRESS" });
    expect((await firstResponse).statusCode).toBe(201);
    expect(commitProjectChanges).toHaveBeenCalledOnce();
  });

  it("serves paginated local source previews for the configured project", async () => {
    const { provider } = createProvider();
    const readProjectSourceFile = vi.fn((_projectRoot: string, _path: string, cursor = 0) =>
      Promise.resolve(
        cursor === 0
          ? {
              content: "### 11.7 认证\n",
              nextCursor: 24,
              path: "/home/test/reports/architecture-design.md",
            }
          : {
              content: "后续内容\n",
              nextCursor: null,
              path: "/home/test/reports/architecture-design.md",
            },
      ),
    );
    const app = await createCodeAgentServer(
      createServerOptions(provider, { readProjectSourceFile }),
    );
    closeCallbacks.push(() => app.close());

    const response = await app.inject({
      method: "GET",
      url: "/v1/projects/code-agent/files/source?path=%2Fhome%2Ftest%2Freports%2Farchitecture-design.md",
    });
    const missingProjectResponse = await app.inject({
      method: "GET",
      url: "/v1/projects/other/files/source?path=docs%2Farchitecture-design.md",
    });
    const nextPageResponse = await app.inject({
      method: "GET",
      url: "/v1/projects/code-agent/files/source?cursor=24&path=%2Fhome%2Ftest%2Freports%2Farchitecture-design.md",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      content: "### 11.7 认证\n",
      nextCursor: 24,
      path: "/home/test/reports/architecture-design.md",
    });
    expect(readProjectSourceFile).toHaveBeenCalledWith(
      project.rootPath,
      "/home/test/reports/architecture-design.md",
      0,
    );
    expect(missingProjectResponse.statusCode).toBe(404);
    expect(nextPageResponse.statusCode).toBe(200);
    expect(nextPageResponse.json()).toEqual({
      content: "后续内容\n",
      nextCursor: null,
      path: "/home/test/reports/architecture-design.md",
    });
    expect(readProjectSourceFile).toHaveBeenLastCalledWith(
      project.rootPath,
      "/home/test/reports/architecture-design.md",
      24,
    );
    expect(readProjectSourceFile).toHaveBeenCalledTimes(2);
  });

  it("serves verified Project image previews without MIME sniffing", async () => {
    const { provider } = createProvider();
    const imageContent = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const readProjectImageFile = vi.fn(() =>
      Promise.resolve({
        content: imageContent,
        mediaType: "image/png" as const,
        path: "design/result.png",
      }),
    );
    const app = await createCodeAgentServer(
      createServerOptions(provider, { readProjectImageFile }),
    );
    closeCallbacks.push(() => app.close());

    const response = await app.inject({
      method: "GET",
      url: "/v1/projects/code-agent/files/image?path=%2Fworkspace%2FCodeAgent%2Fdesign%2Fresult.png",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("image/png");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.rawPayload).toEqual(imageContent);
    expect(readProjectImageFile).toHaveBeenCalledWith(
      project.rootPath,
      "/workspace/CodeAgent/design/result.png",
    );
  });

  it("serves one file tree directory only for the configured project", async () => {
    const { provider } = createProvider();
    const readProjectFileTree = vi.fn(() =>
      Promise.resolve({
        entries: [{ path: "src/main.tsx", type: "file" as const }],
        path: "src",
      }),
    );
    const app = await createCodeAgentServer(createServerOptions(provider, { readProjectFileTree }));
    closeCallbacks.push(() => app.close());

    const response = await app.inject({
      method: "GET",
      url: "/v1/projects/code-agent/files/tree?path=src",
    });
    const missingProjectResponse = await app.inject({
      method: "GET",
      url: "/v1/projects/other/files/tree",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      entries: [{ path: "src/main.tsx", type: "file" }],
      path: "src",
    });
    expect(readProjectFileTree).toHaveBeenCalledWith(project.rootPath, "src");
    expect(missingProjectResponse.statusCode).toBe(404);
    expect(readProjectFileTree).toHaveBeenCalledTimes(1);
  });

  it("searches project files for path text references", async () => {
    const { provider } = createProvider();
    const readProjectFileSearch = vi.fn(() =>
      Promise.resolve({ data: [{ name: "main.tsx", path: "src/main.tsx" }] }),
    );
    const app = await createCodeAgentServer(
      createServerOptions(provider, { readProjectFileSearch }),
    );
    closeCallbacks.push(() => app.close());

    const search = await app.inject({
      method: "GET",
      url: "/v1/projects/code-agent/files/search?query=main",
    });
    expect(search.statusCode).toBe(200);
    expect(search.json()).toEqual({ data: [{ name: "main.tsx", path: "src/main.tsx" }] });
    expect(readProjectFileSearch.mock.calls[0]?.slice(0, 2)).toEqual([project.rootPath, "main"]);
  });

  it("serves models and resolves uploaded attachments before starting a turn", async () => {
    const {
      app,
      listMcpServers,
      listModels,
      listSkills,
      reloadMcpServers,
      startTurn,
      writeTaskSettings,
    } = await createHarness();
    const models = await app.inject({ method: "GET", url: "/v1/models" });
    const mcpServers = await app.inject({
      method: "GET",
      url: "/v1/projects/code-agent/tasks/task-1/mcp-servers",
    });
    const reloadedMcpServers = await app.inject({
      headers: { "idempotency-key": "reload-task-mcp" },
      method: "POST",
      payload: {},
      url: "/v1/projects/code-agent/tasks/task-1/mcp-servers/retry",
    });
    const skills = await app.inject({ method: "GET", url: "/v1/projects/code-agent/skills" });
    const uploadRequest = await multipartAttachment(
      "image",
      "screen.png",
      "image/png",
      Buffer.from(pixelDataUrl.split(",")[1] ?? "", "base64"),
      "upload-1",
    );
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
    expect(mcpServers.statusCode).toBe(200);
    expect(mcpServers.json()).toEqual({
      data: [
        expect.objectContaining({ name: "fast-context", status: "ready", toolCount: 2 }),
        expect.objectContaining({ name: "chrome-devtools", status: "ready", toolCount: 2 }),
      ],
    });
    expect(listMcpServers).toHaveBeenCalledOnce();
    expect(listMcpServers).toHaveBeenCalledWith("task-1");
    expect(reloadedMcpServers.statusCode).toBe(200);
    expect(reloadedMcpServers.json()).toMatchObject({
      data: [{ name: "fast-context", status: "starting" }],
    });
    expect(reloadMcpServers).toHaveBeenCalledWith("task-1");
    expect(skills.statusCode).toBe(200);
    expect(skills.json()).toMatchObject({ data: [{ name: "review-security" }] });
    expect(listSkills).toHaveBeenCalledOnce();
    expect(listModels).toHaveBeenCalledOnce();
    expect(uploaded.statusCode).toBe(201);
    expect(repeatedUpload.json()).toEqual(uploaded.json());
    expect(uploaded.json()).toMatchObject({
      attachment: { kind: "image", mediaType: "image/png", name: "screen.png", size: 68 },
    });
    expect(turn.statusCode).toBe(201);
    expect(invalidTurn.statusCode).toBe(400);
    expect(startTurn).toHaveBeenCalledOnce();
    expect(writeTaskSettings).toHaveBeenCalledOnce();
    expect(startTurn).toHaveBeenCalledWith(
      "task-1",
      {
        files: [],
        images: [{ mediaType: "image/png", url: pixelDataUrl }],
        skills: [],
        text: "",
        textAttachments: [],
      },
      turnOptions,
    );
    expect(consumed.statusCode).toBe(404);
    expect(consumed.json()).toMatchObject({ code: "ATTACHMENT_NOT_FOUND" });
  });

  it("preserves original Codex MCP errors for reads and reloads", async () => {
    const { app, listMcpServers, reloadMcpServers } = await createHarness();
    listMcpServers.mockRejectedValueOnce(
      new Error("mcpServerStatus/list failed: MCP server `docs` executable was not found"),
    );
    reloadMcpServers.mockRejectedValueOnce(
      new Error("config/mcpServer/reload failed: transport channel closed"),
    );

    const readResponse = await app.inject({
      method: "GET",
      url: "/v1/projects/code-agent/tasks/task-1/mcp-servers",
    });
    const reloadResponse = await app.inject({
      headers: { "idempotency-key": "reload-task-mcp-error" },
      method: "POST",
      payload: {},
      url: "/v1/projects/code-agent/tasks/task-1/mcp-servers/retry",
    });

    expect(readResponse.statusCode).toBe(502);
    expect(readResponse.json()).toEqual({
      code: "PROVIDER_ERROR",
      message: "mcpServerStatus/list failed: MCP server `docs` executable was not found",
      retryable: true,
    });
    expect(reloadResponse.statusCode).toBe(502);
    expect(reloadResponse.json()).toEqual({
      code: "PROVIDER_ERROR",
      message: "config/mcpServer/reload failed: transport channel closed",
      retryable: true,
    });
  });

  it("rejects oversized or non-multipart attachments before parsing file data", async () => {
    const { app } = await createHarness();
    const oversized = await app.inject({
      headers: {
        "content-length": String(MAX_AGENT_IMAGE_BYTES + 64 * 1024 + 1),
        "content-type": "multipart/form-data; boundary=attachment-boundary",
        "idempotency-key": "oversized-image",
      },
      method: "POST",
      payload: "body must not be parsed",
      url: "/v1/projects/code-agent/attachments/image",
    });
    const json = await app.inject({
      headers: { "idempotency-key": "legacy-json" },
      method: "POST",
      payload: { dataUrl: pixelDataUrl, kind: "image", name: "screen.png" },
      url: "/v1/projects/code-agent/attachments/image",
    });

    expect(oversized.statusCode).toBe(413);
    expect(oversized.json()).toMatchObject({ code: "INVALID_REQUEST" });
    expect(json.statusCode).toBe(400);
    expect(json.json()).toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("resolves pasted text attachments separately from image inputs", async () => {
    const { app, startTurn } = await createHarness();
    const uploaded = await app.inject(
      await multipartAttachment(
        "text",
        "Pasted text.txt",
        "text/plain",
        Buffer.from(pastedTextDataUrl.split(",")[1] ?? "", "base64"),
        "upload-pasted-text",
      ),
    );
    const attachment = uploaded.json<{ attachment: { id: string } }>().attachment;

    const turn = await app.inject({
      headers: { "idempotency-key": "pasted-text-turn" },
      method: "POST",
      payload: {
        input: { attachments: [{ id: attachment.id }], skills: [], text: "", type: "prompt" },
        options: turnOptions,
      },
      url: "/v1/projects/code-agent/tasks/task-1/turns",
    });

    expect(uploaded.statusCode).toBe(201);
    expect(uploaded.json()).toMatchObject({
      attachment: {
        kind: "text",
        mediaType: "text/plain",
        name: "Pasted text.txt",
        size: 16,
      },
    });
    expect(turn.statusCode).toBe(201);
    expect(startTurn).toHaveBeenCalledWith(
      "task-1",
      {
        files: [],
        images: [],
        skills: [],
        text: "",
        textAttachments: [{ name: "Pasted text.txt", text: "你好 CodeAgent" }],
      },
      turnOptions,
    );
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
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(missingAttachment.statusCode).toBe(404);
    expect(missingProject.statusCode).toBe(404);
    expect(readTaskAttachment).toHaveBeenCalledTimes(2);
    expect(readTaskAttachment).toHaveBeenNthCalledWith(1, "task-1", "history/image-1");
  });

  it("serves a submitted attachment before the Provider history is available", async () => {
    const { app, readTaskAttachment } = await createHarness();
    const imageContent = Buffer.from(pixelDataUrl.split(",")[1] ?? "", "base64");
    const uploaded = await app.inject(
      await multipartAttachment(
        "image",
        "screen.png",
        "image/png",
        imageContent,
        "upload-pending-image",
      ),
    );
    const attachment = uploaded.json<{ attachment: { id: string } }>().attachment;

    const turn = await app.inject({
      headers: { "idempotency-key": "pending-image-turn" },
      method: "POST",
      payload: {
        input: { attachments: [{ id: attachment.id }], skills: [], text: "", type: "prompt" },
        options: turnOptions,
      },
      url: "/v1/projects/code-agent/tasks/task-1/turns",
    });
    const preview = await app.inject({
      method: "GET",
      url: `/v1/projects/code-agent/tasks/task-1/attachments/${attachment.id}`,
    });

    expect(turn.statusCode).toBe(201);
    expect(preview.statusCode).toBe(200);
    expect(preview.headers["content-type"]).toBe("image/png");
    expect(preview.headers["x-content-type-options"]).toBe("nosniff");
    expect(preview.rawPayload).toEqual(imageContent);
    expect(readTaskAttachment).toHaveBeenCalledWith("task-1", attachment.id);
  });

  it("opens an authorized task file attachment with the system application", async () => {
    const fileContent = Buffer.from("%PDF-1.7\nattachment\n", "utf8");
    const open = vi.fn<ProjectOpenService["open"]>(async (_root, appId, path) => {
      expect(appId).toBe("system-default");
      expect(path).toBeDefined();
      await expect(readFile(path ?? "")).resolves.toEqual(fileContent);
    });
    const { app } = await createHarness({
      projectOpenService: {
        getCapabilities: () => Promise.resolve({ apps: [], platform: "darwin" }),
        open,
      },
    });
    const uploaded = await app.inject(
      await multipartAttachment(
        "file",
        "report.pdf",
        "application/pdf",
        fileContent,
        "upload-open-file",
      ),
    );
    const attachment = uploaded.json<{ attachment: { id: string } }>().attachment;
    await app.inject({
      headers: { "idempotency-key": "open-file-turn" },
      method: "POST",
      payload: {
        input: { attachments: [{ id: attachment.id }], skills: [], text: "", type: "prompt" },
        options: turnOptions,
      },
      url: "/v1/projects/code-agent/tasks/task-1/turns",
    });

    const response = await app.inject({
      headers: { "idempotency-key": "open-task-attachment" },
      method: "POST",
      payload: {},
      url: `/v1/projects/code-agent/tasks/task-1/attachments/${attachment.id}/open`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ attachmentId: attachment.id, status: "opened" });
    expect(open).toHaveBeenCalledWith(project.rootPath, "system-default", expect.any(String));
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

  it("initializes one project runtime for concurrent first requests", async () => {
    const providerHarness = createProvider();
    let releaseProjectRead!: () => void;
    const projectReadGate = new Promise<void>((resolve) => {
      releaseProjectRead = resolve;
    });
    const read = vi.fn(async (projectId: string) => {
      // 同时阻塞首次读取，确保两个请求都经过 Runtime 缓存未命中路径。
      await projectReadGate;
      return projectId === project.id ? project : undefined;
    });
    const subscribeEvents = vi.spyOn(providerHarness.provider, "subscribeEvents");
    const app = await createCodeAgentServer(
      createServerOptions(providerHarness.provider, {
        projectRepository: {
          list: () => Promise.resolve([]),
          read,
          register: () => Promise.resolve(project),
        },
      }),
    );
    closeCallbacks.push(() => app.close());
    await app.ready();

    const requests = [
      app.inject({ method: "GET", url: "/v1/projects/code-agent/tasks" }),
      app.inject({ method: "GET", url: "/v1/projects/code-agent/tasks" }),
    ];
    await vi.waitFor(() => {
      expect(read).toHaveBeenCalled();
    });
    releaseProjectRead();

    const responses = await Promise.all(requests);
    expect(responses.map((response) => response.statusCode)).toEqual([200, 200]);
    expect(read).toHaveBeenCalledOnce();
    expect(subscribeEvents).toHaveBeenCalledOnce();
    expect(providerHarness.eventListeners.size).toBe(1);
  });

  it("defers registered project runtimes until their first access", async () => {
    const providerHarness = createProvider();
    const forProject = vi.fn(() => providerHarness.provider);
    const runtimeProvider: AgentRuntimeProvider = {
      ...createRuntimeConnectionMethods(),
      forProject,
      getCapabilities: () => providerHarness.provider.getCapabilities(),
      listModels: () => providerHarness.provider.listModels(),
      readDefaultSettings: () => Promise.resolve({}),
      releaseProject: () => Promise.resolve(),
    };
    const app = await createCodeAgentServer(
      createServerOptions(providerHarness.provider, { provider: runtimeProvider }),
    );
    closeCallbacks.push(() => app.close());

    expect(forProject).not.toHaveBeenCalled();
    const projectsResponse = await app.inject({ method: "GET", url: "/v1/projects" });
    expect(projectsResponse.statusCode).toBe(200);
    expect(forProject).not.toHaveBeenCalled();

    const tasksResponse = await app.inject({
      method: "GET",
      url: "/v1/projects/code-agent/tasks",
    });
    expect(tasksResponse.statusCode).toBe(200);
    expect(forProject).toHaveBeenCalledOnce();
    expect(forProject).toHaveBeenCalledWith(project);
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
      settings: { ...turnOptions, sandboxMode: "workspace-write" },
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

  it("reads task settings after ownership is confirmed without overriding provider metadata", async () => {
    const { app, readTask, readTaskSettings } = await createHarness();
    let resolveTask!: (value: AgentProviderTaskSnapshot) => void;
    let resolveSettings!: (value: AgentTaskSettings | undefined) => void;
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

    const response = app.inject({
      method: "GET",
      url: "/v1/projects/code-agent/tasks/task-1",
    });
    await vi.waitFor(() => {
      expect(readTask).toHaveBeenCalledOnce();
    });
    expect(readTaskSettings).not.toHaveBeenCalled();

    resolveTask({ ...snapshot, pinned: true });
    await vi.waitFor(() => {
      expect(readTaskSettings).toHaveBeenCalledOnce();
    });
    resolveSettings(undefined);

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
    expect(writeProjectDefaults).not.toHaveBeenCalledWith("code-agent", {
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      sandboxMode: "read-only",
    });
    expect(writeTaskSettings).not.toHaveBeenCalledWith("code-agent", "task-1", {
      approvalPolicy: "never",
      approvalsReviewer: "user",
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      sandboxMode: "danger-full-access",
    });
  });

  it("uses global settings only when project and task settings are absent", async () => {
    const {
      app,
      readDefaultSettings,
      readGlobalSettings,
      readProjectDefaults,
      readTaskSettings,
      writeGlobalSettings,
      writeProjectDefaults,
      writeTaskSettings,
    } = await createHarness();
    const globalSettings = {
      approvalPolicy: "on-request" as const,
      approvalsReviewer: "auto_review" as const,
      commitMessageModel: "gpt-5.6-sol",
      commitMessagePrompt: "",
      commitMessageReasoningEffort: "high",
      defaultOpenAppId: "visual-studio-code" as const,
      followUpBehavior: "steer" as const,
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      sandboxMode: "danger-full-access" as const,
    };
    readGlobalSettings.mockResolvedValue(globalSettings);
    readProjectDefaults.mockResolvedValue(undefined);
    readTaskSettings.mockResolvedValue(undefined);

    const globalResponse = await app.inject({ method: "GET", url: "/v1/settings" });
    const projectResponse = await app.inject({
      method: "GET",
      url: "/v1/projects/code-agent/defaults",
    });
    const taskResponse = await app.inject({
      method: "GET",
      url: "/v1/projects/code-agent/tasks/task-1",
    });
    const updatedResponse = await app.inject({
      headers: { "idempotency-key": "global-settings" },
      method: "PUT",
      payload: globalSettings,
      url: "/v1/settings",
    });

    expect(globalResponse.json()).toEqual({ settings: globalSettings });
    expect(projectResponse.json()).toEqual({
      settings: {
        model: globalSettings.model,
        reasoningEffort: globalSettings.reasoningEffort,
        sandboxMode: globalSettings.sandboxMode,
      },
    });
    expect(taskResponse.json()).toMatchObject({
      snapshot: {
        settings: {
          approvalPolicy: "on-request",
          approvalsReviewer: "auto_review",
          model: globalSettings.model,
          reasoningEffort: globalSettings.reasoningEffort,
          sandboxMode: globalSettings.sandboxMode,
        },
      },
    });
    expect(updatedResponse.json()).toEqual({ settings: globalSettings });
    expect(writeGlobalSettings).toHaveBeenCalledWith(globalSettings);
    expect(readDefaultSettings).not.toHaveBeenCalled();
    expect(writeProjectDefaults).not.toHaveBeenCalled();
    expect(writeTaskSettings).not.toHaveBeenCalled();
  });

  it("uses Codex user settings only while global settings are absent", async () => {
    const { listModels, provider } = createProvider();
    listModels.mockResolvedValue({
      data: [
        ...modelPage.data.map((model) => ({ ...model, isDefault: false })),
        {
          defaultReasoningEffort: "medium",
          description: "用户模型",
          displayName: "GPT-5.6 Terra",
          id: "gpt-5.6-terra",
          isDefault: true,
          supportedReasoningEfforts: [
            { description: "中", id: "medium" },
            { description: "高", id: "high" },
          ],
        },
      ],
      nextCursor: null,
    });
    const settings = createSettingsRepository();
    const serverOptions = createServerOptions(provider, {
      settingsRepository: settings.repository,
    });
    const readDefaultSettings = vi.fn(() =>
      Promise.resolve({
        approvalPolicy: "never" as const,
        approvalsReviewer: "user" as const,
        model: "gpt-5.6-terra",
        reasoningEffort: "high",
        sandboxMode: "danger-full-access" as const,
      }),
    );
    const app = await createCodeAgentServer({
      ...serverOptions,
      provider: { ...serverOptions.provider, readDefaultSettings },
    });
    closeCallbacks.push(() => app.close());

    const response = await app.inject({ method: "GET", url: "/v1/settings" });

    expect(response.json()).toEqual({
      settings: {
        approvalPolicy: "never",
        approvalsReviewer: "user",
        commitMessageModel: "gpt-5.6-terra",
        commitMessagePrompt: "",
        commitMessageReasoningEffort: "high",
        defaultOpenAppId: null,
        followUpBehavior: "queue",
        model: "gpt-5.6-terra",
        reasoningEffort: "high",
        sandboxMode: "danger-full-access",
      },
    });
    expect(readDefaultSettings).toHaveBeenCalledOnce();
    expect(settings.writeGlobalSettings).not.toHaveBeenCalled();
  });

  it("fills missing Codex user settings from project defaults", async () => {
    const { provider } = createProvider();
    const settings = createSettingsRepository();
    const serverOptions = createServerOptions(provider, {
      settingsRepository: settings.repository,
    });
    const readDefaultSettings = vi.fn(() => Promise.resolve({ approvalPolicy: "never" as const }));
    const app = await createCodeAgentServer({
      ...serverOptions,
      provider: { ...serverOptions.provider, readDefaultSettings },
    });
    closeCallbacks.push(() => app.close());

    const response = await app.inject({ method: "GET", url: "/v1/settings" });

    expect(response.json()).toMatchObject({
      settings: {
        approvalPolicy: "never",
        approvalsReviewer: "user",
        model: "gpt-5.6-sol",
        reasoningEffort: "high",
        sandboxMode: "workspace-write",
      },
    });
    expect(readDefaultSettings).toHaveBeenCalledOnce();
  });

  it("starts new tasks with global approval and persists turn settings before Provider calls", async () => {
    const {
      app,
      readGlobalSettings,
      readProjectDefaults,
      readTaskSettings,
      startTask,
      startTurn,
      writeTaskSettings,
    } = await createHarness();
    readGlobalSettings.mockResolvedValue({
      approvalPolicy: "on-request",
      approvalsReviewer: "auto_review",
      commitMessageModel: "gpt-5.6-sol",
      commitMessagePrompt: "",
      commitMessageReasoningEffort: "high",
      defaultOpenAppId: null,
      followUpBehavior: "queue",
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      sandboxMode: "workspace-write",
    });
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
      approvalsReviewer: "auto_review",
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
    const { app, interruptTurn, readTask, startTask, startTurn, steerTurn } = await createHarness();
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
    const steered = await app.inject({
      headers: { "idempotency-key": "steer-1" },
      method: "POST",
      payload: {
        input: { attachments: [], skills: [], text: "优先修复测试", type: "prompt" },
        taskId: "task-1",
      },
      url: "/v1/projects/code-agent/tasks/task-1/turns/turn-1/steer",
    });
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
      { files: [], images: [], skills: [], text: "继续实现", textAttachments: [] },
      turnOptions,
    );
    expect(steered.statusCode).toBe(202);
    expect(steered.json()).toEqual({ status: "accepted", taskId: "task-1", turnId: "turn-1" });
    expect(steerTurn).toHaveBeenCalledWith("task-1", "turn-1", {
      files: [],
      images: [],
      skills: [],
      text: "优先修复测试",
      textAttachments: [],
    });
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

  it("delegates pin, rename and archive to the Provider", async () => {
    const { app, archiveTask, pinTask, renameTask } = await createHarness();

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
    const archived = await app.inject({
      headers: { "idempotency-key": "archive-key" },
      method: "POST",
      payload: {},
      url: "/v1/projects/code-agent/tasks/task-1/archive",
    });

    expect(pinned.statusCode, pinned.body).toBe(200);
    expect(pinned.json()).toMatchObject({ task: { id: "task-1", pinned: true } });
    expect(pinTask).toHaveBeenCalledWith("task-1", true);
    expect(renamed.statusCode, renamed.body).toBe(200);
    expect(renamed.json()).toMatchObject({ task: { id: "task-1", title: "新的任务名称" } });
    expect(renameTask).toHaveBeenCalledWith("task-1", "新的任务名称");
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
      ...createRuntimeConnectionMethods(),
      forProject: (activeProject) =>
        activeProject.id === otherProject.id ? secondary.provider : primary.provider,
      getCapabilities: () => primary.provider.getCapabilities(),
      listModels: () => primary.provider.listModels(),
      readDefaultSettings: () => Promise.resolve({}),
      releaseProject: () => Promise.resolve(),
    };
    const stateRepository = createSettingsRepository().repository;
    const app = await createCodeAgentServer({
      installAppUpdate: vi.fn(() => Promise.reject(new Error("No update available"))),
      projectRepository: {
        ensureTemporaryProject: () => Promise.resolve(temporaryProject),
        list: () => Promise.resolve([project, otherProject]),
        read: (projectId) =>
          Promise.resolve([project, otherProject].find((item) => item.id === projectId)),
        register: () => Promise.resolve(project),
        remove: () => Promise.resolve(false),
        rename: () => Promise.resolve(undefined),
        reorder: () => Promise.resolve([project, otherProject]),
      },
      providerConnectionRepository: stateRepository,
      provider: runtimeProvider,
      readAppInfo: vi.fn(() =>
        Promise.resolve({
          appVersion: "1.3.0",
          codexVersion: "0.147.0",
          latestVersion: "1.3.0",
          releaseNotes: null,
          status: "current" as const,
          updateAvailable: false,
        }),
      ),
      settingsRepository: stateRepository,
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
      { files: [], images: [], skills: [], text: payload.input.text, textAttachments: [] },
      payload.options,
    );
    expect(startTurn).toHaveBeenNthCalledWith(
      2,
      "task:a:b",
      { files: [], images: [], skills: [], text: payload.input.text, textAttachments: [] },
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

  it("rejects new idempotency keys when the in-flight limit is reached", async () => {
    const { app, startTask } = await createHarness({ idempotencyCacheSize: 1 });
    let resolveStartTask!: (value: typeof task) => void;
    startTask.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStartTask = resolve;
        }),
    );
    const createTask = (key: string) =>
      app.inject({
        headers: { "idempotency-key": key },
        method: "POST",
        payload: {},
        url: "/v1/projects/code-agent/tasks",
      });

    const firstResponsePromise = createTask("in-flight-task-1");
    await vi.waitFor(() => {
      expect(startTask).toHaveBeenCalledTimes(1);
    });
    const repeatedResponsePromise = createTask("in-flight-task-1");
    const rejectedResponse = await createTask("in-flight-task-2");
    resolveStartTask(task);
    const [firstResponse, repeatedResponse] = await Promise.all([
      firstResponsePromise,
      repeatedResponsePromise,
    ]);

    expect(firstResponse.statusCode).toBe(201);
    expect(repeatedResponse.json()).toEqual(firstResponse.json());
    expect(rejectedResponse.statusCode).toBe(503);
    expect(rejectedResponse.json()).toEqual({
      code: "IDEMPOTENCY_CAPACITY_EXCEEDED",
      message: "Too many idempotent requests are in progress",
      retryable: true,
    });
    const nextResponse = await createTask("in-flight-task-2");
    expect(nextResponse.statusCode).toBe(201);
    expect(startTask).toHaveBeenCalledTimes(2);
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

  it("sends connection.ready before a delta queued during WebSocket initialization", async () => {
    const { app } = await createHarness();
    const messages: unknown[] = [];
    const subscribeSpy = vi
      .spyOn(AgentEventStream.prototype, "subscribe")
      .mockImplementationOnce(function (this: AgentEventStream, listener) {
        subscribeSpy.mockRestore();
        const unsubscribe = this.subscribe(listener);
        // 在监听器就绪后同步排入增量，触发初始化期间的 checkpoint flush 竞态。
        this.publish({
          itemId: "item-race",
          payload: { delta: "初始化增量" },
          taskId: "task-1",
          turnId: "turn-1",
          type: "message.delta",
        });
        return unsubscribe;
      });

    let socket: Awaited<ReturnType<typeof app.injectWS>> | undefined;
    try {
      socket = await app.injectWS(
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
    } finally {
      subscribeSpy.mockRestore();
    }

    await vi.waitFor(() => {
      expect(messages).toHaveLength(2);
    });
    expect(messages).toMatchObject([
      { latestSequence: 0, type: "connection.ready" },
      { payload: { delta: "初始化增量" }, sequence: 1, type: "message.delta" },
    ]);
    socket.terminate();
  });

  it("replays retained events and requests resync after retention expires", async () => {
    const harness = createProvider();
    const app = await createCodeAgentServer(
      createServerOptions(harness.provider, { eventBufferSize: 1 }),
    );
    closeCallbacks.push(() => app.close());
    // 首次 Project 访问激活事件流；激活前状态由后续权威 Snapshot 恢复。
    const activationResponse = await app.inject({
      method: "GET",
      url: "/v1/projects/code-agent/tasks",
    });
    expect(activationResponse.statusCode).toBe(200);
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

    await expect(
      app.injectWS("/v1/projects/code-agent/events?afterSequence=-1", {
        headers: { host: "localhost", origin: "http://localhost" },
      }),
    ).rejects.toThrow(/Unexpected server response: 400/u);
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

  it("compresses static assets and applies content-aware cache policies", async () => {
    const staticRoot = await mkdtemp(join(tmpdir(), "code-agent-web-"));
    const assetsRoot = join(staticRoot, "assets");
    const assetBody = "export const value = 'CodeAgent';\n".repeat(128);
    await mkdir(assetsRoot);
    await writeFile(join(staticRoot, "index.html"), "<main>CodeAgent Web</main>", "utf8");
    await writeFile(join(assetsRoot, "index-CqRfgh3W.js"), assetBody, "utf8");
    const app = await createCodeAgentServer(
      createServerOptions(createProvider().provider, { staticRoot }),
    );
    closeCallbacks.push(() => app.close());

    const routeResponse = await app.inject({ method: "GET", url: "/p/code-agent/t/task-1" });
    const brotliAssetResponse = await app.inject({
      headers: { "accept-encoding": "br" },
      method: "GET",
      url: "/assets/index-CqRfgh3W.js",
    });
    const gzipAssetResponse = await app.inject({
      headers: { "accept-encoding": "gzip" },
      method: "GET",
      url: "/assets/index-CqRfgh3W.js",
    });
    const apiResponse = await app.inject({ method: "GET", url: "/v1/missing" });

    expect(routeResponse.statusCode).toBe(200);
    expect(routeResponse.body).toContain("CodeAgent Web");
    expect(routeResponse.headers["cache-control"]).toBe("public, max-age=0");
    expect(brotliAssetResponse.headers["cache-control"]).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(brotliAssetResponse.headers["content-encoding"]).toBe("br");
    expect(brotliDecompressSync(brotliAssetResponse.rawPayload).toString("utf8")).toBe(assetBody);
    expect(gzipAssetResponse.headers["content-encoding"]).toBe("gzip");
    expect(gunzipSync(gzipAssetResponse.rawPayload).toString("utf8")).toBe(assetBody);
    expect(apiResponse.statusCode).toBe(404);
    expect(apiResponse.headers["content-type"]).toContain("application/json");
  });
});
