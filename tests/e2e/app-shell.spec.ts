import { expect, test } from "@playwright/test";

function isRequestRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRequestRecord(requestBody: string | null): Record<string, unknown> {
  const value: unknown = JSON.parse(requestBody ?? "null");
  if (!isRequestRecord(value)) {
    throw new Error("Invalid JSON request body");
  }
  return value;
}

function parseProjectDefaultsRequest(requestBody: string | null) {
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

function parseTaskSettingsRequest(requestBody: string | null) {
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

function parseProjectOrderRequest(requestBody: string | null): readonly string[] {
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

const projects = [
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

const models = [
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

const skills = [
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

const tasks = [
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

const packageJsonDiff = [
  "--- a/package.json",
  "+++ b/package.json",
  "@@ -1,3 +1,3 @@",
  " {",
  '-  "start": "pnpm run dev",',
  '+  "start": "node ./dist/cli.js start",',
  " }",
].join("\n");

const projectGitStatus = {
  baseBranches: ["origin/main", "main", "release"],
  branch: "feat/review-targets",
  staged: [],
  unstaged: [{ diff: packageJsonDiff, kind: "update", path: "package.json" }],
};

const taskSnapshot = {
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
          text: "工作台界面已按统一的 AI Elements 结构重新组织。\n\n[architecture-design.md](/workspace/CodeAgent/docs/architecture-design.md:716)",
          type: "message",
        },
      ],
      startedAt: "2026-07-22T07:58:00.000Z",
      status: "completed",
    },
  ],
};

const taskSnapshotResponse = {
  checkpoint: { sequence: 0, sessionId: "e2e-session" },
  snapshot: taskSnapshot,
};

const architectureSourcePreview = Array.from({ length: 720 }, (_, lineIndex) =>
  lineIndex === 715 ? "### 11.7 外部登录边界" : `line ${String(lineIndex + 1)}`,
).join("\n");

test.beforeEach(async ({ page }) => {
  let routedProjects = [...projects];
  let routedTasks = tasks.map((task) => ({ ...task }));
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
  await page.route("**/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const defaultsMatch = /^\/v1\/projects\/([^/]+)\/defaults$/u.exec(url.pathname);
    const settingsMatch = /^\/v1\/projects\/([^/]+)\/tasks\/([^/]+)\/settings$/u.exec(url.pathname);
    const pinMatch = /^\/v1\/projects\/([^/]+)\/tasks\/([^/]+)\/pin$/u.exec(url.pathname);
    const renameMatch = /^\/v1\/projects\/([^/]+)\/tasks\/([^/]+)\/rename$/u.exec(url.pathname);
    const archiveMatch = /^\/v1\/projects\/([^/]+)\/tasks\/([^/]+)\/archive$/u.exec(url.pathname);
    let body: unknown;

    if (url.pathname === "/v1/health") {
      body = { status: "ok", version: 1 };
    } else if (url.pathname === "/v1/capabilities") {
      body = {
        feedback: { upload: true },
        provider: "codex",
        skills: { list: true, use: true },
        tasks: { fork: true, list: true, read: true, start: true },
        turns: { compact: true, interrupt: true, review: true, rollback: true, start: true },
      };
    } else if (url.pathname === "/v1/models") {
      body = { data: models, nextCursor: null };
    } else if (/^\/v1\/projects\/[^/]+\/skills$/u.test(url.pathname)) {
      body = { data: skills, nextCursor: null };
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
    } else if (url.pathname === "/v1/projects" && route.request().method() === "POST") {
      const addedProject = {
        createdAt: "2026-07-25T00:00:00.000Z",
        id: "added-project",
        name: "AddedProject",
        rootPath: "/workspace/AddedProject",
      };
      routedProjects = [...routedProjects, addedProject];
      body = { project: addedProject };
    } else if (url.pathname === "/v1/projects") {
      body = { data: routedProjects, nextCursor: null };
    } else if (url.pathname === "/v1/projects/code-agent/files/source") {
      body = {
        content: architectureSourcePreview,
        path: "docs/architecture-design.md",
        truncated: true,
      };
    } else if (url.pathname === "/v1/projects/code-agent/git/status") {
      body = projectGitStatus;
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
    } else if (url.pathname === "/v1/projects/code-agent/tasks/task-1/feedback") {
      body = { status: "sent", taskId: "task-1" };
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
  });
});

test("redirects the root route to the default project workbench", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByTestId("app-root")).toBeAttached();
  await expect(page).toHaveURL(/\/p\/code-agent$/);
  await expect(page.getByRole("main", { name: "Task Timeline" })).toBeVisible();
});

test("restores the project folder expansion preference after reload", async ({ page }) => {
  await page.goto("/p/code-agent");

  const firstProject = page.getByRole("button", { name: "切换项目 CodeAgent" });
  const secondProject = page.getByRole("button", { name: "切换项目 superwork" });
  await expect(firstProject).toHaveAttribute("aria-expanded", "true");
  await expect(secondProject).toHaveAttribute("aria-expanded", "false");

  await firstProject.click();
  await secondProject.click();
  await expect(firstProject).toHaveAttribute("aria-expanded", "false");
  await expect(secondProject).toHaveAttribute("aria-expanded", "true");

  await page.reload();

  await expect(firstProject).toHaveAttribute("aria-expanded", "false");
  await expect(secondProject).toHaveAttribute("aria-expanded", "true");
});

test("provides reusable design tokens for light and dark themes", async ({ page }) => {
  await page.goto("/p/code-agent");
  const readTheme = async (theme: "dark" | "light") =>
    page.locator("html").evaluate((root, activeTheme) => {
      root.setAttribute("data-theme", activeTheme);

      // 通过真实 CSS 解析值校验主题，而不是绑定变量的文本写法。
      const resolveColor = (token: string) => {
        const probe = document.createElement("span");
        probe.style.color = `var(${token})`;
        root.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
      };
      const styles = getComputedStyle(root);

      return {
        accent: resolveColor("--ui-color-accent"),
        bodyFontSize: styles.getPropertyValue("--ui-font-size-body").trim(),
        diffAdded: resolveColor("--ui-color-diff-added"),
        diffRemoved: resolveColor("--ui-color-diff-removed"),
        ink: resolveColor("--ui-color-text"),
        skill: resolveColor("--ui-color-skill"),
        spaceUnit: styles.getPropertyValue("--ui-space-unit").trim(),
        surface: styles.backgroundColor,
      };
    }, theme);

  expect(await readTheme("light")).toEqual({
    accent: "rgb(0, 106, 255)",
    bodyFontSize: expect.stringMatching(/^0?\.875rem$/),
    diffAdded: "rgb(40, 169, 72)",
    diffRemoved: "rgb(235, 0, 29)",
    ink: "rgb(23, 23, 23)",
    skill: "rgb(161, 0, 248)",
    spaceUnit: expect.stringMatching(/^0?\.25rem$/),
    surface: "rgb(255, 255, 255)",
  });

  expect(await readTheme("dark")).toEqual({
    accent: "rgb(51, 156, 255)",
    bodyFontSize: expect.stringMatching(/^0?\.875rem$/),
    diffAdded: "rgb(64, 201, 119)",
    diffRemoved: "rgb(250, 66, 62)",
    ink: "rgb(255, 255, 255)",
    skill: "rgb(173, 123, 249)",
    spaceUnit: expect.stringMatching(/^0?\.25rem$/),
    surface: "rgb(24, 24, 24)",
  });
});

test("exposes the documented navigation routes", async ({ page }) => {
  const routes = [
    { path: "/p/code-agent", heading: "CodeAgent" },
    { path: "/p/code-agent/t/task-1", heading: "构建 macOS 工作台" },
    { path: "/settings", heading: "设置" },
  ];

  for (const route of routes) {
    await page.goto(route.path);
    await expect(
      page.getByRole("main").getByRole("heading", { name: route.heading }),
    ).toBeVisible();
  }
});

test("drags project folders to reorder and restores the persisted order", async ({ page }) => {
  await page.goto("/p/code-agent");
  const codeAgentProject = page.getByRole("button", { name: "切换项目 CodeAgent" });
  const superworkProject = page.getByRole("button", { name: "切换项目 superwork" });
  await codeAgentProject.click();

  const codeAgentBounds = await codeAgentProject.boundingBox();
  const superworkBounds = await superworkProject.boundingBox();
  if (codeAgentBounds === null || superworkBounds === null) {
    throw new Error("Project rows are not visible");
  }
  const reorderRequest = page.waitForRequest(
    (request) => request.url().endsWith("/v1/projects/order") && request.method() === "PUT",
  );
  await page.mouse.move(
    codeAgentBounds.x + codeAgentBounds.width / 2,
    codeAgentBounds.y + codeAgentBounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    codeAgentBounds.x + codeAgentBounds.width / 2 + 12,
    codeAgentBounds.y + codeAgentBounds.height / 2,
  );
  await expect(codeAgentProject.locator("xpath=..").locator("xpath=..")).toHaveAttribute(
    "data-project-reordering",
    "true",
  );
  await page.mouse.move(
    superworkBounds.x + superworkBounds.width / 2,
    superworkBounds.y + superworkBounds.height * 0.75,
    { steps: 4 },
  );
  await page.mouse.up();

  expect(parseProjectOrderRequest((await reorderRequest).postData())).toEqual([
    "superwork",
    "code-agent",
  ]);
  await expect
    .poll(() =>
      page
        .locator("[data-project-reorder-id]")
        .evaluateAll((elements) =>
          elements.map((element) => element.getAttribute("data-project-reorder-id")),
        ),
    )
    .toEqual(["superwork", "code-agent"]);

  await page.reload();
  await expect
    .poll(() =>
      page
        .locator("[data-project-reorder-id]")
        .evaluateAll((elements) =>
          elements.map((element) => element.getAttribute("data-project-reorder-id")),
        ),
    )
    .toEqual(["superwork", "code-agent"]);

  const keyboardRequest = page.waitForRequest(
    (request) => request.url().endsWith("/v1/projects/order") && request.method() === "PUT",
  );
  await page.getByRole("button", { name: "切换项目 CodeAgent" }).press("Alt+ArrowUp");
  expect(parseProjectOrderRequest((await keyboardRequest).postData())).toEqual([
    "code-agent",
    "superwork",
  ]);
});

test("removes the legacy workspace routes", async ({ page }) => {
  for (const path of ["/login", "/workspaces", "/w/demo", "/w/demo/t/thread-1"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "页面不存在" })).toBeVisible();
  }
});

test("directs unavailable Runtime users to the official Codex CLI", async ({ page }) => {
  let modelRequestCount = 0;
  await page.route("**/v1/models", async (route) => {
    modelRequestCount += 1;
    await route.fulfill({
      contentType: "application/json",
      json: { message: "Provider unavailable" },
      status: 503,
    });
  });

  await page.goto("/p/code-agent");

  await expect(page.getByRole("heading", { name: "Codex Runtime 不可用" })).toBeVisible();
  await expect(page.getByText("codex login", { exact: true })).toBeVisible();

  const requestCountBeforeRetry = modelRequestCount;
  await page.getByRole("button", { name: "重试" }).click();
  await expect.poll(() => modelRequestCount).toBeGreaterThan(requestCountBeforeRetry);
});

test("keeps a healthy project usable when another project task query fails", async ({ page }) => {
  let failedProjectRequestCount = 0;
  await page.route("**/v1/projects/superwork/tasks?*", async (route) => {
    failedProjectRequestCount += 1;
    await route.fulfill({
      contentType: "application/json",
      json: { message: "Project unavailable" },
      status: 503,
    });
  });

  await page.goto("/p/code-agent/t/task-1");

  await expect.poll(() => failedProjectRequestCount).toBe(2);
  await expect(page.getByRole("heading", { name: "构建 macOS 工作台" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Codex Runtime 不可用" })).toHaveCount(0);
});

test("renders skills from a reopened task history", async ({ page }) => {
  await page.goto("/p/code-agent/t/task-1");

  const historicalSkill = page.locator('[data-message-skill="review-security"]');
  await expect(historicalSkill).toContainText("$review-security");
  await expect(historicalSkill).toHaveCSS("color", "rgb(161, 0, 248)");
  await expect(page.getByText("完成 macOS 原生风格的三栏工作台页面。")).toBeVisible();
});

test("uses subtle hairline separation across registered routes", async ({ page }) => {
  const surfaces = [
    {
      path: "/p/code-agent",
      selector: "main header",
      border: "borderBottomWidth",
      offset: "0px 1px 0px 0px",
    },
    {
      path: "/settings",
      selector: "aside",
      border: "borderRightWidth",
      offset: "1px 0px 0px 0px",
    },
  ] as const;

  for (const surface of surfaces) {
    await page.goto(surface.path);
    await page.locator("html").evaluate((root) => {
      root.setAttribute("data-theme", "light");
    });
    const styles = await page.locator(surface.selector).evaluate((element, border) => {
      const computed = getComputedStyle(element);
      return {
        borderWidth: computed[border],
        boxShadow: computed.boxShadow,
      };
    }, surface.border);

    expect(styles.borderWidth).toBe("0px");
    expect(styles.boxShadow).toContain("rgba(23, 23, 23, 0.06)");
    expect(styles.boxShadow).toContain(surface.offset);
  }
});

test("aligns the center toolbar divider with sidebar controls", async ({ page }) => {
  await page.goto("/p/code-agent/t/task-1");

  const mainHeader = page.getByRole("main", { name: "Task Timeline" }).locator(":scope > header");
  const leftTitle = page.getByRole("link", { name: "CodeAgent 首页" });
  const centerTitle = page.getByRole("heading", { name: "构建 macOS 工作台", level: 1 });
  const rightTitle = page.getByRole("heading", { name: "环境信息", level: 2 });
  const search = page.getByRole("textbox", { name: "搜索任务" });
  const tabs = page.getByRole("tablist");
  const [mainHeaderBox, leftTitleBox, centerTitleBox, rightTitleBox, searchBox, tabsBox] =
    await Promise.all([
      mainHeader.boundingBox(),
      leftTitle.boundingBox(),
      centerTitle.boundingBox(),
      rightTitle.boundingBox(),
      search.boundingBox(),
      tabs.boundingBox(),
    ]);

  expect(mainHeaderBox).not.toBeNull();
  expect(leftTitleBox).not.toBeNull();
  expect(centerTitleBox).not.toBeNull();
  expect(rightTitleBox).not.toBeNull();
  expect(searchBox).not.toBeNull();
  expect(tabsBox).not.toBeNull();
  if (
    mainHeaderBox === null ||
    leftTitleBox === null ||
    centerTitleBox === null ||
    rightTitleBox === null ||
    searchBox === null ||
    tabsBox === null
  ) {
    return;
  }

  // 三栏标题行共用同一个垂直中心，避免文字和图标上下错位。
  const centerTitlePosition = centerTitleBox.y + centerTitleBox.height / 2;
  expect(leftTitleBox.y + leftTitleBox.height / 2).toBe(centerTitlePosition);
  expect(rightTitleBox.y + rightTitleBox.height / 2).toBe(centerTitlePosition);

  // 中栏分隔线与左右栏第二层控件顶部共用同一水平基线。
  const dividerPosition = mainHeaderBox.y + mainHeaderBox.height;
  expect(dividerPosition).toBe(searchBox.y);
  expect(dividerPosition).toBe(tabsBox.y);
});

test("renders the AI workbench landmarks with an enabled composer", async ({ page }) => {
  await page.goto("/p/code-agent/t/task-1");

  const main = page.getByRole("main", { name: "Task Timeline" });
  const inspector = page.getByRole("complementary", { name: "Context Inspector" });
  await expect(page.getByRole("complementary", { name: "Project Sidebar" })).toBeVisible();
  await expect(main).toBeVisible();
  await expect(inspector).toBeVisible();
  await expect(page.getByRole("heading", { name: "环境信息" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Composer" })).toBeVisible();
  const prompt = page.getByRole("textbox", { name: "任务输入" });
  const approvalSelect = page.getByRole("combobox", { name: "批准模式" });
  const compactSelects = [
    approvalSelect,
    page.getByRole("combobox", { name: "选择模型" }),
    page.getByRole("combobox", { name: "选择思考量" }),
  ];
  await expect(prompt).toBeEnabled();
  await expect(approvalSelect).toHaveValue("on-request");
  for (const select of compactSelects) {
    await expect(select).toHaveCSS("appearance", "none");
    await expect
      .poll(() => select.evaluate((element) => getComputedStyle(element).fieldSizing))
      .toBe("content");
  }
  const composerForm = page.getByRole("region", { name: "Composer" }).locator("form");
  const composerControls = [
    prompt,
    page.getByRole("button", { name: "添加图片" }),
    ...compactSelects,
  ];
  for (const control of composerControls) {
    await control.focus();
    // 内部控件不重复绘制主色焦点框，焦点状态统一由 Composer 外框表达。
    await expect(control).toHaveCSS("outline-style", "none");
    await expect(composerForm).toHaveCSS("border-color", "rgb(0, 106, 255)");
  }
  await expect(page.getByText("本地", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { exact: true, name: "提交" })).toBeDisabled();
  await prompt.fill("继续当前任务");
  await expect(page.getByRole("button", { exact: true, name: "提交" })).toBeEnabled();
  await expect(main.locator("header").getByText("CodeAgent", { exact: true })).toHaveCount(0);
  await expect(page.getByText("本地离线", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("项目路径")).toHaveText("~/Develop/person/CodeAgent");
  const contextUsageButton = page.getByRole("button", { name: "上下文已使用 13%" });
  await expect(contextUsageButton).toBeVisible();
  await expect(contextUsageButton.locator("circle")).toHaveCount(2);
  await expect(contextUsageButton).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await contextUsageButton.hover();
  const contextUsageTooltip = page.getByRole("tooltip");
  await expect(contextUsageTooltip).toContainText("13% 上下文已使用");
  await expect(contextUsageTooltip).toContainText("25K / 200K tokens");
  await expect(inspector.getByRole("button", { name: "关闭上下文面板" })).toHaveCount(0);
  await expect(page.getByText("工作台界面已按统一的 AI Elements 结构重新组织。")).toBeVisible();
});

test("renders real environment and sources in inspector", async ({ page }) => {
  await page.goto("/p/code-agent/t/task-1");

  const inspector = page.getByRole("complementary", { name: "Context Inspector" });
  await inspector.getByRole("tab", { name: "上下文" }).click();
  const environment = inspector.getByRole("region", { name: "环境" });
  const sources = inspector.getByRole("region", { name: "来源" });

  await expect(environment.getByText("gpt-5.6-sol", { exact: true })).toBeVisible();
  await expect(environment.getByText("高", { exact: true })).toBeVisible();
  await expect(environment.getByText("按需审批", { exact: true })).toBeVisible();
  await expect(environment.getByText("工作区可写", { exact: true })).toBeVisible();
  await expect(environment.getByText("~/Develop/person/CodeAgent", { exact: true })).toBeVisible();
  await expect(environment.getByText("feat/review-targets", { exact: true })).toBeVisible();
  await expect(sources.getByText("Security review", { exact: true })).toBeVisible();
  await expect(sources.getByText("项目目录", { exact: true })).toBeVisible();
  await expect(inspector.getByText("This Mac", { exact: true })).toHaveCount(0);
  await expect(inspector.getByText("AI Elements", { exact: true })).toHaveCount(0);
  await expect(inspector.getByRole("button", { name: "添加来源" })).toHaveCount(0);
});

test("keeps Projects fixed and manages task actions from the compact tree", async ({ page }) => {
  await page.goto("/p/code-agent/t/task-1");

  const sidebar = page.getByRole("complementary", { name: "Project Sidebar" });
  const projectsHeading = sidebar.getByRole("heading", { name: "Projects" });
  const pinnedHeading = sidebar.getByRole("heading", { name: "Pinned" });
  const projectTree = page.getByTestId("project-tree-scroll");
  const projectGroup = sidebar
    .getByRole("button", { name: "切换项目 CodeAgent" })
    .locator("xpath=../..");

  await expect(projectsHeading).toBeVisible();
  await expect
    .poll(async () =>
      Number.parseFloat(await projectsHeading.evaluate((node) => getComputedStyle(node).fontSize)),
    )
    .toBeGreaterThan(
      Number.parseFloat(await pinnedHeading.evaluate((node) => getComputedStyle(node).fontSize)),
    );
  const headingY = (await projectsHeading.boundingBox())?.y;
  await projectTree.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  expect((await projectsHeading.boundingBox())?.y).toBe(headingY);

  await expect(projectGroup.getByRole("link")).toHaveCount(5);
  const showMoreButton = projectGroup.getByRole("button", { name: "显示更多" });
  const showMoreBox = await showMoreButton.boundingBox();
  const taskListBox = await showMoreButton.locator("xpath=..").boundingBox();
  expect(showMoreBox).not.toBeNull();
  expect(taskListBox).not.toBeNull();
  if (showMoreBox === null || taskListBox === null) {
    throw new Error("项目任务展开按钮缺失");
  }
  expect
    .soft(Math.abs(showMoreBox.x + showMoreBox.width - (taskListBox.x + taskListBox.width)))
    .toBeLessThanOrEqual(1);
  await showMoreButton.click();
  await expect(projectGroup.getByRole("link")).toHaveCount(7);

  const inputTask = projectGroup.getByRole("link", { name: /优化输入框交互/u });
  const inputTaskBox = await inputTask.boundingBox();
  const inputTaskAgeBox = await inputTask.locator(".task-age").boundingBox();
  expect(inputTaskBox).not.toBeNull();
  expect(inputTaskAgeBox).not.toBeNull();
  if (inputTaskBox === null || inputTaskAgeBox === null) {
    throw new Error("Task 时间布局缺失");
  }
  expect
    .soft(
      Math.abs(inputTaskBox.x + inputTaskBox.width - (inputTaskAgeBox.x + inputTaskAgeBox.width)),
    )
    .toBeLessThanOrEqual(10);
  await inputTask.hover();
  await projectGroup.getByRole("button", { name: "打开 优化输入框交互 的操作菜单" }).click();
  await page.getByRole("menuitem", { name: "固定" }).click();
  const pinnedSection = pinnedHeading.locator("xpath=..");
  const pinnedInputTask = pinnedSection.getByRole("link", { name: /优化输入框交互/u });
  await expect(pinnedInputTask).toBeVisible();
  await pinnedInputTask.hover();
  const pinnedMenuTrigger = pinnedSection.getByRole("button", {
    name: "打开 优化输入框交互 的操作菜单",
  });
  await pinnedMenuTrigger.click();
  const pinnedMenu = page.getByRole("menu", { name: "优化输入框交互 的任务操作" });
  await expect(pinnedMenu).toBeVisible();
  const pinnedMenuTriggerBox = await pinnedMenuTrigger.boundingBox();
  const pinnedMenuBox = await pinnedMenu.boundingBox();
  expect(pinnedMenuTriggerBox).not.toBeNull();
  expect(pinnedMenuBox).not.toBeNull();
  if (pinnedMenuTriggerBox === null || pinnedMenuBox === null) {
    throw new Error("Pinned Task 菜单布局缺失");
  }
  expect.soft(Math.abs(pinnedMenuBox.x - pinnedMenuTriggerBox.x)).toBeLessThanOrEqual(1);
  await pinnedMenu.getByRole("menuitem", { name: "重命名" }).click();
  await page.getByRole("textbox", { name: "任务名称" }).fill("优化侧栏任务操作");
  await page.getByRole("button", { name: "保存" }).click();
  await expect(projectGroup.getByText("优化侧栏任务操作", { exact: true })).toBeVisible();

  const activeTask = projectGroup.getByRole("link", { name: /构建 macOS 工作台/u });
  await activeTask.hover();
  await projectGroup.getByRole("button", { name: "打开 构建 macOS 工作台 的操作菜单" }).click();
  await page.getByRole("menuitem", { name: "归档" }).click();
  await expect(page).toHaveURL(/\/p\/code-agent$/u);
  await expect(projectGroup.getByText("构建 macOS 工作台", { exact: true })).toHaveCount(0);
});

test("restores task settings after a page refresh", async ({ page }) => {
  await page.goto("/p/code-agent/t/task-1");

  const modelSelect = page.getByRole("combobox", { name: "选择模型" });
  const reasoningSelect = page.getByRole("combobox", { name: "选择思考量" });
  const approvalSelect = page.getByRole("combobox", { name: "批准模式" });
  await Promise.all([
    page.waitForResponse(
      (response) => response.url().endsWith("/tasks/task-1/settings") && response.ok(),
    ),
    modelSelect.selectOption("gpt-5.6-terra"),
  ]);
  await Promise.all([
    page.waitForResponse(
      (response) => response.url().endsWith("/tasks/task-1/settings") && response.ok(),
    ),
    reasoningSelect.selectOption("low"),
  ]);
  await Promise.all([
    page.waitForResponse(
      (response) => response.url().endsWith("/tasks/task-1/settings") && response.ok(),
    ),
    approvalSelect.selectOption("auto-review"),
  ]);

  await page.reload();

  await expect(page.getByRole("combobox", { name: "选择模型" })).toHaveValue("gpt-5.6-terra");
  await expect(page.getByRole("combobox", { name: "选择思考量" })).toHaveValue("low");
  await expect(page.getByRole("combobox", { name: "批准模式" })).toHaveValue("auto-review");
});

test("restores project defaults without inheriting task approval", async ({ page }) => {
  await page.goto("/p/code-agent");

  const modelSelect = page.getByRole("combobox", { name: "选择模型" });
  const reasoningSelect = page.getByRole("combobox", { name: "选择思考量" });
  const approvalSelect = page.getByRole("combobox", { name: "批准模式" });
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/defaults") && response.ok()),
    modelSelect.selectOption("gpt-5.6-terra"),
  ]);
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/defaults") && response.ok()),
    reasoningSelect.selectOption("low"),
  ]);
  await approvalSelect.selectOption("never");

  await page.reload();

  await expect(page.getByRole("combobox", { name: "选择模型" })).toHaveValue("gpt-5.6-terra");
  await expect(page.getByRole("combobox", { name: "选择思考量" })).toHaveValue("low");
  await expect(page.getByRole("combobox", { name: "批准模式" })).toHaveValue("on-request");
});

test("runs official task actions from the slash command menu", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const commandRequests: { body: string | null; path: string }[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      request.method() === "POST" &&
      url.pathname.startsWith("/v1/projects/code-agent/tasks/task-1/")
    ) {
      commandRequests.push({ body: request.postData(), path: url.pathname });
    }
  });
  await page.goto("/p/code-agent/t/task-1");

  const historicalSkill = page.locator('[data-message-skill="review-security"]');
  const historicalInlineOffset = await historicalSkill.evaluate((token) => {
    const labelText = token.lastElementChild?.firstChild;
    const messageText = token.parentElement?.parentElement?.querySelector("p")?.firstChild;
    if (!(labelText instanceof Text) || !(messageText instanceof Text)) {
      throw new Error("Expected inline skill and message text nodes");
    }
    const labelRange = document.createRange();
    labelRange.selectNodeContents(labelText);
    const messageRange = document.createRange();
    messageRange.selectNodeContents(messageText);
    return labelRange.getBoundingClientRect().top - messageRange.getBoundingClientRect().top;
  });
  expect(historicalInlineOffset).toBe(0);

  const prompt = page.getByRole("textbox", { name: "任务输入" });
  await prompt.fill("");
  await prompt.fill("/");
  const commandMenu = page.getByRole("listbox", { name: "输入命令" });
  await expect(commandMenu).toBeVisible();
  expect(await commandMenu.evaluate((menu) => menu.closest("form") === null)).toBe(true);
  await expect(commandMenu.getByRole("option")).toHaveCount(8);
  await expect(commandMenu.getByRole("option", { name: /代码审查/u })).toHaveAttribute(
    "data-active",
    "true",
  );
  await expect(commandMenu.getByRole("option", { name: /Documentation writer/u })).toBeVisible();
  await prompt.press("Escape");
  await expect(commandMenu).toBeHidden();
  await expect(page.getByRole("button", { name: "收起项目侧栏" })).toBeVisible();
  await expect(page.getByRole("button", { name: "收起上下文面板" })).toBeVisible();

  await prompt.fill("");
  await prompt.fill("/");
  await expect(commandMenu).toBeVisible();
  await page.getByRole("main", { name: "Task Timeline" }).click({ position: { x: 10, y: 10 } });
  await expect(commandMenu).toBeHidden();

  await prompt.fill("");
  await prompt.fill("/");
  await expect(commandMenu).toBeVisible();
  const skillDescription = commandMenu.getByText(/review-security/u);
  await expect
    .poll(() =>
      skillDescription.evaluate((element) => {
        const style = getComputedStyle(element);
        return [style.overflow, style.textOverflow, style.whiteSpace];
      }),
    )
    .toEqual(["hidden", "ellipsis", "nowrap"]);
  for (const label of ["初始化", "副任务", "压缩", "反馈", "复制"]) {
    await expect(commandMenu.getByRole("option", { name: new RegExp(label, "u") })).toBeVisible();
  }

  const commandList = commandMenu.locator("[data-prompt-input-command-list]");
  for (let movementIndex = 0; movementIndex < 7; movementIndex += 1) {
    await prompt.press("ArrowDown");
  }
  await expect(commandMenu.getByRole("option", { name: /Documentation writer/u })).toHaveAttribute(
    "data-active",
    "true",
  );
  await expect.poll(() => commandList.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

  await prompt.fill("说明/security");
  await expect(commandMenu).toBeHidden();
  await prompt.fill("说明 /security");
  await expect(commandMenu).toBeVisible();
  await prompt.press("Enter");
  const selectedSkill = prompt.locator('[data-prompt-skill-id="skill-security"]');
  await expect(selectedSkill).toContainText("Security review");
  await expect(selectedSkill).toHaveAttribute("data-serialized-text", "$review-security");
  await expect(prompt).toHaveAttribute("data-serialized-value", "说明 $review-security");
  const editorBaselineOffset = await selectedSkill.evaluate((token) => {
    const labelText = token.lastElementChild?.firstChild;
    const adjacentText = token.previousSibling;
    if (!(labelText instanceof Text) || !(adjacentText instanceof Text)) {
      throw new Error("Expected adjacent editor text nodes");
    }
    const labelRange = document.createRange();
    labelRange.selectNodeContents(labelText);
    const textRange = document.createRange();
    textRange.selectNodeContents(adjacentText);
    return labelRange.getBoundingClientRect().top - textRange.getBoundingClientRect().top;
  });
  expect(editorBaselineOffset).toBe(0);
  await page.keyboard.type(" /documentation");
  await expect(commandMenu).toBeVisible();
  await prompt.press("Enter");
  const selectedDocumentationSkill = prompt.locator('[data-prompt-skill-id="skill-docs"]');
  await expect(selectedDocumentationSkill).toContainText("Documentation writer");
  await expect(prompt).toHaveAttribute(
    "data-serialized-value",
    "说明 $review-security $documentation-writer",
  );
  await prompt.press("Meta+a");
  await prompt.press("Meta+c");
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe("说明 $review-security $documentation-writer");
  const skillColors = await selectedSkill.evaluate((element) => {
    const probe = document.createElement("span");
    probe.style.color = "var(--ui-color-skill)";
    document.body.append(probe);
    const colors = {
      expected: getComputedStyle(probe).color,
      selected: getComputedStyle(element).color,
    };
    probe.remove();
    return colors;
  });
  expect(skillColors.selected).toBe(skillColors.expected);
  await selectedSkill.click();
  await expect(selectedSkill).toBeHidden();
  await expect(selectedDocumentationSkill).toBeVisible();
  await prompt.focus();
  await prompt.press("End");
  await prompt.press("Backspace");
  await expect(selectedDocumentationSkill).toBeHidden();

  await prompt.fill("/压缩");
  await prompt.press("Enter");
  await expect(page.getByRole("status")).toContainText("正在压缩上下文");
  await expect
    .poll(() => commandRequests.map((request) => request.path))
    .toContain("/v1/projects/code-agent/tasks/task-1/compact");

  await prompt.fill("/反馈");
  await prompt.press("Enter");
  await expect(page.getByRole("button", { name: "取消反馈" })).toBeVisible();
  await prompt.fill("Slash 命令操作顺畅");
  await page.getByRole("button", { exact: true, name: "提交" }).click();
  await expect(page.getByRole("status")).toContainText("反馈已发送");
  await expect
    .poll(() => commandRequests.find((request) => request.path.endsWith("/feedback"))?.body)
    .toContain("Slash 命令操作顺畅");

  await page.setViewportSize({ width: 390, height: 844 });
  await prompt.fill("/");
  await expect(page.getByRole("listbox", { name: "输入命令" })).toBeVisible();
  const viewportMetrics = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(viewportMetrics.documentWidth).toBeLessThanOrEqual(viewportMetrics.viewportWidth);

  await prompt.fill("/复制");
  await prompt.press("Enter");
  await expect(page).toHaveURL(/\/p\/code-agent\/t\/task-2$/u);
  await expect
    .poll(() => commandRequests.map((request) => request.path))
    .toContain("/v1/projects/code-agent/tasks/task-1/fork");
});

test("从最新 AI 回复复制任务", async ({ page }) => {
  const forkRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (request.method() === "POST" && url.pathname.endsWith("/fork")) {
      forkRequests.push(url.pathname);
    }
  });
  await page.goto("/p/code-agent/t/task-1");

  const latestReply = page
    .locator('article[data-role="assistant"]')
    .filter({ hasText: "工作台界面已按统一的 AI Elements 结构重新组织。" });
  await expect(latestReply.getByRole("button", { name: "复制消息" })).toBeVisible();
  await expect(latestReply.getByRole("button", { name: "复制任务" })).toBeVisible();

  await latestReply.getByRole("button", { name: "复制任务" }).click();

  await expect.poll(() => forkRequests).toContain("/v1/projects/code-agent/tasks/task-1/fork");
  await expect(page).toHaveURL(/\/p\/code-agent\/t\/task-2$/u);
});

test("starts code review from a new chat with one fixed review message", async ({ page }) => {
  const reviewTask = {
    id: "review-task",
    pinned: false,
    projectId: "code-agent",
    title: "新聊天",
    updatedAt: "2026-07-29T00:00:00.000Z",
  };
  const reviewTurn = {
    completedAt: null,
    error: null,
    id: "review-turn",
    items: [
      {
        id: "review-mode-review-turn",
        target: { type: "uncommitted_changes" },
        type: "review",
      },
    ],
    startedAt: "2026-07-29T00:00:00.000Z",
    status: "running",
  };
  const mutationPaths: string[] = [];
  const reviewBodies: unknown[] = [];
  await page.route("**/v1/projects/code-agent/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "POST") {
      mutationPaths.push(url.pathname);
    }
    if (url.pathname === "/v1/projects/code-agent/tasks" && request.method() === "POST") {
      await route.fulfill({ contentType: "application/json", json: { task: reviewTask } });
      return;
    }
    if (
      url.pathname === "/v1/projects/code-agent/tasks/review-task/review" &&
      request.method() === "POST"
    ) {
      reviewBodies.push(request.postDataJSON());
      await route.fulfill({
        contentType: "application/json",
        json: { taskId: reviewTask.id, turn: reviewTurn },
      });
      return;
    }
    if (url.pathname === "/v1/projects/code-agent/tasks/review-task") {
      await route.fulfill({
        contentType: "application/json",
        json: {
          checkpoint: { sequence: 0, sessionId: "review-session" },
          snapshot: {
            ...reviewTask,
            contextUsage: null,
            pendingRequests: [],
            settings: taskSnapshot.settings,
            status: "running",
            turns: [reviewTurn],
          },
        },
      });
      return;
    }
    await route.fallback();
  });
  await page.goto("/p/code-agent");

  const prompt = page.getByRole("textbox", { name: "任务输入" });
  await prompt.fill("/");
  await page.getByRole("option", { name: /代码审查/u }).click();
  await expect(page.getByRole("group", { name: "选择审查范围" })).toBeVisible();
  await expect(page.getByRole("option", { name: /审查未提交的更改/u })).toBeVisible();
  await expect(page.getByRole("option", { name: /基于基础分支进行审查/u })).toContainText(
    "origin/main",
  );
  expect(mutationPaths).toEqual([]);
  await prompt.fill("重新选择 /初始化");
  await expect(page.getByRole("group", { name: "选择审查范围" })).toBeHidden();
  await expect(page.getByRole("option", { name: /初始化/u })).toBeVisible();
  await prompt.fill("/");
  await page.getByRole("option", { name: /代码审查/u }).click();
  await page.getByRole("option", { name: /审查未提交的更改/u }).click();

  await expect(page).toHaveURL(/\/p\/code-agent\/t\/review-task$/u);
  await expect(page.getByText("请检查我未提交的更改", { exact: true })).toHaveCount(1);
  await expect(page.getByText("审查模式", { exact: true })).toBeVisible();
  await expect(page.getByText(/Review the current code changes/u)).toHaveCount(0);
  await expect
    .poll(() => mutationPaths)
    .toEqual(["/v1/projects/code-agent/tasks", "/v1/projects/code-agent/tasks/review-task/review"]);
  expect(reviewBodies).toEqual([{ target: { type: "uncommitted_changes" } }]);
});

test("selects a real base branch before starting code review", async ({ page }) => {
  const reviewBodies: unknown[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/v1/projects/code-agent/tasks/task-1/review"
    ) {
      reviewBodies.push(request.postDataJSON());
    }
  });
  await page.goto("/p/code-agent/t/task-1");

  const prompt = page.getByRole("textbox", { name: "任务输入" });
  await prompt.fill("/代码审查");
  await prompt.press("Enter");
  await prompt.press("ArrowDown");
  await prompt.press("Enter");

  const branchGroup = page.getByRole("group", { name: "选择基础分支" });
  await expect(branchGroup).toBeVisible();
  await expect(branchGroup.getByRole("option")).toHaveCount(3);
  await branchGroup.getByRole("option", { name: "release" }).click();

  await expect
    .poll(() => reviewBodies)
    .toEqual([{ target: { branch: "release", type: "base_branch" } }]);
});

test("opens bounded source previews from assistant file references", async ({ context, page }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/p/code-agent/t/task-1");

  const sourceReference = page.getByRole("button", {
    name: /architecture-design\.md\s+\(line 716\)/u,
  });
  await sourceReference.click();

  const dialog = page.getByRole("dialog", { name: "architecture-design.md (line 716)" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("内容已截断")).toBeVisible();
  await expect(dialog.locator('[data-language="markdown"]')).toBeVisible();
  const highlightedLine = dialog.locator('[data-code-line="716"]');
  await expect(highlightedLine).toContainText("### 11.7 外部登录边界");
  await expect(highlightedLine).toHaveAttribute("data-highlighted", "true");
  await expect(highlightedLine).toBeInViewport();

  await dialog.getByRole("button", { name: "复制代码" }).click();
  await expect(dialog.getByRole("button", { name: "代码已复制" })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(architectureSourcePreview);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await sourceReference.click();
  await expect(dialog).toBeVisible();
  await page.mouse.click(1, 1);
  await expect(dialog).toBeHidden();
});

test("submits attachments, approval policy, model, and reasoning effort through the real client contract", async ({
  page,
}) => {
  let uploadBody: unknown;
  let turnBody: unknown;
  await page.route("**/v1/projects/code-agent/attachments", async (route) => {
    uploadBody = route.request().postDataJSON();
    await route.fulfill({
      contentType: "application/json",
      json: {
        attachment: {
          id: "attachment-1",
          mediaType: "image/png",
          name: "screen.png",
          size: 68,
        },
      },
      status: 201,
    });
  });
  await page.route("**/v1/projects/code-agent/tasks/task-1/turns", async (route) => {
    turnBody = route.request().postDataJSON();
    await route.fulfill({
      contentType: "application/json",
      json: {
        taskId: "task-1",
        turn: {
          completedAt: null,
          error: null,
          id: "turn-attachment",
          items: [],
          startedAt: "2026-07-24T00:00:00.000Z",
          status: "running",
        },
      },
      status: 201,
    });
  });
  await page.goto("/p/code-agent/t/task-1");

  const modelSelect = page.getByRole("combobox", { name: "选择模型" });
  await expect(modelSelect).toHaveValue("gpt-5.6-sol");
  await expect(modelSelect.locator("option")).toHaveText(["GPT-5.6 Sol", "GPT-5.6 Terra"]);
  await modelSelect.selectOption("gpt-5.6-terra");
  const reasoningSelect = page.getByRole("combobox", { name: "选择思考量" });
  await expect(reasoningSelect).toHaveValue("medium");
  await expect(reasoningSelect.locator("option")).toHaveText(["低", "中"]);
  await reasoningSelect.selectOption("low");
  const approvalSelect = page.getByRole("combobox", { name: "批准模式" });
  const sandboxSelect = page.getByRole("combobox", { name: "沙盒模式" });
  await expect(approvalSelect.locator("xpath=following-sibling::select[1]")).toHaveAttribute(
    "aria-label",
    "沙盒模式",
  );
  await approvalSelect.selectOption("auto-review");
  await sandboxSelect.selectOption("danger-full-access");
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "添加图片" }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
    mimeType: "image/png",
    name: "screen.png",
  });
  await expect(page.getByText("screen.png", { exact: true })).toBeVisible();
  const prompt = page.getByRole("textbox", { name: "任务输入" });
  await prompt.fill("/security");
  await prompt.press("Enter");
  await expect(prompt.locator('[data-prompt-skill-id="skill-security"]')).toBeVisible();
  await page.keyboard.type(" /documentation");
  await prompt.press("Enter");
  await expect(prompt.locator('[data-prompt-skill-id="skill-docs"]')).toBeVisible();
  await page.keyboard.type(" 按截图完成改造");
  await page.getByRole("button", { exact: true, name: "提交" }).click();

  await expect(prompt).toHaveAttribute("data-serialized-value", "");
  await expect(prompt.locator("[data-prompt-skill-id]")).toHaveCount(0);
  await expect(page.getByText("screen.png", { exact: true })).toHaveCount(0);
  await expect(page.locator('[data-message-skill="documentation-writer"]')).toBeVisible();
  expect(uploadBody).toMatchObject({
    dataUrl: expect.stringMatching(/^data:image\/png;base64,/),
    name: "screen.png",
  });
  expect(turnBody).toEqual({
    input: {
      attachments: [{ id: "attachment-1" }],
      skills: [
        { id: "skill-security", name: "review-security" },
        { id: "skill-docs", name: "documentation-writer" },
      ],
      text: "按截图完成改造",
      type: "prompt",
    },
    options: {
      approvalPolicy: "on-request",
      approvalsReviewer: "auto_review",
      model: "gpt-5.6-terra",
      reasoningEffort: "low",
      sandboxMode: "danger-full-access",
    },
  });
});

test("opens file diffs from the timeline and inspector", async ({ page }) => {
  const consoleErrors: string[] = [];
  const failedResources: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      failedResources.push(response.url());
    }
  });
  await page.goto("/p/code-agent/t/task-1");

  await page.getByRole("button", { name: /已编辑 package\.json.*打开 Diff/ }).click();
  const dialog = page.getByRole("dialog", { name: "package.json" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".file-diff-renderer")).toContainText("pnpm run dev");
  await expect(dialog.locator(".file-diff-renderer")).toContainText("node ./dist/cli.js");
  await page.getByRole("button", { name: "关闭文件 Diff" }).click();
  await expect(dialog).not.toBeAttached();

  await page.getByRole("button", { name: "打开 未暂存文件 package.json 的 Diff" }).click();
  await expect(page.getByRole("dialog", { name: "package.json" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "package.json" })).not.toBeAttached();
  expect({ consoleErrors, failedResources }).toEqual({ consoleErrors: [], failedResources: [] });
});

test("disables composer mutations that the provider does not support", async ({ page }) => {
  await page.route("**/v1/capabilities", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        feedback: { upload: false },
        provider: "readonly",
        skills: { list: false, use: false },
        tasks: { fork: false, list: true, read: true, start: false },
        turns: {
          compact: false,
          interrupt: false,
          review: false,
          rollback: false,
          start: false,
        },
      },
    });
  });
  await page.goto("/p/code-agent");

  await page.getByRole("textbox", { name: "任务输入" }).fill("不应允许提交");

  await expect(page.getByRole("button", { exact: true, name: "提交" })).toBeDisabled();
});

test("stores composer drafts independently between task routes", async ({ page }) => {
  await page.route("**/v1/projects/code-agent/tasks/input-design", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        checkpoint: { sequence: 0, sessionId: "e2e-session" },
        snapshot: {
          ...tasks[1],
          contextUsage: null,
          pendingRequests: [],
          settings: taskSnapshot.settings,
          status: "idle",
          turns: [],
        },
      },
    });
  });
  await page.goto("/p/code-agent/t/task-1");
  await page.getByRole("textbox", { name: "任务输入" }).fill("只属于 Task A 的草稿");
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "添加图片" }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
    mimeType: "image/png",
    name: "task-draft.png",
  });
  await expect(page.getByText("task-draft.png", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: /优化输入框交互/ }).click();

  await expect(page).toHaveURL(/\/p\/code-agent\/t\/input-design$/);
  await expect(page.getByRole("textbox", { name: "任务输入" })).toHaveAttribute(
    "data-serialized-value",
    "",
  );
  await expect(page.getByText("task-draft.png", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { exact: true, name: "提交" })).toBeDisabled();

  await page.locator('a[href="/p/code-agent/t/task-1"]').first().click();

  await expect(page).toHaveURL(/\/p\/code-agent\/t\/task-1$/);
  await expect(page.getByRole("textbox", { name: "任务输入" })).toHaveAttribute(
    "data-serialized-value",
    "只属于 Task A 的草稿",
  );
  await expect(page.getByText("task-draft.png", { exact: true })).toBeVisible();
});

test("keeps the composer input mounted when switching task routes", async ({ page }) => {
  let markSnapshotRequested: () => void = () => undefined;
  const snapshotRequested = new Promise<void>((resolve) => {
    markSnapshotRequested = resolve;
  });
  let releaseSnapshot: () => void = () => undefined;
  const snapshotGate = new Promise<void>((resolve) => {
    releaseSnapshot = resolve;
  });
  await page.route("**/v1/projects/code-agent/tasks/input-design", async (route) => {
    markSnapshotRequested();
    await snapshotGate;
    await route.fulfill({
      contentType: "application/json",
      json: {
        checkpoint: { sequence: 0, sessionId: "e2e-session" },
        snapshot: {
          ...tasks[1],
          contextUsage: null,
          pendingRequests: [],
          settings: taskSnapshot.settings,
          status: "idle",
          turns: [],
        },
      },
    });
  });
  await page.goto("/p/code-agent/t/task-1");
  const currentPrompt = page.getByRole("textbox", { name: "任务输入" });
  await currentPrompt.fill("只属于 Task A 的草稿");
  await currentPrompt.evaluate((editor) => {
    Reflect.set(globalThis, "__testComposerEditor", editor);
  });

  await page.getByRole("link", { name: /优化输入框交互/ }).click();
  await expect(page).toHaveURL(/\/p\/code-agent\/t\/input-design$/);
  await snapshotRequested;

  const nextPrompt = page.getByRole("textbox", { name: "任务输入" });
  const inputStateWhileSnapshotLoads = await nextPrompt.evaluate((editor) => {
    if (!(editor instanceof HTMLDivElement) || editor.contentEditable !== "true") {
      throw new Error("任务输入不是可编辑区域");
    }
    const wasEmpty = editor.textContent === "";
    editor.focus();
    const acceptsFocus = document.activeElement === editor;
    editor.dispatchEvent(new CompositionEvent("compositionstart"));
    editor.textContent = "n";
    editor.dispatchEvent(new CompositionEvent("compositionupdate", { data: "n" }));
    return { acceptsFocus, wasEmpty };
  });
  releaseSnapshot();
  expect(inputStateWhileSnapshotLoads).toEqual({ acceptsFocus: true, wasEmpty: true });
  await expect(nextPrompt).toHaveText("n");
  await expect
    .poll(() =>
      nextPrompt.evaluate((editor) => Reflect.get(globalThis, "__testComposerEditor") === editor),
    )
    .toBe(true);
});

test("scrolls the conversation area to the bottom whenever the active task changes", async ({
  page,
}) => {
  const longTurns = Array.from({ length: 24 }, (_, turnIndex) => ({
    completedAt: `2026-07-22T08:${String(turnIndex).padStart(2, "0")}:30.000Z`,
    error: null,
    id: `long-turn-${String(turnIndex)}`,
    items: [
      {
        id: `long-user-${String(turnIndex)}`,
        role: "user",
        text: `长会话问题 ${String(turnIndex + 1)}`,
        type: "message",
      },
      {
        id: `long-assistant-${String(turnIndex)}`,
        role: "assistant",
        text: `长会话回复 ${String(turnIndex + 1)}：${"持续输出用于验证任务切换后的滚动位置。".repeat(8)}`,
        type: "message",
      },
    ],
    startedAt: `2026-07-22T08:${String(turnIndex).padStart(2, "0")}:00.000Z`,
    status: "completed",
  }));
  await page.route("**/v1/projects/code-agent/tasks/task-1", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        ...taskSnapshotResponse,
        snapshot: { ...taskSnapshot, turns: longTurns },
      },
    });
  });
  await page.route("**/v1/projects/code-agent/tasks/input-design", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        ...taskSnapshotResponse,
        snapshot: {
          ...taskSnapshot,
          ...tasks[1],
          turns: [taskSnapshot.turns[0]],
        },
      },
    });
  });
  await page.goto("/p/code-agent/t/task-1");
  const conversation = page.getByRole("log", { name: "会话内容" });
  await expect
    .poll(() => conversation.evaluate((element) => element.scrollHeight))
    .toBeGreaterThan(800);

  await conversation.evaluate((element) => {
    element.scrollTop = 120;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await page.getByRole("link", { name: /优化输入框交互/u }).click();
  await expect(page).toHaveURL(/\/p\/code-agent\/t\/input-design$/u);
  await expect(conversation).toContainText("工作台界面已按统一的 AI Elements 结构重新组织。");

  await page.evaluate(() => {
    const observer = new MutationObserver(() => {
      const element = document.querySelector<HTMLElement>('[role="log"][aria-label="会话内容"]');
      if (!element?.textContent.includes("长会话问题 24")) {
        return;
      }
      observer.disconnect();

      // 模拟长 Timeline 分帧提交时浏览器先报告临时中部位置，随后消息布局继续增高。
      element.scrollTop = 120;
      element.dispatchEvent(new Event("scroll", { bubbles: true }));
      const delayedMessageLayout = document.createElement("div");
      delayedMessageLayout.style.height = "800px";
      delayedMessageLayout.style.flexShrink = "0";
      element.firstElementChild?.append(delayedMessageLayout);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });

  await page.locator('a[href="/p/code-agent/t/task-1"]').first().click();
  await expect(page).toHaveURL(/\/p\/code-agent\/t\/task-1$/u);

  // 新 Task 内容完成布局后，聊天区域必须位于最底部，不能继承短会话的 scrollTop。
  await expect
    .poll(() =>
      conversation.evaluate(
        (element) => element.scrollHeight - element.scrollTop - element.clientHeight,
      ),
    )
    .toBeLessThanOrEqual(1);
});

test("shows a task error when the initial snapshot request fails", async ({ page }) => {
  await page.route("**/v1/projects/code-agent/tasks/task-1", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: { code: "SNAPSHOT_FAILED", message: "Snapshot failed" },
      status: 500,
    });
  });

  await page.goto("/p/code-agent/t/task-1");

  await expect(page.getByRole("alert", { name: "会话内容" })).toHaveText("无法加载任务历史");
});

test("shows an error when the resync snapshot refresh fails", async ({ page }) => {
  let snapshotRequestCount = 0;
  await page.route("**/v1/projects/code-agent/tasks/task-1", async (route) => {
    snapshotRequestCount += 1;
    if (snapshotRequestCount === 1) {
      await route.fulfill({ contentType: "application/json", json: taskSnapshotResponse });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      json: { code: "SNAPSHOT_FAILED", message: "Snapshot failed" },
      status: 503,
    });
  });
  await page.addInitScript(() => {
    class ResyncWebSocket extends EventTarget {
      public readonly bufferedAmount = 0;
      public readyState = 0;

      public constructor() {
        super();
        queueMicrotask(() => {
          if (this.readyState === 3) {
            return;
          }
          this.readyState = 1;
          this.dispatchEvent(new Event("open"));
          for (const message of [
            {
              latestSequence: 0,
              sessionId: "e2e-session",
              type: "connection.ready",
              version: 2,
            },
            {
              latestSequence: 8,
              reason: "event_retention_exceeded",
              sessionId: "e2e-session",
              type: "resync.required",
              version: 2,
            },
          ]) {
            this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(message) }));
          }
        });
      }

      public close(code = 1000, reason = ""): void {
        if (this.readyState === 3) {
          return;
        }
        this.readyState = 3;
        this.dispatchEvent(new CloseEvent("close", { code, reason }));
      }

      public send(): void {
        return undefined;
      }
    }

    Object.defineProperty(window, "WebSocket", {
      configurable: true,
      value: ResyncWebSocket,
    });
  });

  await page.goto("/p/code-agent/t/task-1");

  await expect.poll(() => snapshotRequestCount).toBeGreaterThanOrEqual(2);
  await expect(page.getByRole("alert", { name: "会话内容" })).toHaveText("无法加载任务历史");
});

test("refreshes the snapshot when the realtime delta buffer overflows", async ({ page }) => {
  let snapshotRequestCount = 0;
  await page.route("**/v1/projects/code-agent/tasks/task-1", async (route) => {
    snapshotRequestCount += 1;
    await route.fulfill({
      contentType: "application/json",
      json: {
        ...taskSnapshotResponse,
        checkpoint: {
          ...taskSnapshotResponse.checkpoint,
          sequence: snapshotRequestCount === 1 ? 0 : 1_001,
        },
      },
    });
  });
  await page.addInitScript(() => {
    let connectionCount = 0;

    class BurstingWebSocket extends EventTarget {
      public readonly bufferedAmount = 0;
      public readyState = 0;

      public constructor() {
        super();
        connectionCount += 1;
        const shouldSendBurst = connectionCount <= 2;
        queueMicrotask(() => {
          if (this.readyState === 3) {
            return;
          }
          this.readyState = 1;
          this.dispatchEvent(new Event("open"));
          this.dispatchEvent(
            new MessageEvent("message", {
              data: JSON.stringify({
                latestSequence: 1_001,
                sessionId: "e2e-session",
                type: "connection.ready",
                version: 2,
              }),
            }),
          );
          if (!shouldSendBurst) {
            return;
          }
          for (let sequence = 1; sequence <= 1_001; sequence += 1) {
            this.dispatchEvent(
              new MessageEvent("message", {
                data: JSON.stringify({
                  itemId: `item-${String(sequence % 2)}`,
                  payload: { delta: "x" },
                  provider: "codex",
                  sequence,
                  sessionId: "e2e-session",
                  taskId: "task-1",
                  timestamp: "2026-07-23T00:00:00.000Z",
                  turnId: "turn-1",
                  type: "message.delta",
                  version: 2,
                }),
              }),
            );
          }
        });
      }

      public close(code = 1000, reason = ""): void {
        if (this.readyState === 3) {
          return;
        }
        this.readyState = 3;
        this.dispatchEvent(new CloseEvent("close", { code, reason }));
      }

      public send(): void {
        return undefined;
      }
    }

    Object.defineProperty(window, "WebSocket", {
      configurable: true,
      value: BurstingWebSocket,
    });
  });

  await page.goto("/p/code-agent/t/task-1");

  await expect.poll(() => snapshotRequestCount).toBeGreaterThanOrEqual(2);
});

test("clears transient realtime errors after the WebSocket reconnects", async ({ page }) => {
  let snapshotRequestCount = 0;
  await page.route("**/v1/projects/code-agent/tasks/task-1", async (route) => {
    snapshotRequestCount += 1;
    if (snapshotRequestCount === 1) {
      await route.fulfill({ contentType: "application/json", json: taskSnapshotResponse });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      json: { code: "SNAPSHOT_FAILED", message: "Snapshot failed" },
      status: 503,
    });
  });
  await page.addInitScript(() => {
    let connectionCount = 0;
    sessionStorage.setItem("__testWebSocketConnections", String(connectionCount));
    sessionStorage.setItem("__testWebSocketFailed", "false");
    sessionStorage.setItem("__testWebSocketRecovered", "false");

    class ReconnectingWebSocket extends EventTarget {
      public readonly bufferedAmount = 0;
      public readyState = 0;

      public constructor() {
        super();
        connectionCount += 1;
        const shouldFail = connectionCount <= 2;
        sessionStorage.setItem("__testWebSocketConnections", String(connectionCount));
        queueMicrotask(() => {
          if (this.readyState === 3) {
            return;
          }
          this.readyState = 1;
          this.dispatchEvent(new Event("open"));
          const sendReady = () => {
            this.dispatchEvent(
              new MessageEvent("message", {
                data: JSON.stringify({
                  latestSequence: 0,
                  sessionId: "e2e-session",
                  type: "connection.ready",
                  version: 2,
                }),
              }),
            );
          };
          if (!shouldFail) {
            setTimeout(() => {
              if (this.readyState === 3) {
                return;
              }
              sendReady();
              sessionStorage.setItem("__testWebSocketRecovered", "true");
            }, 1_000);
            return;
          }
          sendReady();
          setTimeout(() => {
            sessionStorage.setItem("__testWebSocketFailed", "true");
            this.dispatchEvent(new Event("error"));
            this.readyState = 3;
            this.dispatchEvent(new CloseEvent("close", { code: 1006 }));
          }, 200);
        });
      }

      public close(code = 1000, reason = ""): void {
        if (this.readyState === 3) {
          return;
        }
        this.readyState = 3;
        this.dispatchEvent(new CloseEvent("close", { code, reason }));
      }

      public send(): void {
        return undefined;
      }
    }

    // 在应用创建连接前替换浏览器实现，稳定复现失败后成功重连。
    Object.defineProperty(window, "WebSocket", {
      configurable: true,
      value: ReconnectingWebSocket,
    });
  });

  await page.goto("/p/code-agent/t/task-1");
  await expect(page.getByText("工作台界面已按统一的 AI Elements 结构重新组织。")).toBeVisible();
  await expect.poll(() => page.evaluate(() => WebSocket.name)).toBe("ReconnectingWebSocket");
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem("__testWebSocketFailed")))
    .toBe("true");
  await expect.poll(() => snapshotRequestCount).toBeGreaterThanOrEqual(2);
  await page.waitForTimeout(50);

  // Snapshot 刷新失败属于非阻塞恢复错误，已渲染 Timeline 不能被替换。
  await expect(page.getByRole("alert", { name: "会话内容" })).toHaveCount(0);
  await expect(page.getByText("工作台界面已按统一的 AI Elements 结构重新组织。")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => Number(sessionStorage.getItem("__testWebSocketConnections") ?? "0")),
    )
    .toBeGreaterThanOrEqual(2);
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem("__testWebSocketRecovered")))
    .toBe("true");

  await expect(page.getByRole("alert", { name: "会话内容" })).toHaveCount(0);
});

test("shows background task attention and clears it after entering the task", async ({ page }) => {
  await page.route("**/v1/projects/code-agent/tasks/input-design", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        ...taskSnapshotResponse,
        snapshot: {
          ...taskSnapshot,
          id: "input-design",
          pinned: false,
          status: "idle",
          title: "优化输入框交互",
          turns: [],
        },
      },
    });
  });
  await page.addInitScript(() => {
    type SidebarEventEmitterWindow = Window & {
      __emitSidebarTaskEvent?: (event: unknown) => void;
    };

    class ControlledWebSocket extends EventTarget {
      public readonly bufferedAmount = 0;
      public readyState = 0;

      public constructor() {
        super();
        const connectionGeneration =
          Number(sessionStorage.getItem("__sidebarEventConnectionGeneration") ?? "0") + 1;
        sessionStorage.setItem("__sidebarEventConnectionGeneration", String(connectionGeneration));
        (window as SidebarEventEmitterWindow).__emitSidebarTaskEvent = (event) => {
          this.dispatchEvent(
            new MessageEvent("message", {
              data: JSON.stringify(event),
            }),
          );
        };
        queueMicrotask(() => {
          if (this.readyState === 3) {
            return;
          }
          this.readyState = 1;
          this.dispatchEvent(new Event("open"));
          this.dispatchEvent(
            new MessageEvent("message", {
              data: JSON.stringify({
                latestSequence: 0,
                sessionId: "e2e-session",
                type: "connection.ready",
                version: 2,
              }),
            }),
          );
        });
      }

      public close(code = 1000, reason = ""): void {
        if (this.readyState === 3) {
          return;
        }
        this.readyState = 3;
        this.dispatchEvent(new CloseEvent("close", { code, reason }));
      }

      public send(): void {
        return undefined;
      }
    }

    Object.defineProperty(window, "WebSocket", {
      configurable: true,
      value: ControlledWebSocket,
    });
  });

  await page.goto("/p/code-agent/t/task-1");
  const sidebar = page.getByRole("complementary", { name: "Project Sidebar" });
  const backgroundTask = sidebar.getByRole("link", { name: /优化输入框交互/ });
  const completedTask = sidebar.getByRole("link", { name: /完善 Markdown 渲染/ });
  const failedTask = sidebar.getByRole("link", { name: /完善 Runtime 状态/ });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          typeof (window as Window & { __emitSidebarTaskEvent?: (value: unknown) => void })
            .__emitSidebarTaskEvent,
      ),
    )
    .toBe("function");
  const turn = {
    completedAt: null,
    error: null,
    id: "turn-input-design",
    items: [],
    startedAt: "2026-07-29T00:00:00.000Z",
    status: "running",
  };
  const emitTaskEvent = async (event: Record<string, unknown>) => {
    await page.evaluate((taskEvent) => {
      const emitter = (window as Window & { __emitSidebarTaskEvent?: (value: unknown) => void })
        .__emitSidebarTaskEvent;
      if (emitter === undefined) {
        throw new Error("Sidebar task event emitter is unavailable");
      }
      emitter(taskEvent);
    }, event);
  };

  await emitTaskEvent({
    payload: { turn },
    provider: "codex",
    sequence: 1,
    sessionId: "e2e-session",
    taskId: "input-design",
    timestamp: "2026-07-29T00:00:00.000Z",
    turnId: turn.id,
    type: "turn.started",
    version: 2,
  });
  await emitTaskEvent({
    itemId: "approval-input-design",
    payload: {
      request: {
        availableDecisions: ["allow", "deny"],
        command: "pnpm check",
        createdAt: "2026-07-29T00:00:01.000Z",
        cwd: "/workspace/CodeAgent",
        expiresAt: null,
        itemId: "approval-input-design",
        networkAccess: null,
        projectId: "code-agent",
        reason: null,
        requestId: "approval-input-design",
        status: "pending",
        taskId: "input-design",
        turnId: turn.id,
        type: "command_approval",
      },
    },
    provider: "codex",
    sequence: 2,
    sessionId: "e2e-session",
    taskId: "input-design",
    timestamp: "2026-07-29T00:00:01.000Z",
    turnId: turn.id,
    type: "pending_request.created",
    version: 2,
  });

  await expect(backgroundTask.getByRole("status", { name: "任务等待审批" })).toBeVisible();
  await backgroundTask.click();
  await expect(backgroundTask.getByRole("status", { name: "任务等待审批" })).toHaveCount(0);

  const previousConnectionGeneration = await page.evaluate(() =>
    Number(sessionStorage.getItem("__sidebarEventConnectionGeneration") ?? "0"),
  );
  await page.goto("/p/code-agent/t/task-1");
  await expect
    .poll(() =>
      page.evaluate(() =>
        Number(sessionStorage.getItem("__sidebarEventConnectionGeneration") ?? "0"),
      ),
    )
    .toBeGreaterThan(previousConnectionGeneration);
  const completedTurn = {
    ...turn,
    id: "turn-markdown",
  };
  await emitTaskEvent({
    payload: { turn: completedTurn },
    provider: "codex",
    sequence: 1,
    sessionId: "e2e-session",
    taskId: "markdown",
    timestamp: "2026-07-29T00:00:00.000Z",
    turnId: completedTurn.id,
    type: "turn.started",
    version: 2,
  });
  await expect(completedTask.getByRole("status", { name: "任务运行中" })).toBeVisible();
  await emitTaskEvent({
    payload: {
      turn: {
        ...completedTurn,
        completedAt: "2026-07-29T00:00:02.000Z",
        status: "completed",
      },
    },
    provider: "codex",
    sequence: 2,
    sessionId: "e2e-session",
    taskId: "markdown",
    timestamp: "2026-07-29T00:00:02.000Z",
    turnId: completedTurn.id,
    type: "turn.completed",
    version: 2,
  });

  await expect(completedTask.getByRole("status", { name: "AI 回复已完成" })).toBeVisible();

  await completedTask.click();
  await expect(completedTask.getByRole("status", { name: "AI 回复已完成" })).toHaveCount(0);

  const completedConnectionGeneration = await page.evaluate(() =>
    Number(sessionStorage.getItem("__sidebarEventConnectionGeneration") ?? "0"),
  );
  await page.goto("/p/code-agent/t/task-1");
  await expect
    .poll(() =>
      page.evaluate(() =>
        Number(sessionStorage.getItem("__sidebarEventConnectionGeneration") ?? "0"),
      ),
    )
    .toBeGreaterThan(completedConnectionGeneration);
  const failedTurn = {
    ...turn,
    id: "turn-runtime",
  };
  await emitTaskEvent({
    payload: { turn: failedTurn },
    provider: "codex",
    sequence: 1,
    sessionId: "e2e-session",
    taskId: "runtime",
    timestamp: "2026-07-29T00:00:00.000Z",
    turnId: failedTurn.id,
    type: "turn.started",
    version: 2,
  });
  await expect(failedTask.getByRole("status", { name: "任务运行中" })).toBeVisible();

  // Provider 明确停止重试时，后台 Task 必须保留失败提醒直到用户进入。
  await emitTaskEvent({
    payload: { message: "模型服务不可用", willRetry: false },
    provider: "codex",
    sequence: 2,
    sessionId: "e2e-session",
    taskId: "runtime",
    timestamp: "2026-07-29T00:00:02.000Z",
    turnId: failedTurn.id,
    type: "provider.error",
    version: 2,
  });
  await expect(failedTask.getByRole("status", { name: "AI 回复未完成" })).toBeVisible();

  await failedTask.click();
  await expect(failedTask.getByRole("status", { name: "AI 回复未完成" })).toHaveCount(0);
});

test("restores network approvals from the task snapshot after refresh", async ({ page }) => {
  let resolutionCount = 0;
  const pendingRequest = {
    availableDecisions: ["allow", "deny"],
    command: "pnpm check",
    createdAt: "2026-07-23T00:00:00.000Z",
    cwd: "/workspace/CodeAgent",
    expiresAt: null,
    itemId: "command-approval-1",
    networkAccess: { host: "api.example.com", protocol: "https" },
    projectId: "code-agent",
    reason: "需要执行检查",
    requestId: "string:snapshot-request",
    status: "pending",
    taskId: "task-1",
    turnId: "turn-1",
    type: "command_approval",
  };
  await page.route(
    "**/v1/projects/code-agent/tasks/task-1/pending-requests/*/resolve",
    async (route) => {
      resolutionCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 100));
      await route.fulfill({
        contentType: "application/json",
        json: { request: { ...pendingRequest, status: "resolved" } },
      });
    },
  );
  await page.route("**/v1/projects/code-agent/tasks/task-1", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        ...taskSnapshotResponse,
        snapshot: { ...taskSnapshot, pendingRequests: [pendingRequest], status: "running" },
      },
    });
  });

  await page.goto("/p/code-agent/t/task-1");
  const approval = page.getByRole("region", { name: "网络访问审批请求" });
  await expect(approval).toBeVisible();
  await expect(approval).toContainText("api.example.com");
  await expect(approval).toContainText("HTTPS");

  await page.reload();
  await expect(page.getByRole("region", { name: "网络访问审批请求" })).toBeVisible();
  const allow = page.getByRole("button", { exact: true, name: "允许" });
  await expect(allow).toBeEnabled();
  await allow.dblclick();
  await expect.poll(() => resolutionCount).toBe(1);
  await expect(allow).toBeDisabled();
});

test("disables user input controls while an answer is being submitted", async ({ page }) => {
  const pendingRequest = {
    createdAt: "2026-07-23T00:00:00.000Z",
    expiresAt: null,
    itemId: "user-input-1",
    projectId: "code-agent",
    questions: [
      {
        header: "执行模式",
        id: "mode",
        isOther: false,
        isSecret: false,
        options: [
          { description: "继续实现", label: "继续" },
          { description: "停止当前工作", label: "停止" },
        ],
        prompt: "下一步怎么处理？",
        type: "choice",
      },
    ],
    requestId: "string:user-input-1",
    status: "pending",
    taskId: "task-1",
    turnId: "turn-1",
    type: "user_input",
  };
  await page.route(
    "**/v1/projects/code-agent/tasks/task-1/pending-requests/*/resolve",
    async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      await route.fulfill({
        contentType: "application/json",
        json: { request: { ...pendingRequest, status: "resolved" } },
      });
    },
  );
  await page.route("**/v1/projects/code-agent/tasks/task-1", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        ...taskSnapshotResponse,
        snapshot: { ...taskSnapshot, pendingRequests: [pendingRequest], status: "running" },
      },
    });
  });

  await page.goto("/p/code-agent/t/task-1");
  const continueAnswer = page.getByRole("radio", { name: /继续/ });
  const stopAnswer = page.getByRole("radio", { name: /停止/ });
  await continueAnswer.check();
  await page.getByRole("button", { name: "提交回答" }).click();

  await expect(continueAnswer).toBeDisabled();
  await expect(stopAnswer).toBeDisabled();
});

test("streams Fake App Server notifications into the Timeline", async ({ page }) => {
  await page.unroute("**/v1/**");
  await page.goto("/p/code-agent/t/task-realtime");

  await expect(page.getByText("Realtime connected", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("button", { name: "上下文已使用 13%" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText("启动子代理 · 1 个子代理已完成", { exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "上下文" })).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("button", { name: "查看子代理 frontend_analysis 的输出" }),
  ).toBeVisible();
  await expect(page.getByText("理解前端项目", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "查看子代理 frontend_analysis 的输出" }).click();
  const subagentDialog = page.getByRole("dialog", { name: "子代理输出" });
  await expect(subagentDialog).toBeVisible();
  await expect(subagentDialog.getByText("正在分析前端", { exact: true })).toBeVisible();

  // 关闭弹窗会卸载子线程 Runtime；再次打开时从最新 Snapshot 继续，而非重启子代理。
  await page.getByRole("button", { name: "关闭子代理输出" }).click();
  await expect(subagentDialog).toHaveCount(0);
  await page.waitForTimeout(750);
  await page.getByRole("button", { name: "查看子代理 frontend_analysis 的输出" }).click();
  await expect(page.getByRole("dialog", { name: "子代理输出" })).toContainText("前端流式分析完成");
  await expect(page.getByText("agent/spawn", { exact: true })).toHaveCount(0);
});

test("submits a prompt and streams the completed reply", async ({ page }) => {
  await page.unroute("**/v1/**");
  await page.goto("/p/code-agent");

  await page.getByRole("textbox", { name: "任务输入" }).fill("完成流式回复");
  await page.getByRole("button", { exact: true, name: "提交" }).click();

  await expect(page).toHaveURL(/\/p\/code-agent\/t\/task-action-\d+$/);
  await expect(page.getByText("完成流式回复", { exact: true })).toBeVisible();
  await expect(page.getByText("流式回复完成", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Turn 1")).toHaveAttribute("data-status", "completed");
  await expect(page.getByRole("button", { exact: true, name: "提交" })).toBeVisible();
});

test("allows a command approval and completes the turn", async ({ page }) => {
  await page.unroute("**/v1/**");
  await page.goto("/p/code-agent");

  await page.getByRole("textbox", { name: "任务输入" }).fill("审批命令");
  await page.getByRole("button", { exact: true, name: "提交" }).click();
  await expect(page.getByRole("region", { name: "命令审批请求" })).toBeVisible();
  // 当前 Task 已在用户视野内，审批提醒只保留在 Timeline，不重复占用 Sidebar 状态位。
  await expect(page.getByRole("status", { name: "任务等待审批" })).toHaveCount(0);
  await page.getByRole("button", { exact: true, name: "允许" }).click();

  await expect(page.getByText("流式回复完成", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Turn 1")).toHaveAttribute("data-status", "completed");
});

test("denies a file change approval and completes the turn", async ({ page }) => {
  await page.unroute("**/v1/**");
  await page.goto("/p/code-agent");

  await page.getByRole("textbox", { name: "任务输入" }).fill("审批文件");
  await page.getByRole("button", { exact: true, name: "提交" }).click();
  await expect(page.getByRole("region", { name: "文件变更审批请求" })).toBeVisible();
  await page.getByRole("button", { exact: true, name: "拒绝" }).click();

  await expect(page.getByText("流式回复完成", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Turn 1")).toHaveAttribute("data-status", "completed");
});

test("answers a user input request and completes the turn", async ({ page }) => {
  await page.unroute("**/v1/**");
  await page.goto("/p/code-agent");

  await page.getByRole("textbox", { name: "任务输入" }).fill("用户输入");
  await page.getByRole("button", { exact: true, name: "提交" }).click();
  await expect(page.getByRole("heading", { name: "需要你的输入" })).toBeVisible();
  await page.getByRole("radio", { name: /继续/ }).check();
  await page.getByRole("button", { exact: true, name: "提交回答" }).click();

  await expect(page.getByText("流式回复完成", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Turn 1")).toHaveAttribute("data-status", "completed");
});

test("interrupts a running turn from the composer", async ({ page }) => {
  await page.unroute("**/v1/**");
  await page.goto("/p/code-agent");

  await page.getByRole("textbox", { name: "任务输入" }).fill("等待中断");
  await page.getByRole("button", { exact: true, name: "提交" }).click();

  await expect(page).toHaveURL(/\/p\/code-agent\/t\/task-action-\d+$/);
  await page.getByRole("button", { exact: true, name: "停止" }).click();
  await expect(page.getByLabel("Turn 1")).toHaveAttribute("data-status", "interrupted");
  await expect(page.getByRole("button", { exact: true, name: "提交" })).toBeVisible();
});

test("reuses the interrupt idempotency key until the terminal event arrives", async ({ page }) => {
  await page.unroute("**/v1/**");
  await page.goto("/p/code-agent");

  await page.getByRole("textbox", { name: "任务输入" }).fill("等待中断");
  await page.getByRole("button", { exact: true, name: "提交" }).click();
  await expect(page).toHaveURL(/\/p\/code-agent\/t\/task-action-\d+$/);

  const idempotencyKeys: string[] = [];
  await page.route("**/v1/projects/code-agent/tasks/*/turns/*/interrupt", async (route) => {
    const request = route.request();
    const payload = request.postDataJSON() as { taskId: string };
    const turnId = new URL(request.url()).pathname.split("/")[7] ?? "";
    idempotencyKeys.push(request.headers()["idempotency-key"] ?? "");
    await route.fulfill({
      contentType: "application/json",
      json: { status: "interrupting", taskId: payload.taskId, turnId },
      status: 202,
    });
  });

  await page.getByRole("button", { exact: true, name: "停止" }).click();
  await page.getByRole("button", { exact: true, name: "停止" }).click();

  await expect.poll(() => idempotencyKeys).toHaveLength(2);
  expect(idempotencyKeys[0]).toBe(idempotencyKeys[1]);
});

test("preserves the prompt draft when submission fails", async ({ page }) => {
  await page.route("**/v1/projects/code-agent/attachments", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        attachment: {
          id: "attachment-preserved",
          mediaType: "image/png",
          name: "preserved.png",
          size: 68,
        },
      },
      status: 201,
    });
  });
  await page.route("**/v1/projects/code-agent/tasks", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      json: { code: "PROVIDER_ERROR", message: "Agent provider request failed", retryable: true },
      status: 502,
    });
  });
  await page.goto("/p/code-agent");
  const prompt = page.getByRole("textbox", { name: "任务输入" });
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "添加图片" }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
    mimeType: "image/png",
    name: "preserved.png",
  });

  await prompt.fill("失败后保留这段草稿");
  await page.getByRole("button", { exact: true, name: "提交" }).click();

  await expect(page.getByRole("alert")).toHaveText("操作失败，请重试");
  await expect(prompt).toHaveAttribute("data-serialized-value", "失败后保留这段草稿");
  await expect(page.getByText("preserved.png", { exact: true })).toBeVisible();
});

test("orders persistent search, task actions, pinned tasks and projects in the sidebar", async ({
  page,
}) => {
  await page.goto("/p/code-agent/t/task-1");

  const sidebar = page.getByRole("complementary", { name: "Project Sidebar" });
  const newAgent = sidebar.getByRole("link", { name: "新建任务" });
  const search = sidebar.getByRole("textbox", { name: "搜索任务" });
  const productHome = sidebar.getByRole("link", { name: "CodeAgent 首页" });
  await expect(productHome).toBeVisible();
  await expect(productHome.getByText("CodeAgent", { exact: true })).toBeVisible();
  await expect(search).toBeVisible();
  await expect(sidebar.getByRole("button", { name: "搜索" })).toHaveCount(0);
  await expect(sidebar.getByRole("button", { name: "添加项目" })).toBeVisible();

  const newAgentBox = await newAgent.boundingBox();
  const searchBox = await search.boundingBox();
  const pinnedBox = await sidebar.getByRole("heading", { name: "Pinned" }).boundingBox();
  const projectsBox = await sidebar.getByRole("heading", { name: "Projects" }).boundingBox();
  expect(newAgentBox).not.toBeNull();
  expect(searchBox).not.toBeNull();
  expect(pinnedBox).not.toBeNull();
  expect(projectsBox).not.toBeNull();
  if (newAgentBox === null || searchBox === null || pinnedBox === null || projectsBox === null) {
    throw new Error("项目侧栏导航项缺失");
  }
  expect(searchBox.y).toBeLessThan(newAgentBox.y);
  expect(newAgentBox.y).toBeLessThan(pinnedBox.y);
  expect(pinnedBox.y).toBeLessThan(projectsBox.y);
});

test("adds a folder through the host project picker", async ({ page }) => {
  await page.goto("/p/code-agent");

  await page.getByRole("button", { name: "添加项目" }).click();

  await expect(page).toHaveURL(/\/p\/added-project$/);
  await expect(page.getByRole("heading", { name: "AddedProject" })).toBeVisible();
});

test("handles a host project picker failure without an unhandled rejection", async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => {
    pageErrors.push(error);
  });
  await page.route("**/v1/projects", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      json: { code: "PROVIDER_ERROR", message: "Project picker failed", retryable: true },
      status: 502,
    });
  });
  await page.goto("/p/code-agent");

  await page.getByRole("button", { name: "添加项目" }).click();

  await expect(page.getByRole("alert")).toContainText("无法添加项目");
  expect(pageErrors).toEqual([]);
});

test("keeps icon button tooltips visible within clipping and viewport boundaries", async ({
  page,
}) => {
  await page.goto("/p/code-agent/t/task-1");

  const assertTooltipVisible = async (label: string) => {
    await page.getByRole("button", { exact: true, name: label }).hover();
    const tooltip = page.getByRole("tooltip", { exact: true, name: label });
    await expect(tooltip).toBeVisible();

    const placement = await tooltip.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      let clippedByAncestor = false;

      // Tooltip 不能越过任何实际裁剪它的祖先边界。
      for (
        let ancestor = element.parentElement;
        ancestor !== null;
        ancestor = ancestor.parentElement
      ) {
        const style = getComputedStyle(ancestor);
        const ancestorRect = ancestor.getBoundingClientRect();
        const clipsX = ["auto", "clip", "hidden", "scroll"].includes(style.overflowX);
        const clipsY = ["auto", "clip", "hidden", "scroll"].includes(style.overflowY);

        if (
          (clipsX && (rect.left < ancestorRect.left || rect.right > ancestorRect.right)) ||
          (clipsY && (rect.top < ancestorRect.top || rect.bottom > ancestorRect.bottom))
        ) {
          clippedByAncestor = true;
          break;
        }
      }

      return {
        bottom: rect.bottom,
        clippedByAncestor,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth,
      };
    });

    expect(placement.clippedByAncestor).toBe(false);
    expect(placement.left).toBeGreaterThanOrEqual(8);
    expect(placement.right).toBeLessThanOrEqual(placement.viewportWidth - 8);
    expect(placement.top).toBeGreaterThanOrEqual(8);
    expect(placement.bottom).toBeLessThanOrEqual(placement.viewportHeight - 8);
  };

  await assertTooltipVisible("收起项目侧栏");
  await assertTooltipVisible("收起上下文面板");

  await page.setViewportSize({ height: 844, width: 390 });
  await assertTooltipVisible("展开项目侧栏");
  await assertTooltipVisible("展开上下文面板");
});

test("searches tasks across projects", async ({ page }) => {
  await page.goto("/p/code-agent/t/task-1");

  const sidebar = page.getByRole("complementary", { name: "Project Sidebar" });
  await sidebar.getByRole("textbox", { name: "搜索任务" }).fill("Markdown");

  await expect(sidebar.getByRole("link", { name: /完善 Markdown 渲染/ })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: /构建 macOS 工作台/ })).not.toBeVisible();
});

test("opens and reuses project new chats without creating empty Codex tasks", async ({ page }) => {
  const taskCreationRequests: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/v1\/projects\/[^/]+\/tasks$/u.test(request.url())) {
      taskCreationRequests.push(request.url());
    }
  });
  await page.goto("/p/superwork/t/plan-check");

  const sidebar = page.getByRole("complementary", { name: "Project Sidebar" });
  await sidebar.getByRole("link", { name: "新建任务" }).click();
  await expect(page).toHaveURL(/\/p\/code-agent$/);
  await expect(sidebar.getByRole("link", { name: "新聊天" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  // 已经位于首个项目的新聊天时继续复用当前草稿，不创建空 Codex Task。
  await sidebar.getByRole("link", { name: "新建任务" }).click();
  await expect(page).toHaveURL(/\/p\/code-agent$/);
  await sidebar.getByRole("button", { name: "在 superwork 中新建任务" }).click();
  await expect(page).toHaveURL(/\/p\/superwork$/);
  await expect(sidebar.getByRole("link", { name: "新聊天" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(taskCreationRequests).toEqual([]);
});

test("shows a newly submitted task and AI reply state before the task snapshot loads", async ({
  page,
}) => {
  const createdTask = {
    id: "019f9d81-13ab-7863-9676-beae70726117",
    pinned: false,
    projectId: "code-agent",
    title: "新聊天",
    updatedAt: "2026-07-26T08:00:00.000Z",
  };
  const startedTurn = {
    completedAt: null,
    error: null,
    id: "turn-new-task",
    // 模拟 turn/start 只返回运行态、用户 Item 尚未进入 Snapshot 的真实窗口。
    items: [],
    startedAt: "2026-07-26T08:00:00.000Z",
    status: "running",
  };
  let releaseSnapshotRequest: () => void = () => undefined;
  let snapshotResponseSent = false;
  const snapshotGate = new Promise<void>((resolve) => {
    releaseSnapshotRequest = resolve;
  });

  await page.route("**/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/v1/projects/code-agent/tasks" && route.request().method() === "POST") {
      await route.fulfill({ contentType: "application/json", json: { task: createdTask } });
      return;
    }
    if (
      url.pathname === `/v1/projects/code-agent/tasks/${createdTask.id}/turns` &&
      route.request().method() === "POST"
    ) {
      await route.fulfill({
        contentType: "application/json",
        json: { taskId: createdTask.id, turn: startedTurn },
      });
      return;
    }
    if (
      url.pathname === `/v1/projects/code-agent/tasks/${createdTask.id}` &&
      route.request().method() === "GET"
    ) {
      await snapshotGate;
      await route.fulfill({
        contentType: "application/json",
        json: {
          checkpoint: { sequence: 0, sessionId: "new-task-session" },
          snapshot: {
            ...createdTask,
            contextUsage: null,
            pendingRequests: [],
            settings: taskSnapshot.settings,
            status: "running",
            turns: [startedTurn],
          },
        },
      });
      snapshotResponseSent = true;
      return;
    }
    await route.fallback();
  });

  await page.goto("/p/code-agent");
  await page.getByRole("textbox", { name: "任务输入" }).fill("你好");
  await page.getByRole("button", { exact: true, name: "提交" }).click();

  await expect(page).toHaveURL(new RegExp(`/p/code-agent/t/${createdTask.id}$`, "u"));
  const main = page.getByRole("main", { name: "Task Timeline" });
  const sidebar = page.getByRole("complementary", { name: "Project Sidebar" });
  await expect(main.getByRole("heading", { name: "新聊天" })).toBeVisible();
  const timelineMessages = main.locator('[role="log"] article');
  await expect(timelineMessages.nth(0)).toContainText("你好");
  await expect(timelineMessages.nth(1)).toContainText("正在运行");
  const runningTaskLink = sidebar.getByRole("link", { name: "新聊天" });
  await expect(runningTaskLink).toHaveAttribute("aria-current", "page");
  await expect(runningTaskLink.getByRole("status", { name: "任务运行中" })).toBeVisible();
  await expect(runningTaskLink.locator(".task-age")).toHaveCount(0);
  await expect(main.getByText(createdTask.id, { exact: true })).toHaveCount(0);

  releaseSnapshotRequest();
  await expect.poll(() => snapshotResponseSent).toBe(true);
  // 运行中 Snapshot 尚未落入用户 Item 时，已提交消息也不能从 Timeline 消失。
  await expect(timelineMessages.nth(0)).toContainText("你好");
  await expect(timelineMessages.nth(1)).toContainText("正在运行");
});

test("stores new-chat text and attachments independently between projects", async ({ page }) => {
  await page.goto("/p/code-agent");
  const prompt = page.getByRole("textbox", { name: "任务输入" });
  await prompt.fill("保留这段新聊天草稿");
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "添加图片" }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
    mimeType: "image/png",
    name: "draft.png",
  });
  await expect(page.getByText("draft.png", { exact: true })).toBeVisible();

  const projectSelect = page.getByRole("combobox", { name: "选择新聊天项目" });
  await expect(projectSelect).toBeVisible();
  // 文件夹名称自身表达可切换状态，不再用远离文字的下拉图标提示。
  await expect(projectSelect).toHaveCSS("appearance", "none");
  await expect(projectSelect).toHaveCSS("text-align", "center");
  await expect(projectSelect).toHaveCSS("text-decoration-line", "underline");
  await expect(projectSelect.locator("xpath=following-sibling::*")).toHaveCount(0);
  await projectSelect.selectOption("superwork");

  await expect(page).toHaveURL(/\/p\/superwork$/);
  await expect(projectSelect).toHaveValue("superwork");
  await expect(prompt).toHaveAttribute("data-serialized-value", "");
  await expect(page.getByText("draft.png", { exact: true })).toHaveCount(0);
  const sidebar = page.getByRole("complementary", { name: "Project Sidebar" });
  // 切换当前 Project 不覆盖用户保存的文件夹展开形态。
  await expect(sidebar.getByRole("button", { name: "切换项目 superwork" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await expect(sidebar.getByRole("link", { name: "新聊天" })).toHaveCount(0);

  await projectSelect.selectOption("code-agent");

  await expect(page).toHaveURL(/\/p\/code-agent$/);
  await expect(prompt).toHaveAttribute("data-serialized-value", "保留这段新聊天草稿");
  await expect(page.getByText("draft.png", { exact: true })).toBeVisible();
});

test("toggles project tasks from the project name without navigation", async ({ page }) => {
  await page.goto("/p/code-agent/t/task-1");

  const sidebar = page.getByRole("complementary", { name: "Project Sidebar" });
  const task = sidebar.getByRole("link", { name: /优化输入框交互/ });
  await expect(task).toBeVisible();

  await sidebar.getByRole("button", { name: "切换项目 CodeAgent" }).click();
  await expect(task).not.toBeVisible();
  await expect(page).toHaveURL(/\/p\/code-agent\/t\/task-1$/);

  await expect(sidebar.getByRole("button", { name: "在 CodeAgent 中新建任务" })).toBeVisible();
  await sidebar.getByRole("button", { name: "切换项目 CodeAgent" }).click();
  await expect(task).toBeVisible();
  await expect(page).toHaveURL(/\/p\/code-agent\/t\/task-1$/);
});

test("loads one project task page only after showing more", async ({ page }) => {
  const taskListRequests: URL[] = [];
  page.on("request", (request) => {
    const requestUrl = new URL(request.url());
    if (requestUrl.pathname === "/v1/projects/code-agent/tasks") {
      taskListRequests.push(requestUrl);
    }
  });

  await page.goto("/p/code-agent/t/task-1");

  const sidebar = page.getByRole("complementary", { name: "Project Sidebar" });
  await expect.poll(() => taskListRequests.length).toBe(1);
  expect(taskListRequests[0]?.searchParams.get("limit")).toBe("5");
  expect(taskListRequests[0]?.searchParams.has("cursor")).toBe(false);
  await expect(sidebar.getByRole("link", { name: "补充 Protocol 契约" })).toHaveCount(0);

  await sidebar.getByRole("button", { name: "显示更多" }).click();

  await expect.poll(() => taskListRequests.length).toBe(2);
  expect(taskListRequests[1]?.searchParams.get("cursor")).toBe("5");
  expect(taskListRequests[1]?.searchParams.get("limit")).toBe("5");
  await expect(sidebar.getByRole("link", { name: "补充 Protocol 契约" })).toBeVisible();
});

test("keeps project add buttons visible after opening a task", async ({ page }) => {
  const longTask = {
    ...tasks[1],
    title: "这是一个用于验证项目树横向布局不会挤走右侧操作按钮的超长任务名称",
  };
  await page.route("**/v1/projects/code-agent/tasks?*", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: { data: [longTask, ...tasks.slice(2, 7)], nextCursor: null },
    });
  });
  await page.goto("/p/code-agent/t/task-1");

  const sidebar = page.getByRole("complementary", { name: "Project Sidebar" });
  await sidebar.getByRole("link", { name: longTask.title }).click();

  const layout = await sidebar.evaluate((element) => {
    const sidebarRect = element.getBoundingClientRect();
    const projectTree = element.querySelector<HTMLElement>('[data-testid="project-tree-scroll"]');
    const addButtons = [
      ...element.querySelectorAll<HTMLElement>(
        'button[aria-label*="添加项目"], button[aria-label^="在 "]',
      ),
    ];
    return {
      addButtonsInsideSidebar: addButtons.every((button) => {
        const rect = button.getBoundingClientRect();
        return rect.left >= sidebarRect.left && rect.right <= sidebarRect.right;
      }),
      hasHorizontalOverflow:
        projectTree === null ? true : projectTree.scrollWidth > projectTree.clientWidth,
      sidebarWidth: sidebarRect.width,
    };
  });

  expect(layout).toEqual({
    addButtonsInsideSidebar: true,
    hasHorizontalOverflow: false,
    sidebarWidth: 288,
  });
  await expect(sidebar.getByRole("button", { name: "添加项目" })).toBeVisible();
  await expect(sidebar.getByRole("button", { name: "在 CodeAgent 中新建任务" })).toBeVisible();
  await expect(sidebar.getByRole("button", { name: "在 superwork 中新建任务" })).toBeVisible();
});

test("preserves provisional IME text across composer rerenders", async ({ page }) => {
  await page.goto("/p/code-agent/t/task-1");

  const prompt = page.getByRole("textbox", { name: "任务输入" });
  await prompt.focus();
  await prompt.dispatchEvent("compositionstart");
  await prompt.evaluate((editor) => {
    if (!(editor instanceof HTMLDivElement) || editor.contentEditable !== "true") {
      throw new Error("任务输入不是可编辑区域");
    }
    // 中文输入法首键先写入组合缓冲，此时还不会触发 React onChange。
    editor.textContent = "n";
    editor.dispatchEvent(new CompositionEvent("compositionupdate", { data: "n" }));
  });

  await page.getByRole("combobox", { name: "批准模式" }).evaluate((select) => {
    if (!(select instanceof HTMLSelectElement)) {
      throw new Error("批准模式不是 select");
    }
    select.value = "never";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });

  await expect(prompt).toHaveText("n");
});

test("uses material hierarchy instead of strong workbench borders", async ({ page }) => {
  await page.goto("/p/code-agent/t/task-1");
  await expect(page.locator('[role="log"] > div')).toBeVisible();

  const presentation = await page.evaluate(() => {
    const sidebar = document.querySelector<HTMLElement>('[aria-label="Project Sidebar"]');
    const inspector = document.querySelector<HTMLElement>('[aria-label="Context Inspector"]');
    const timeline = document.querySelector<HTMLElement>('[aria-label="Task Timeline"]');
    const sidebarToolbar = sidebar?.querySelector<HTMLElement>(":scope > div") ?? null;
    const inspectorToolbar = inspector?.querySelector<HTMLElement>(":scope > div") ?? null;
    const toolbar = timeline?.querySelector<HTMLElement>("header") ?? null;
    const timelineContent = document.querySelector<HTMLElement>('[role="log"] > div');
    const composerRegion = document.querySelector<HTMLElement>('[aria-label="Composer"]');
    const composer = document.querySelector<HTMLElement>('[aria-label="Composer"] form');

    if (
      sidebar === null ||
      inspector === null ||
      timeline === null ||
      sidebarToolbar === null ||
      inspectorToolbar === null ||
      toolbar === null ||
      timelineContent === null ||
      composerRegion === null ||
      composer === null
    ) {
      throw new Error("workbench surfaces are missing");
    }

    const composerRegionStyles = getComputedStyle(composerRegion);
    const sidebarStyles = getComputedStyle(sidebar);
    const sidebarToolbarStyles = getComputedStyle(sidebarToolbar);
    const inspectorStyles = getComputedStyle(inspector);
    const inspectorToolbarStyles = getComputedStyle(inspectorToolbar);
    const timelineStyles = getComputedStyle(timeline);
    const timelineContentStyles = getComputedStyle(timelineContent);
    const toolbarStyles = getComputedStyle(toolbar);
    const composerStyles = getComputedStyle(composer);
    // 将布局断言绑定到语义 Token，避免 Toolbar 尺寸调整后测试保留旧字面值。
    const workbenchHeaderProbe = document.createElement("div");
    workbenchHeaderProbe.style.height = "var(--ui-layout-workbench-header-height)";
    document.body.append(workbenchHeaderProbe);
    const workbenchHeaderHeight = getComputedStyle(workbenchHeaderProbe).height;
    workbenchHeaderProbe.remove();

    return {
      composerBorder: composerStyles.borderTopWidth,
      composerBorderColor: composerStyles.borderTopColor,
      composerBottomPadding: Number.parseFloat(composerRegionStyles.paddingBottom),
      composerShadow: composerStyles.boxShadow,
      inspectorBorder: inspectorStyles.borderLeftWidth,
      inspectorColor: inspectorStyles.backgroundColor,
      inspectorShadow: inspectorStyles.boxShadow,
      inspectorToolbarShadow: inspectorToolbarStyles.boxShadow,
      sidebarBorder: sidebarStyles.borderRightWidth,
      sidebarColor: sidebarStyles.backgroundColor,
      sidebarShadow: sidebarStyles.boxShadow,
      sidebarToolbarShadow: sidebarToolbarStyles.boxShadow,
      timelineColor: timelineStyles.backgroundColor,
      timelineTopPadding: Number.parseFloat(timelineContentStyles.paddingTop),
      toolbarHeight: toolbarStyles.height,
      toolbarShadow: toolbarStyles.boxShadow,
      workbenchHeaderHeight,
    };
  });

  expect(presentation.sidebarBorder).toBe("0px");
  expect(presentation.inspectorBorder).toBe("0px");
  expect(presentation.composerBorder).toBe("1px");
  expect(presentation.composerBorderColor).toBe("rgba(0, 0, 0, 0)");
  expect(presentation.sidebarShadow).toContain("1px 0px 0px 0px");
  expect(presentation.inspectorShadow).toContain("-1px 0px 0px 0px");
  expect(presentation.sidebarToolbarShadow).toBe("none");
  expect(presentation.inspectorToolbarShadow).toBe("none");
  expect(presentation.toolbarShadow).toContain("0px 1px 0px 0px");
  expect(presentation.composerShadow).not.toBe("none");
  expect(presentation.sidebarColor).toBe(presentation.timelineColor);
  expect(presentation.inspectorColor).toBe(presentation.timelineColor);
  expect(presentation.toolbarHeight).toBe(presentation.workbenchHeaderHeight);
  expect(presentation.timelineTopPadding).toBeLessThanOrEqual(28);
  expect(presentation.composerBottomPadding).toBeLessThanOrEqual(8);
});

test("supports structured activity without Escape changing panel state", async ({ page }) => {
  await page.goto("/p/code-agent/t/task-1");

  await expect(page.getByText("思考过程", { exact: true })).toHaveCount(0);
  await expect(page.getByText("分析工作台信息架构", { exact: true })).toHaveCount(0);
  await page.getByText("读取 Web 设计规范").click();
  await expect(page.getByText("docs/web-design.md")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByRole("complementary", { name: "Project Sidebar" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Context Inspector" })).toBeVisible();
});

test("keeps the narrow workbench layout stable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/p/code-agent/t/task-1");

  await expect(page.getByRole("complementary", { name: "Project Sidebar" })).not.toBeVisible();
  await page.getByRole("button", { name: "展开项目侧栏" }).click();
  await expect(page.getByRole("complementary", { name: "Project Sidebar" })).toBeVisible();
  await page
    .getByRole("complementary", { name: "Project Sidebar" })
    .getByRole("button", { name: "关闭项目侧栏" })
    .click();

  const timelineBox = await page.getByRole("main", { name: "Task Timeline" }).boundingBox();

  expect(timelineBox).not.toBeNull();
  expect(timelineBox?.x).toBe(0);
  expect(timelineBox?.width).toBe(390);

  const hasHorizontalOverflow = await page
    .locator("html")
    .evaluate((root) => root.scrollWidth > root.clientWidth);
  expect(hasHorizontalOverflow).toBe(false);
});

test("closes open workbench panels when the window becomes narrow", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/p/code-agent/t/task-1");

  await expect(page.getByRole("complementary", { name: "Project Sidebar" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Context Inspector" })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });

  await expect(page.getByRole("complementary", { name: "Project Sidebar" })).not.toBeVisible();
  await expect(page.getByRole("complementary", { name: "Context Inspector" })).not.toBeVisible();
});

test("renders a route-level not-found state", async ({ page }) => {
  await page.goto("/missing-route");

  await expect(page.getByRole("heading", { name: "页面不存在" })).toBeVisible();
  await expect(page.getByRole("link", { name: "返回工作台" })).toHaveAttribute("href", "/");
});
