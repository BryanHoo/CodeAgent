import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { fileURLToPath } from "node:url";

import { expect, test as base, type Page, type Route } from "@playwright/test";

export { expect };

const fakeServerPath = fileURLToPath(
  new URL("../../fixtures/fake-realtime-server.mjs", import.meta.url),
);
const serverReadyPrefix = "Fake realtime server listening on ";

interface WorkerFixtures {
  e2eServerUrl: string;
}

async function waitForServerUrl(
  serverProcess: ChildProcessWithoutNullStreams,
  workerLabel: string,
): Promise<string> {
  let stdout = "";
  let stderr = "";

  serverProcess.stderr.setEncoding("utf8");
  serverProcess.stderr.on("data", (chunk: string) => {
    stderr = `${stderr}${chunk}`.slice(-8_192);
  });

  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Fake Server (${workerLabel}) 启动超时\n${stderr}`));
    }, 30_000);

    const cleanup = () => {
      clearTimeout(timeout);
      serverProcess.off("exit", handleExit);
      serverProcess.stdout.off("data", handleStdout);
    };
    const handleExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      reject(
        new Error(
          `Fake Server (${workerLabel}) 在就绪前退出：code=${String(code)}, signal=${String(signal)}\n${stderr}`,
        ),
      );
    };
    const handleStdout = (chunk: Buffer) => {
      stdout = `${stdout}${chunk.toString("utf8")}`.slice(-8_192);
      const readyLine = stdout.split(/\r?\n/u).find((line) => line.startsWith(serverReadyPrefix));
      if (readyLine === undefined) {
        return;
      }
      cleanup();
      resolve(readyLine.slice(serverReadyPrefix.length));
    };

    serverProcess.once("exit", handleExit);
    serverProcess.stdout.on("data", handleStdout);
  });
}

async function stopServer(serverProcess: ChildProcessWithoutNullStreams): Promise<void> {
  if (serverProcess.exitCode !== null || serverProcess.signalCode !== null) {
    return;
  }

  const exited = new Promise<void>((resolve) =>
    serverProcess.once("exit", () => {
      resolve();
    }),
  );
  serverProcess.kill("SIGTERM");
  const exitedGracefully = await Promise.race([
    exited.then(() => true),
    new Promise<false>((resolve) =>
      setTimeout(() => {
        resolve(false);
      }, 5_000),
    ),
  ]);
  if (!exitedGracefully) {
    serverProcess.kill("SIGKILL");
    await exited;
  }
}

export const test = base.extend<Record<never, never>, WorkerFixtures>({
  e2eServerUrl: [
    async ({ browserName }, use, workerInfo) => {
      // 每个 worker 独占 Fake Server 及其子 App Server，隔离全部内存数据和实时事件。
      const serverProcess = spawn(process.execPath, [fakeServerPath], {
        env: { ...process.env, CODE_AGENT_E2E_PORT: "0" },
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      try {
        const workerLabel = `${browserName}:${String(workerInfo.workerIndex)}`;
        await use(await waitForServerUrl(serverProcess, workerLabel));
      } finally {
        await stopServer(serverProcess);
      }
    },
    { scope: "worker" },
  ],
  baseURL: async ({ e2eServerUrl }, use) => {
    await use(e2eServerUrl);
  },
});

function isRequestRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseRequestRecord(requestBody: string | null): Record<string, unknown> {
  const value: unknown = JSON.parse(requestBody ?? "null");
  if (!isRequestRecord(value)) {
    throw new Error("Invalid JSON request body");
  }
  return value;
}

export async function chooseHostAttachment(
  page: Page,
  kind: "file" | "image",
  fileName: string,
): Promise<void> {
  await page.getByRole("button", { name: "添加图片或文件" }).click();
  await page.getByRole("menuitem", { name: kind === "image" ? "添加图片" : "添加文件" }).click();
  const dialog = page.getByRole("dialog", {
    name: kind === "image" ? "选择本机图片" : "选择本机文件",
  });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("treeitem", { exact: true, name: fileName }).click();
  await dialog.getByRole("button", { name: "添加所选文件" }).click();
}

export function parseProjectDefaultsRequest(requestBody: string | null) {
  const value = parseRequestRecord(requestBody);
  const model = value["model"];
  const reasoningEffort = value["reasoningEffort"];
  const sandboxMode = value["sandboxMode"];
  if (
    typeof model !== "string" ||
    typeof reasoningEffort !== "string" ||
    typeof sandboxMode !== "string"
  ) {
    throw new Error("Invalid project defaults request");
  }
  return { model, reasoningEffort, sandboxMode };
}

export function parseTaskSettingsRequest(requestBody: string | null) {
  const value = parseRequestRecord(requestBody);
  const approvalPolicy = value["approvalPolicy"];
  const approvalsReviewer = value["approvalsReviewer"];
  const model = value["model"];
  const reasoningEffort = value["reasoningEffort"];
  const sandboxMode = value["sandboxMode"];
  if (
    typeof approvalPolicy !== "string" ||
    typeof approvalsReviewer !== "string" ||
    typeof model !== "string" ||
    typeof reasoningEffort !== "string" ||
    typeof sandboxMode !== "string"
  ) {
    throw new Error("Invalid task settings request");
  }
  return { approvalPolicy, approvalsReviewer, model, reasoningEffort, sandboxMode };
}

export function parseGlobalSettingsRequest(requestBody: string | null) {
  const settings = parseTaskSettingsRequest(requestBody);
  const value = parseRequestRecord(requestBody);
  const commitMessageModel = value["commitMessageModel"];
  const commitMessagePrompt = value["commitMessagePrompt"];
  const commitMessageReasoningEffort = value["commitMessageReasoningEffort"];
  const defaultOpenAppId = value["defaultOpenAppId"];
  const followUpBehavior = value["followUpBehavior"];
  if (
    typeof commitMessageModel !== "string" ||
    typeof commitMessagePrompt !== "string" ||
    typeof commitMessageReasoningEffort !== "string" ||
    (followUpBehavior !== "queue" && followUpBehavior !== "steer") ||
    (defaultOpenAppId !== null && typeof defaultOpenAppId !== "string")
  ) {
    throw new Error("Invalid global settings request");
  }
  const normalizedFollowUpBehavior: "queue" | "steer" =
    followUpBehavior === "queue" ? "queue" : "steer";
  return {
    ...settings,
    commitMessageModel,
    commitMessagePrompt,
    commitMessageReasoningEffort,
    defaultOpenAppId,
    followUpBehavior: normalizedFollowUpBehavior,
  };
}

export function parseProjectOrderRequest(requestBody: string | null): readonly string[] {
  const value = parseRequestRecord(requestBody);
  const projectIds = value["projectIds"];
  if (
    !Array.isArray(projectIds) ||
    !projectIds.every((projectId) => typeof projectId === "string")
  ) {
    throw new Error("Invalid project order request");
  }
  return projectIds;
}

export const projects = [
  {
    createdAt: "2026-07-22T06:00:00.000Z",
    id: "code-agent",
    name: "CodeAgent",
    rootPath: "~/Develop/person/CodeAgent",
  },
  {
    createdAt: "2026-07-22T06:30:00.000Z",
    id: "superwork",
    name: "superwork",
    rootPath: "~/Develop/person/superwork",
  },
];

export const models = [
  {
    defaultReasoningEffort: "high",
    description: "适合复杂编码任务",
    displayName: "GPT-5.6 Sol",
    id: "gpt-5.6-sol",
    isDefault: true,
    supportedReasoningEfforts: [
      { description: "快速回答", id: "low" },
      { description: "深入分析", id: "high" },
    ],
  },
  {
    defaultReasoningEffort: "medium",
    description: "适合日常编码任务",
    displayName: "GPT-5.6 Terra",
    id: "gpt-5.6-terra",
    isDefault: false,
    supportedReasoningEfforts: [
      { description: "快速回答", id: "low" },
      { description: "平衡速度与深度", id: "medium" },
    ],
  },
];

export const customModels = [
  {
    defaultReasoningEffort: "medium",
    description: "",
    displayName: "custom-coder",
    id: "custom-coder",
    isDefault: true,
    supportedReasoningEfforts: [{ description: "", id: "medium" }],
  },
];

export const skills = [
  {
    description: "审查认证、授权和敏感数据边界",
    displayName: "Security review",
    id: "skill-security",
    name: "review-security",
    scope: "system",
  },
  {
    description: "撰写结构化项目文档",
    displayName: "Documentation writer",
    id: "skill-docs",
    name: "documentation-writer",
    scope: "user",
  },
];

export const mcpServers = ["context7", "chrome-devtools"].map((name) => ({
  authStatus: "unsupported" as const,
  description: null,
  error: null,
  failureReason: null,
  name,
  status: "ready" as const,
  title: null,
  toolCount: 2,
  version: "1.0.0",
}));

export const tasks = [
  {
    id: "task-1",
    pinned: true,
    projectId: "code-agent",
    title: "构建 macOS 工作台",
    updatedAt: "2026-07-22T07:58:00.000Z",
  },
  {
    id: "input-design",
    pinned: false,
    projectId: "code-agent",
    title: "优化输入框交互",
    updatedAt: "2026-07-22T06:00:00.000Z",
  },
  {
    id: "markdown",
    pinned: false,
    projectId: "code-agent",
    title: "完善 Markdown 渲染",
    updatedAt: "2026-07-20T08:00:00.000Z",
  },
  {
    id: "runtime",
    pinned: false,
    projectId: "code-agent",
    title: "完善 Runtime 状态",
    updatedAt: "2026-07-19T08:00:00.000Z",
  },
  {
    id: "provider",
    pinned: false,
    projectId: "code-agent",
    title: "整理 Provider 边界",
    updatedAt: "2026-07-18T08:00:00.000Z",
  },
  {
    id: "protocol",
    pinned: false,
    projectId: "code-agent",
    title: "补充 Protocol 契约",
    updatedAt: "2026-07-17T08:00:00.000Z",
  },
  {
    id: "client",
    pinned: false,
    projectId: "code-agent",
    title: "优化 Client 请求",
    updatedAt: "2026-07-16T08:00:00.000Z",
  },
  {
    id: "plan-check",
    pinned: false,
    projectId: "superwork",
    title: "优化计划预检反馈",
    updatedAt: "2026-07-21T09:00:00.000Z",
  },
];

export const packageJsonDiff = [
  "--- a/package.json",
  "+++ b/package.json",
  "@@ -1,3 +1,3 @@",
  " {",
  '-  "start": "pnpm run dev",',
  '+  "start": "node ./dist/cli.js start",',
  " }",
].join("\n");

export const projectGitStatus = {
  baseBranches: ["origin/main", "main", "release"],
  branch: "feat/review-targets",
  branches: ["feat/review-targets", "main", "release"],
  repositoryMode: "root",
  snapshot: "a".repeat(64),
  staged: [],
  unstaged: [{ diff: packageJsonDiff, kind: "update", path: "package.json" }],
};

export const projectFileTreeByDirectory = new Map<string | null, object>([
  [
    null,
    {
      entries: [
        { path: "design", type: "directory" },
        { path: "docs", type: "directory" },
        { path: "package.json", type: "file" },
        { path: "100%完成 后续工作交接.pptx", type: "file" },
      ],
      path: null,
    },
  ],
  [
    "design",
    {
      entries: [{ path: "design/result.png", type: "file" }],
      path: "design",
    },
  ],
  [
    "docs",
    {
      entries: [{ path: "docs/architecture-design.md", type: "file" }],
      path: "docs",
    },
  ],
]);

export const projectDirectoryListings = new Map<string | null, object>([
  [
    null,
    {
      entries: [
        { name: "AddedProject", path: "/workspace/AddedProject" },
        { name: "CodeAgent", path: "/workspace/CodeAgent" },
        { name: "superwork", path: "/workspace/superwork" },
      ],
      parentPath: "/",
      path: "/workspace",
    },
  ],
  [
    "/workspace/AddedProject",
    { entries: [], parentPath: "/workspace", path: "/workspace/AddedProject" },
  ],
]);

export const taskSnapshot = {
  ...tasks[0],
  contextUsage: { contextWindow: 200_000, usedTokens: 25_000 },
  pendingRequests: [],
  settings: {
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    model: "gpt-5.6-sol",
    reasoningEffort: "high",
    sandboxMode: "workspace-write",
  },
  status: "idle",
  turns: [
    {
      completedAt: "2026-07-22T08:00:00.000Z",
      error: null,
      id: "turn-1",
      items: [
        {
          id: "message-1",
          role: "user",
          skills: [{ name: "review-security" }],
          text: "完成 macOS 原生风格的三栏工作台页面。",
          type: "message",
        },
        {
          content: "保留任务导航、结构化 Agent 时间线与上下文检查器。",
          id: "reasoning-1",
          summary: "分析工作台信息架构",
          type: "reasoning",
        },
        {
          id: "tool-1",
          input: { files: ["docs/web-design.md"] },
          name: "读取 Web 设计规范",
          status: "completed",
          type: "tool",
        },
        {
          changes: [
            {
              diff: packageJsonDiff,
              kind: "update",
              path: "/workspace/CodeAgent/package.json",
            },
          ],
          id: "file-change-1",
          status: "completed",
          type: "file_change",
        },
        {
          id: "message-2",
          role: "assistant",
          text: "工作台界面已按统一的 项目 Agent 组件 结构重新组织。\n\n[architecture-design.md](/workspace/CodeAgent/docs/architecture-design.md:716)\n\n[result.png](/workspace/CodeAgent/design/result.png)\n\n[后续工作交接.pptx](/home/taoye/100%完成/AI 领航/%E5%90%8E%E7%BB%AD%E5%B7%A5%E4%BD%9C%E4%BA%A4%E6%8E%A5.pptx)\n\n[OpenAI](https://openai.com)",
          type: "message",
        },
      ],
      startedAt: "2026-07-22T07:58:00.000Z",
      status: "completed",
    },
  ],
};

export const taskSnapshotResponse = {
  checkpoint: { sequence: 0, sessionId: "e2e-session" },
  snapshot: taskSnapshot,
};

export const architectureSourcePreview = Array.from({ length: 720 }, (_, lineIndex) =>
  lineIndex === 715 ? "### 11.7 外部登录边界" : `line ${String(lineIndex + 1)}`,
).join("\n");

export async function mockAppShellApi(
  page: Page,
  options: Readonly<{ providerConnected?: boolean }> = {},
): Promise<void> {
  let routedProjects = [...projects];
  let routedTasks = tasks.map((task) => ({ ...task }));
  let temporaryTasks: (typeof tasks)[number][] = [];
  const temporaryTurns = new Map<string, (typeof taskSnapshot.turns)[number][]>();
  let routedProjectGitStatus = { ...projectGitStatus };
  const projectDefaults = new Map(
    projects.map((project) => [
      project.id,
      { model: "gpt-5.6-sol", reasoningEffort: "high", sandboxMode: "workspace-write" },
    ]),
  );
  const taskSettings = new Map([
    ["code-agent:task-1", taskSnapshot.settings],
    ["code-agent:task-2", taskSnapshot.settings],
  ]);
  let globalSettings = {
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    commitMessageModel: "gpt-5.6-sol",
    commitMessagePrompt: "",
    commitMessageReasoningEffort: "high",
    defaultOpenAppId: "zed" as string | null,
    followUpBehavior: "queue" as "queue" | "steer",
    model: "gpt-5.6-sol",
    reasoningEffort: "high",
    sandboxMode: "workspace-write",
  };
  let providerStatus = {
    account: options.providerConnected === false ? null : ({ type: "apiKey" } as const),
    customBaseUrl: null as string | null,
    mode: "official" as "custom" | "official",
    pendingLogin: null as null | {
      error: string | null;
      loginId: string;
      state: "failed" | "pending";
    },
    state: (options.providerConnected === false ? "disconnected" : "connected") as
      "connected" | "disconnected" | "failed" | "pending",
  };
  let routedModels = models;
  const handleApiRoute = async (route: Route) => {
    const url = new URL(route.request().url());
    const defaultsMatch = /^\/v1\/projects\/([^/]+)\/defaults$/u.exec(url.pathname);
    const settingsMatch = /^\/v1\/projects\/([^/]+)\/tasks\/([^/]+)\/settings$/u.exec(url.pathname);
    const pinMatch = /^\/v1\/projects\/([^/]+)\/tasks\/([^/]+)\/pin$/u.exec(url.pathname);
    const renameMatch = /^\/v1\/projects\/([^/]+)\/tasks\/([^/]+)\/rename$/u.exec(url.pathname);
    const archiveMatch = /^\/v1\/projects\/([^/]+)\/tasks\/([^/]+)\/archive$/u.exec(url.pathname);
    const temporarySettingsMatch = /^\/v1\/temporary\/tasks\/([^/]+)\/settings$/u.exec(
      url.pathname,
    );
    const temporaryPinMatch = /^\/v1\/temporary\/tasks\/([^/]+)\/pin$/u.exec(url.pathname);
    const temporaryRenameMatch = /^\/v1\/temporary\/tasks\/([^/]+)\/rename$/u.exec(url.pathname);
    const temporaryArchiveMatch = /^\/v1\/temporary\/tasks\/([^/]+)\/archive$/u.exec(url.pathname);
    const temporaryTaskMatch = /^\/v1\/temporary\/tasks\/([^/]+)$/u.exec(url.pathname);
    const temporaryTurnMatch = /^\/v1\/temporary\/tasks\/([^/]+)\/turns$/u.exec(url.pathname);
    const projectRenameMatch = /^\/v1\/projects\/([^/]+)\/rename$/u.exec(url.pathname);
    const projectRemoveMatch = /^\/v1\/projects\/([^/]+)\/remove$/u.exec(url.pathname);
    if (url.pathname === "/v1/projects/code-agent/files/image") {
      await route.fulfill({
        body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
          "base64",
        ),
        contentType: "image/png",
      });
      return;
    }
    if (
      (/^\/v1\/projects\/[^/]+\/attachments\/[^/]+$/u.test(url.pathname) ||
        /^\/v1\/temporary\/attachments\/[^/]+$/u.test(url.pathname)) &&
      route.request().method() === "GET"
    ) {
      await route.fulfill({
        body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
          "base64",
        ),
        contentType: "image/png",
      });
      return;
    }

    let body: unknown;

    if (url.pathname === "/v1/access") {
      body = { authenticated: true, mode: "local", version: 1 };
    } else if (url.pathname === "/v1/health") {
      body = { status: "ok", version: 1 };
    } else if (url.pathname === "/v1/app-info") {
      body = {
        appVersion: "1.3.0",
        codexVersion: "0.146.0",
        latestVersion: "1.3.0",
        status: "current",
        updateAvailable: false,
      };
    } else if (url.pathname === "/v1/capabilities") {
      body = {
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
      };
    } else if (url.pathname === "/v1/provider-connection") {
      body = providerStatus;
    } else if (
      url.pathname === "/v1/provider-connection/custom" &&
      route.request().method() === "PUT"
    ) {
      const input = parseRequestRecord(route.request().postData());
      const baseUrl = input["baseUrl"];
      if (typeof baseUrl !== "string") {
        throw new Error("Invalid custom provider request");
      }
      routedModels = customModels;
      providerStatus = {
        account: input["apiKey"] === undefined ? null : { type: "apiKey" },
        customBaseUrl: baseUrl.replace(/\/+$/u, ""),
        mode: "custom",
        pendingLogin: null,
        state: "connected",
      };
      body = { models: { data: routedModels, nextCursor: null }, status: providerStatus };
    } else if (url.pathname === "/v1/provider-connection/official-login") {
      providerStatus = {
        account: null,
        customBaseUrl: null,
        mode: "official",
        pendingLogin: { error: null, loginId: "e2e-login", state: "pending" },
        state: "pending",
      };
      body = {
        authUrl: "https://auth.openai.com/authorize",
        loginId: "e2e-login",
        status: providerStatus,
      };
    } else if (url.pathname === "/v1/provider-connection/official-login/cancel") {
      providerStatus = {
        account: null,
        customBaseUrl: null,
        mode: "official",
        pendingLogin: null,
        state: "disconnected",
      };
      body = { status: providerStatus };
    } else if (url.pathname === "/v1/provider-connection/logout") {
      providerStatus = { ...providerStatus, account: null, state: "disconnected" };
      body = { status: providerStatus };
    } else if (url.pathname === "/v1/models") {
      body = { data: routedModels, nextCursor: null };
    } else if (url.pathname === "/v1/settings") {
      if (route.request().method() === "PUT") {
        globalSettings = parseGlobalSettingsRequest(route.request().postData());
      }
      body = { settings: globalSettings };
    } else if (url.pathname === "/v1/temporary/tasks" && route.request().method() === "POST") {
      const task = {
        id: `temporary-task-${String(temporaryTasks.length + 1)}`,
        pinned: false,
        projectId: "temporary",
        title: "临时任务会话",
        updatedAt: "2026-08-06T08:00:00.000Z",
      };
      temporaryTasks = [task, ...temporaryTasks];
      temporaryTurns.set(task.id, []);
      taskSettings.set(`temporary:${task.id}`, {
        approvalPolicy:
          globalSettings.approvalsReviewer === "auto_review"
            ? "on-request"
            : globalSettings.approvalPolicy,
        approvalsReviewer: globalSettings.approvalsReviewer,
        model: globalSettings.model,
        reasoningEffort: globalSettings.reasoningEffort,
        sandboxMode: globalSettings.sandboxMode,
      });
      body = { task };
    } else if (url.pathname === "/v1/temporary/tasks") {
      const pageLimit = Number(url.searchParams.get("limit") ?? "5");
      const pageOffset = Number(url.searchParams.get("cursor") ?? "0");
      const nextOffset = pageOffset + pageLimit;
      body = {
        data: temporaryTasks.slice(pageOffset, nextOffset),
        nextCursor: nextOffset < temporaryTasks.length ? String(nextOffset) : null,
      };
    } else if (temporarySettingsMatch !== null) {
      const taskId = temporarySettingsMatch[1] ?? "";
      const key = `temporary:${taskId}`;
      if (route.request().method() === "PUT") {
        taskSettings.set(key, parseTaskSettingsRequest(route.request().postData()));
      }
      body = { settings: taskSettings.get(key) ?? taskSnapshot.settings };
    } else if (temporaryPinMatch !== null) {
      const taskId = temporaryPinMatch[1] ?? "";
      const request = parseRequestRecord(route.request().postData());
      const pinned = request["pinned"];
      const task = temporaryTasks.find((item) => item.id === taskId);
      if (task === undefined || typeof pinned !== "boolean") {
        throw new Error("Invalid temporary pin request");
      }
      task.pinned = pinned;
      body = { task };
    } else if (temporaryRenameMatch !== null) {
      const taskId = temporaryRenameMatch[1] ?? "";
      const request = parseRequestRecord(route.request().postData());
      const title = request["title"];
      const task = temporaryTasks.find((item) => item.id === taskId);
      if (task === undefined || typeof title !== "string") {
        throw new Error("Invalid temporary rename request");
      }
      task.title = title;
      body = { task };
    } else if (temporaryArchiveMatch !== null) {
      const taskId = temporaryArchiveMatch[1] ?? "";
      temporaryTasks = temporaryTasks.filter((item) => item.id !== taskId);
      temporaryTurns.delete(taskId);
      body = { status: "archived", taskId };
    } else if (temporaryTurnMatch !== null && route.request().method() === "POST") {
      const taskId = temporaryTurnMatch[1] ?? "";
      const task = temporaryTasks.find((item) => item.id === taskId);
      const request = parseRequestRecord(route.request().postData());
      const input = request["input"];
      const options = request["options"];
      if (
        task === undefined ||
        !isRequestRecord(input) ||
        typeof input["text"] !== "string" ||
        !isRequestRecord(options)
      ) {
        throw new Error("Invalid temporary turn request");
      }
      // 真实 Server 会在启动 Turn 前保存完整设置，刷新后的 Snapshot 必须复现该行为。
      taskSettings.set(`temporary:${taskId}`, parseTaskSettingsRequest(JSON.stringify(options)));
      const turnNumber = (temporaryTurns.get(taskId)?.length ?? 0) + 1;
      const turn = {
        completedAt: `2026-08-06T08:0${String(turnNumber)}:30.000Z`,
        error: null,
        id: `temporary-turn-${String(turnNumber)}`,
        items: [
          {
            id: `temporary-user-${String(turnNumber)}`,
            role: "user" as const,
            text: input["text"],
            type: "message" as const,
          },
          {
            id: `temporary-assistant-${String(turnNumber)}`,
            role: "assistant" as const,
            text: `临时回复：${input["text"]}`,
            type: "message" as const,
          },
        ],
        startedAt: `2026-08-06T08:0${String(turnNumber)}:00.000Z`,
        status: "completed" as const,
      };
      temporaryTurns.set(taskId, [...(temporaryTurns.get(taskId) ?? []), turn]);
      body = { taskId, turn };
    } else if (temporaryTaskMatch !== null) {
      const taskId = temporaryTaskMatch[1] ?? "";
      const task = temporaryTasks.find((item) => item.id === taskId);
      if (task === undefined) {
        await route.fulfill({
          contentType: "application/json",
          json: { message: "Not found" },
          status: 404,
        });
        return;
      }
      body = {
        checkpoint: { sequence: 0, sessionId: "e2e-session" },
        snapshot: {
          ...task,
          contextUsage: { contextWindow: 200_000, usedTokens: 1_000 },
          pendingRequests: [],
          settings: taskSettings.get(`temporary:${taskId}`) ?? taskSnapshot.settings,
          status: "idle",
          turns: temporaryTurns.get(taskId) ?? [],
        },
      };
    } else if (url.pathname === "/v1/temporary/skills") {
      body = { data: skills, nextCursor: null };
    } else if (
      /^\/v1\/(?:temporary|projects\/[^/]+)\/tasks\/[^/]+\/mcp-servers\/retry$/u.test(
        url.pathname,
      ) &&
      route.request().method() === "POST"
    ) {
      body = {
        data: mcpServers.map((server) => ({
          ...server,
          authStatus: null,
          status: "starting",
          toolCount: 0,
          version: null,
        })),
      };
    } else if (/^\/v1\/temporary\/tasks\/[^/]+\/mcp-servers$/u.test(url.pathname)) {
      body = { data: mcpServers };
    } else if (/^\/v1\/projects\/[^/]+\/skills$/u.test(url.pathname)) {
      body = { data: skills, nextCursor: null };
    } else if (/^\/v1\/projects\/[^/]+\/tasks\/[^/]+\/mcp-servers$/u.test(url.pathname)) {
      body = { data: mcpServers };
    } else if (/^\/v1\/projects\/[^/]+\/open-capabilities$/u.test(url.pathname)) {
      body = {
        apps: [
          { id: "zed", kind: "editor", name: "Zed" },
          { id: "system-default", kind: "system-default", name: "__SYSTEM_DEFAULT__" },
          { id: "finder", kind: "file-manager", name: "Finder" },
          { id: "terminal", kind: "terminal", name: "Terminal" },
        ],
        platform: "darwin",
      };
    } else if (
      /^\/v1\/projects\/[^/]+\/open$/u.test(url.pathname) &&
      route.request().method() === "POST"
    ) {
      const request = parseRequestRecord(route.request().postData());
      body = {
        appId: request["appId"],
        ...(typeof request["path"] === "string" ? { path: request["path"] } : {}),
      };
    } else if (url.pathname === "/v1/projects/order" && route.request().method() === "PUT") {
      const projectIds = parseProjectOrderRequest(route.request().postData());
      routedProjects = projectIds.map((projectId) => {
        const project = routedProjects.find((item) => item.id === projectId);
        if (project === undefined) {
          throw new Error("Unknown project in order request");
        }
        return project;
      });
      body = { data: routedProjects, nextCursor: null };
    } else if (url.pathname === "/v1/host-files") {
      const kind = url.searchParams.get("kind");
      const fileNames =
        kind === "image"
          ? ["draft.png", "preserved.png", "screen.png", "task-draft.png"]
          : ["specification.pdf"];
      body = {
        entries: fileNames.map((name) => ({
          name,
          path: `/Users/bryan/Attachments/${name}`,
          type: "file",
        })),
        parentPath: "/Users/bryan",
        path: "/Users/bryan/Attachments",
      };
    } else if (
      /^\/v1\/projects\/[^/]+\/attachments\/(file|image)\/host$/u.test(url.pathname) &&
      route.request().method() === "POST"
    ) {
      const kind = url.pathname.includes("/attachments/image/") ? "image" : "file";
      const request = parseRequestRecord(route.request().postData());
      const path = request["path"];
      if (typeof path !== "string") {
        throw new Error("Invalid host attachment request");
      }
      const name = path.split("/").at(-1) ?? "attachment";
      body = {
        attachment: {
          id: `attachment-host-${name}`,
          kind,
          mediaType: kind === "image" ? "image/png" : "application/pdf",
          name,
          size: kind === "image" ? 68 : 8,
        },
      };
    } else if (url.pathname === "/v1/project-directories") {
      const path = url.searchParams.get("path");
      body =
        projectDirectoryListings.get(path) ??
        ({ entries: [], parentPath: "/workspace", path } as const);
    } else if (url.pathname === "/v1/projects" && route.request().method() === "POST") {
      const request = parseRequestRecord(route.request().postData());
      const rootPath = request["rootPath"];
      if (rootPath !== "/workspace/AddedProject") {
        throw new Error("Invalid add project request");
      }
      const addedProject = {
        createdAt: "2026-07-25T00:00:00.000Z",
        id: "added-project",
        name: "AddedProject",
        rootPath,
      };
      routedProjects = [...routedProjects, addedProject];
      body = { project: addedProject };
    } else if (projectRenameMatch !== null && route.request().method() === "POST") {
      const projectId = projectRenameMatch[1] ?? "";
      const request = parseRequestRecord(route.request().postData());
      const name = request["name"];
      const projectIndex = routedProjects.findIndex((project) => project.id === projectId);
      const project = routedProjects[projectIndex];
      if (project === undefined || typeof name !== "string") {
        throw new Error("Invalid rename project request");
      }
      const renamedProject = { ...project, name };
      routedProjects[projectIndex] = renamedProject;
      body = { project: renamedProject };
    } else if (projectRemoveMatch !== null && route.request().method() === "POST") {
      const projectId = projectRemoveMatch[1] ?? "";
      routedProjects = routedProjects.filter((project) => project.id !== projectId);
      body = { projectId, status: "removed" };
    } else if (url.pathname === "/v1/projects") {
      body = { data: routedProjects, nextCursor: null };
    } else if (/^\/v1\/projects\/[^/]+\/files\/tree$/u.test(url.pathname)) {
      const directoryPath = url.searchParams.get("path");
      // 文件树接口只返回当前目录的直接子项，用于验证点击目录后才按需加载。
      body = projectFileTreeByDirectory.get(directoryPath) ?? { entries: [], path: directoryPath };
    } else if (url.pathname === "/v1/projects/code-agent/files/source") {
      body = {
        content: architectureSourcePreview,
        path: "docs/architecture-design.md",
        truncated: true,
      };
    } else if (
      url.pathname === "/v1/projects/code-agent/git/branch" &&
      route.request().method() === "POST"
    ) {
      const request = parseRequestRecord(route.request().postData());
      const branch = request["branch"];
      if (
        typeof branch !== "string" ||
        request["expectedSnapshot"] !== routedProjectGitStatus.snapshot ||
        !routedProjectGitStatus.branches.includes(branch)
      ) {
        throw new Error("Invalid branch switch request");
      }
      const previousBranch = routedProjectGitStatus.branch;
      routedProjectGitStatus = {
        ...routedProjectGitStatus,
        baseBranches: [
          ...routedProjectGitStatus.baseBranches.filter((candidate) => candidate !== branch),
          previousBranch,
        ],
        branch,
        branches: [
          branch,
          ...routedProjectGitStatus.branches.filter((candidate) => candidate !== branch),
        ],
        snapshot: "b".repeat(64),
      };
      body = routedProjectGitStatus;
    } else if (
      url.pathname === "/v1/projects/code-agent/git/branches" &&
      route.request().method() === "POST"
    ) {
      const request = parseRequestRecord(route.request().postData());
      const branch = request["branch"];
      if (
        typeof branch !== "string" ||
        request["expectedSnapshot"] !== routedProjectGitStatus.snapshot ||
        routedProjectGitStatus.branches.includes(branch)
      ) {
        throw new Error("Invalid branch creation request");
      }
      const previousBranch = routedProjectGitStatus.branch;
      routedProjectGitStatus = {
        ...routedProjectGitStatus,
        baseBranches: [...routedProjectGitStatus.baseBranches, previousBranch],
        branch,
        branches: [branch, ...routedProjectGitStatus.branches],
        snapshot: "c".repeat(64),
      };
      body = routedProjectGitStatus;
    } else if (url.pathname === "/v1/projects/code-agent/git/status") {
      body = routedProjectGitStatus;
    } else if (defaultsMatch !== null) {
      const projectId = defaultsMatch[1] ?? "";
      if (route.request().method() === "PUT") {
        projectDefaults.set(projectId, parseProjectDefaultsRequest(route.request().postData()));
      }
      body = { settings: projectDefaults.get(projectId) };
    } else if (settingsMatch !== null) {
      const projectId = settingsMatch[1] ?? "";
      const taskId = settingsMatch[2] ?? "";
      const key = `${projectId}:${taskId}`;
      if (route.request().method() === "PUT") {
        taskSettings.set(key, parseTaskSettingsRequest(route.request().postData()));
      }
      body = { settings: taskSettings.get(key) ?? taskSnapshot.settings };
    } else if (pinMatch !== null) {
      const taskId = pinMatch[2] ?? "";
      const request = parseRequestRecord(route.request().postData());
      const pinned = request["pinned"];
      const task = routedTasks.find((item) => item.id === taskId);
      if (task === undefined || typeof pinned !== "boolean") {
        throw new Error("Invalid pin task request");
      }
      task.pinned = pinned;
      body = { task };
    } else if (renameMatch !== null) {
      const taskId = renameMatch[2] ?? "";
      const request = parseRequestRecord(route.request().postData());
      const title = request["title"];
      const task = routedTasks.find((item) => item.id === taskId);
      if (task === undefined || typeof title !== "string") {
        throw new Error("Invalid rename task request");
      }
      task.title = title;
      body = { task };
    } else if (archiveMatch !== null) {
      const taskId = archiveMatch[2] ?? "";
      routedTasks = routedTasks.filter((item) => item.id !== taskId);
      body = { status: "archived", taskId };
    } else if (url.pathname.endsWith("/background-terminals")) {
      body = { data: [], nextCursor: null };
    } else if (url.pathname.startsWith("/v1/projects/") && url.pathname.endsWith("/tasks")) {
      const projectId = url.pathname.split("/")[3];
      const projectTasks = routedTasks.filter((task) => task.projectId === projectId);
      const pageLimit = Number(url.searchParams.get("limit") ?? "5");
      const pageOffset = Number(url.searchParams.get("cursor") ?? "0");
      const nextOffset = pageOffset + pageLimit;
      // 测试服务按真实 Cursor 契约分页，避免首屏测试意外读取全部任务。
      body = {
        data: projectTasks.slice(pageOffset, nextOffset),
        nextCursor: nextOffset < projectTasks.length ? String(nextOffset) : null,
      };
    } else if (url.pathname === "/v1/projects/code-agent/tasks/task-1") {
      body = {
        ...taskSnapshotResponse,
        snapshot: {
          ...taskSnapshotResponse.snapshot,
          settings: taskSettings.get("code-agent:task-1") ?? taskSnapshot.settings,
        },
      };
    } else if (url.pathname === "/v1/projects/code-agent/tasks/task-2") {
      body = {
        ...taskSnapshotResponse,
        snapshot: {
          ...taskSnapshotResponse.snapshot,
          id: "task-2",
          settings: taskSettings.get("code-agent:task-2") ?? taskSnapshot.settings,
          title: "续接任务",
        },
      };
    } else if (url.pathname === "/v1/projects/code-agent/tasks/task-1/compact") {
      body = { status: "compacting", taskId: "task-1" };
    } else if (url.pathname === "/v1/projects/code-agent/tasks/task-1/review") {
      body = {
        taskId: "task-1",
        turn: {
          completedAt: null,
          error: null,
          id: "review-turn",
          items: [],
          startedAt: "2026-07-29T00:00:00.000Z",
          status: "running",
        },
      };
    } else if (url.pathname === "/v1/projects/code-agent/tasks/task-1/fork") {
      body = {
        task: {
          id: "task-2",
          pinned: false,
          projectId: "code-agent",
          title: "续接任务",
          updatedAt: "2026-07-25T00:00:00.000Z",
        },
      };
    } else {
      await route.fulfill({
        contentType: "application/json",
        json: { message: "Not found" },
        status: 404,
      });
      return;
    }

    await route.fulfill({ contentType: "application/json", json: body });
  };
  await page.route("**/v1/**", handleApiRoute);
  // 部分真实 Runtime 用例会解除通用 API mock；temporary 契约仍需保持测试内隔离。
  await page.route("**/v1/temporary/**", handleApiRoute);
}

test.beforeEach(async ({ page }) => {
  await mockAppShellApi(page);
});
