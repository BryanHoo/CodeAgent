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
          id: "message-2",
          role: "assistant",
          text: "工作台界面已按统一的 AI Elements 结构重新组织。",
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

test.beforeEach(async ({ page }) => {
  await page.route("**/v1/**", async (route) => {
    const url = new URL(route.request().url());
    let body: unknown;

    if (url.pathname === "/v1/health") {
      body = { status: "ok", version: 1 };
    } else if (url.pathname === "/v1/capabilities") {
      body = { provider: "codex", tasks: { list: true, read: true } };
    } else if (url.pathname === "/v1/projects") {
      body = { data: projects, nextCursor: null };
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

test("renders the AI workbench landmarks without enabling runtime actions", async ({ page }) => {
  await page.goto("/p/code-agent/t/task-1");

  const main = page.getByRole("main", { name: "Task Timeline" });
  const inspector = page.getByRole("complementary", { name: "Context Inspector" });
  await expect(page.getByRole("complementary", { name: "Project Sidebar" })).toBeVisible();
  await expect(main).toBeVisible();
  await expect(inspector).toBeVisible();
  await expect(page.getByRole("heading", { name: "环境信息" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Composer" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "任务输入" })).toBeDisabled();
  await expect(page.getByRole("combobox", { name: "批准模式" })).toHaveValue("on-request");
  await expect(page.getByText("本地", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { exact: true, name: "提交" })).toBeDisabled();
  await expect(main.locator("header").getByText("CodeAgent", { exact: true })).toHaveCount(0);
  await expect(page.getByText("本地离线", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("项目路径")).toHaveText("~/Develop/person/CodeAgent");
  await expect(inspector.getByRole("button", { name: "关闭上下文面板" })).toHaveCount(0);
  await expect(page.getByText("工作台界面已按统一的 AI Elements 结构重新组织。")).toBeVisible();
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

test("streams Fake App Server notifications into the Timeline", async ({ page }) => {
  await page.unroute("**/v1/**");
  await page.goto("/p/code-agent/t/task-realtime");

  await expect(page.getByText("Realtime connected", { exact: true })).toBeVisible();
  await page.getByText("pnpm check", { exact: true }).click();
  await expect(page.getByText("Done", { exact: true })).toBeVisible();
  await expect(page.getByText("模型服务不可用", { exact: true })).toBeVisible();
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
  expect(presentation.composerBorder).toBe("0px");
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
