import { expect, test } from "@playwright/test";

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
    id: "plan-check",
    pinned: false,
    projectId: "superwork",
    title: "优化计划预检反馈",
    updatedAt: "2026-07-21T09:00:00.000Z",
  },
];

const taskSnapshot = {
  ...tasks[0],
  contextUsage: { contextWindow: 200_000, usedTokens: 25_000 },
  pendingRequests: [],
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
              diff: [
                "--- a/package.json",
                "+++ b/package.json",
                "@@ -1,3 +1,3 @@",
                " {",
                '-  "start": "pnpm run dev",',
                '+  "start": "node ./dist/cli.js start --project .",',
                " }",
              ].join("\n"),
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
  lineIndex === 715 ? "### 11.7 认证" : `line ${String(lineIndex + 1)}`,
).join("\n");

test.beforeEach(async ({ page }) => {
  await page.route("**/v1/**", async (route) => {
    const url = new URL(route.request().url());
    let body: unknown;

    if (url.pathname === "/v1/health") {
      body = { status: "ok", version: 1 };
    } else if (url.pathname === "/v1/capabilities") {
      body = {
        provider: "codex",
        tasks: { list: true, read: true, start: true },
        turns: { interrupt: true, rollback: true, start: true },
      };
    } else if (url.pathname === "/v1/models") {
      body = { data: models, nextCursor: null };
    } else if (url.pathname === "/v1/projects") {
      body = { data: projects, nextCursor: null };
    } else if (url.pathname === "/v1/projects/code-agent/files/source") {
      body = {
        content: architectureSourcePreview,
        path: "docs/architecture-design.md",
        truncated: true,
      };
    } else if (url.pathname.startsWith("/v1/projects/") && url.pathname.endsWith("/tasks")) {
      const projectId = url.pathname.split("/")[3];
      body = { data: tasks.filter((task) => task.projectId === projectId), nextCursor: null };
    } else if (url.pathname === "/v1/tasks/task-1") {
      body = taskSnapshotResponse;
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
    { path: "/login", heading: "登录" },
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

test("removes the legacy workspace routes", async ({ page }) => {
  for (const path of ["/workspaces", "/w/demo", "/w/demo/t/thread-1"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "页面不存在" })).toBeVisible();
  }
});

test("uses subtle hairline separation across registered routes", async ({ page }) => {
  const surfaces = [
    {
      path: "/login",
      selector: "header",
      border: "borderBottomWidth",
      offset: "0px 1px 0px 0px",
    },
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

test("opens bounded source previews from assistant file references", async ({ page }) => {
  await page.goto("/p/code-agent/t/task-1");

  await page.getByRole("button", { name: "architecture-design.md(line 716)" }).click();

  const dialog = page.getByRole("dialog", { name: "architecture-design.md (line 716)" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("内容已截断")).toBeVisible();
  await expect(dialog.locator('[data-source-line="716"]')).toContainText("### 11.7 认证");
  await expect(dialog.locator('[data-source-line="716"]')).toHaveClass(/bg-accent-soft/u);
  await expect(dialog.locator('[data-source-line="716"]')).toHaveClass(/text-accent-strong/u);
});

test("submits attachments, approval policy, model, and reasoning effort through the real client contract", async ({
  page,
}) => {
  let uploadBody: unknown;
  let turnBody: unknown;
  await page.route("**/v1/attachments", async (route) => {
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
  await page.route("**/v1/tasks/task-1/turns", async (route) => {
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
  await page.getByRole("combobox", { name: "批准模式" }).selectOption("never");
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
  await page.getByRole("textbox", { name: "任务输入" }).fill("按截图完成改造");
  await page.getByRole("button", { exact: true, name: "提交" }).click();

  await expect(page.getByRole("textbox", { name: "任务输入" })).toHaveValue("");
  await expect(page.getByText("screen.png", { exact: true })).toHaveCount(0);
  expect(uploadBody).toMatchObject({
    dataUrl: expect.stringMatching(/^data:image\/png;base64,/),
    name: "screen.png",
  });
  expect(turnBody).toEqual({
    input: {
      attachments: [{ id: "attachment-1" }],
      text: "按截图完成改造",
      type: "prompt",
    },
    options: { approvalPolicy: "never", model: "gpt-5.6-terra", reasoningEffort: "low" },
  });
});

test("opens file diffs from the timeline and inspector", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
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

  await page.getByRole("button", { name: "打开 package.json 的 Diff" }).click();
  await expect(page.getByRole("dialog", { name: "package.json" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "package.json" })).not.toBeAttached();
  expect(consoleErrors).toEqual([]);
});

test("disables composer mutations that the provider does not support", async ({ page }) => {
  await page.route("**/v1/capabilities", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        provider: "readonly",
        tasks: { list: true, read: true, start: false },
        turns: { interrupt: false, rollback: false, start: false },
      },
    });
  });
  await page.goto("/p/code-agent");

  await page.getByRole("textbox", { name: "任务输入" }).fill("不应允许提交");

  await expect(page.getByRole("button", { exact: true, name: "提交" })).toBeDisabled();
});

test("isolates composer state between task routes", async ({ page }) => {
  await page.route("**/v1/tasks/input-design", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        checkpoint: { sequence: 0, sessionId: "e2e-session" },
        snapshot: {
          ...tasks[1],
          contextUsage: null,
          pendingRequests: [],
          status: "idle",
          turns: [],
        },
      },
    });
  });
  await page.goto("/p/code-agent/t/task-1");
  await page.getByRole("textbox", { name: "任务输入" }).fill("只属于 Task A 的草稿");

  await page.getByRole("link", { name: /优化输入框交互/ }).click();

  await expect(page).toHaveURL(/\/p\/code-agent\/t\/input-design$/);
  await expect(page.getByRole("textbox", { name: "任务输入" })).toHaveValue("");
  await expect(page.getByRole("button", { exact: true, name: "提交" })).toBeDisabled();
});

test("shows a task error when the initial snapshot request fails", async ({ page }) => {
  await page.route("**/v1/tasks/task-1", async (route) => {
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
  await page.route("**/v1/tasks/task-1", async (route) => {
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
              version: 1,
            },
            {
              latestSequence: 8,
              reason: "event_retention_exceeded",
              sessionId: "e2e-session",
              type: "resync.required",
              version: 1,
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
  await page.route("**/v1/tasks/task-1", async (route) => {
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
    let burstSent = false;

    class BurstingWebSocket extends EventTarget {
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
          this.dispatchEvent(
            new MessageEvent("message", {
              data: JSON.stringify({
                latestSequence: 1_001,
                sessionId: "e2e-session",
                type: "connection.ready",
                version: 1,
              }),
            }),
          );
          if (burstSent) {
            return;
          }
          burstSent = true;
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
                  version: 1,
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
  await page.route("**/v1/tasks/task-1", async (route) => {
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
    let failureSent = false;
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
                  version: 1,
                }),
              }),
            );
          };
          if (failureSent) {
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
          failureSent = true;
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
  await page.route("**/v1/pending-requests/*/resolve", async (route) => {
    resolutionCount += 1;
    await new Promise((resolve) => setTimeout(resolve, 100));
    await route.fulfill({
      contentType: "application/json",
      json: { request: { ...pendingRequest, status: "resolved" } },
    });
  });
  await page.route("**/v1/tasks/task-1", async (route) => {
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
  await page.route("**/v1/pending-requests/*/resolve", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    await route.fulfill({
      contentType: "application/json",
      json: { request: { ...pendingRequest, status: "resolved" } },
    });
  });
  await page.route("**/v1/tasks/task-1", async (route) => {
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

  await expect(page.getByText("Realtime connected", { exact: true })).toBeVisible();
  await page.getByText("pnpm check", { exact: true }).click();
  await expect(page.getByText("Done", { exact: true })).toBeVisible();
  await expect(page.getByText("模型服务不可用", { exact: true })).toBeVisible();
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
  await page.route("**/v1/turns/*/interrupt", async (route) => {
    const request = route.request();
    const payload = request.postDataJSON() as { taskId: string };
    const turnId = new URL(request.url()).pathname.split("/")[3] ?? "";
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
  await page.route("**/v1/attachments", async (route) => {
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
  await expect(prompt).toHaveValue("失败后保留这段草稿");
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

test("toggles project tasks from both project controls without navigation", async ({ page }) => {
  await page.goto("/p/code-agent/t/task-1");

  const sidebar = page.getByRole("complementary", { name: "Project Sidebar" });
  const task = sidebar.getByRole("link", { name: /优化输入框交互/ });
  await expect(task).toBeVisible();

  await sidebar.getByRole("button", { name: "切换项目 CodeAgent" }).click();
  await expect(task).not.toBeVisible();
  await expect(page).toHaveURL(/\/p\/code-agent\/t\/task-1$/);

  await sidebar.getByRole("button", { name: "展开项目 CodeAgent" }).click();
  await expect(task).toBeVisible();
  await expect(page).toHaveURL(/\/p\/code-agent\/t\/task-1$/);
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
  expect(presentation.toolbarHeight).toBe("44px");
  expect(presentation.timelineTopPadding).toBeLessThanOrEqual(28);
  expect(presentation.composerBottomPadding).toBeLessThanOrEqual(8);
});

test("supports structured activity and keyboard panel dismissal", async ({ page }) => {
  await page.goto("/p/code-agent/t/task-1");

  await page.getByText("读取 Web 设计规范").click();
  await expect(page.getByText("docs/web-design.md")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByRole("complementary", { name: "Context Inspector" })).not.toBeVisible();
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
