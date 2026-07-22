import { expect, test } from "@playwright/test";

test("redirects the root route to the default project workbench", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByTestId("app-root")).toBeAttached();
  await expect(page).toHaveURL(/\/p\/code-agent-window$/);
  await expect(page.getByRole("main", { name: "Task Timeline" })).toBeVisible();
});

test("provides reusable design tokens for light and dark themes", async ({ page }) => {
  await page.goto("/p/code-agent-window");
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
    { path: "/p/code-agent-window", heading: "CodeAgentWindow" },
    { path: "/p/code-agent-window/t/task-1", heading: "构建 macOS 工作台" },
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
      path: "/p/code-agent-window",
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
  await page.goto("/p/code-agent-window/t/task-1");

  await expect(page.getByRole("complementary", { name: "Project Sidebar" })).toBeVisible();
  await expect(page.getByRole("main", { name: "Task Timeline" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Context Inspector" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "环境信息" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Composer" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "任务输入" })).toBeDisabled();
  await expect(page.getByRole("button", { exact: true, name: "提交" })).toBeDisabled();
  await expect(page.getByText("工作台界面已按统一的 AI Elements 结构重新组织。")).toBeVisible();
});

test("orders localized task actions, pinned tasks and projects in the sidebar", async ({
  page,
}) => {
  await page.goto("/p/code-agent-window/t/task-1");

  const sidebar = page.getByRole("complementary", { name: "Project Sidebar" });
  const newAgent = sidebar.getByRole("link", { name: "新建任务" });
  const search = sidebar.getByRole("button", { name: "搜索" });
  const productHome = sidebar.getByRole("link", { name: "CodeAgentWindow 首页" });
  await expect(productHome).toBeVisible();
  await expect(productHome.getByText("CodeAgentWindow", { exact: true })).toBeVisible();

  const readPrimaryActionStyle = async (selector: typeof newAgent) =>
    selector.evaluate((element) => {
      const icon = element.querySelector("svg")?.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return {
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        iconHeight: icon?.height,
        iconWidth: icon?.width,
        lineHeight: style.lineHeight,
      };
    });
  expect(await readPrimaryActionStyle(search)).toEqual(await readPrimaryActionStyle(newAgent));

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
  expect(newAgentBox.y).toBeLessThan(searchBox.y);
  expect(searchBox.y).toBeLessThan(pinnedBox.y);
  expect(pinnedBox.y).toBeLessThan(projectsBox.y);
});

test("searches tasks across projects", async ({ page }) => {
  await page.goto("/p/code-agent-window/t/task-1");

  const sidebar = page.getByRole("complementary", { name: "Project Sidebar" });
  await sidebar.getByRole("button", { name: "搜索" }).click();
  await sidebar.getByRole("textbox", { name: "搜索任务" }).fill("Markdown");

  await expect(sidebar.getByRole("link", { name: /完善 Markdown 渲染/ })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: /构建 macOS 工作台/ })).not.toBeVisible();
});

test("adds a selected folder as a project and navigates to it", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: () => Promise.resolve({ kind: "directory", name: "New Demo" }),
    });
  });
  await page.goto("/p/code-agent-window");

  const sidebar = page.getByRole("complementary", { name: "Project Sidebar" });
  await sidebar.getByRole("button", { name: "添加项目文件夹" }).click();

  await expect(sidebar.getByText("New Demo", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/p\/new-demo$/);
});

test("uses material hierarchy instead of strong workbench borders", async ({ page }) => {
  await page.goto("/p/code-agent-window/t/task-1");

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
  await page.goto("/p/code-agent-window/t/task-1");

  await page.getByText("读取 Web 设计规范").click();
  await expect(page.getByText("docs/web-design.md")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByRole("complementary", { name: "Context Inspector" })).not.toBeVisible();
});

test("keeps the narrow workbench layout stable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/p/code-agent-window/t/task-1");

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
  await page.goto("/p/code-agent-window/t/task-1");

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
