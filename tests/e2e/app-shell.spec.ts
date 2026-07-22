import { expect, test } from "@playwright/test";

test("redirects the root route to the workspace index", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByTestId("app-root")).toBeAttached();
  await expect(page).toHaveURL(/\/workspaces$/);
  await expect(page.getByRole("heading", { name: "Workspaces" })).toBeVisible();
});

test("provides reusable design tokens for light and dark themes", async ({ page }) => {
  await page.goto("/workspaces");
  await page.locator("html").evaluate((root) => {
    root.setAttribute("data-theme", "light");
  });

  const lightTokens = await page.locator("html").evaluate((root) => {
    const styles = getComputedStyle(root);
    return {
      bodyFontSize: styles.getPropertyValue("--ui-font-size-body").trim(),
      canvasColor: styles.backgroundColor,
      controlRadius: styles.getPropertyValue("--ui-radius-control").trim(),
      panelShadow: styles.getPropertyValue("--ui-shadow-panel").trim(),
      spaceUnit: styles.getPropertyValue("--ui-space-unit").trim(),
      windowColor: styles.getPropertyValue("--ui-color-window").trim(),
    };
  });

  expect(lightTokens).toEqual({
    bodyFontSize: expect.stringMatching(/^0?\.875rem$/),
    canvasColor: expect.stringContaining("oklch"),
    controlRadius: "6px",
    panelShadow: expect.stringContaining("oklch"),
    spaceUnit: expect.stringMatching(/^0?\.25rem$/),
    windowColor: expect.stringContaining("oklch"),
  });

  await page.locator("html").evaluate((root) => {
    root.setAttribute("data-theme", "dark");
  });
  const darkCanvasColor = await page
    .locator("html")
    .evaluate((root) => getComputedStyle(root).backgroundColor);

  expect(darkCanvasColor).not.toBe(lightTokens.canvasColor);
});

test("exposes the documented navigation routes", async ({ page }) => {
  const routes = [
    { path: "/login", heading: "登录" },
    { path: "/workspaces", heading: "Workspaces" },
    { path: "/w/demo", heading: "demo" },
    { path: "/w/demo/t/thread-1", heading: "构建 macOS 工作台" },
    { path: "/settings", heading: "设置" },
  ];

  for (const route of routes) {
    await page.goto(route.path);
    await expect(
      page.getByRole("main").getByRole("heading", { name: route.heading }),
    ).toBeVisible();
  }
});

test("uses the shared material theme across registered routes", async ({ page }) => {
  const surfaces = [
    { path: "/login", selector: "header", border: "borderBottomWidth" },
    { path: "/workspaces", selector: "header", border: "borderBottomWidth" },
    { path: "/settings", selector: "aside", border: "borderRightWidth" },
    { path: "/missing-route", selector: "main section", border: "borderLeftWidth" },
  ] as const;

  for (const surface of surfaces) {
    await page.goto(surface.path);
    const styles = await page.locator(surface.selector).evaluate((element, border) => {
      const computed = getComputedStyle(element);
      return {
        borderWidth: computed[border],
        boxShadow: computed.boxShadow,
      };
    }, surface.border);

    expect(styles.borderWidth).toBe("0px");
    expect(styles.boxShadow).not.toBe("none");
  }
});

test("renders the AI workbench landmarks without enabling runtime actions", async ({ page }) => {
  await page.goto("/w/demo/t/thread-1");

  await expect(page.getByRole("complementary", { name: "Thread Sidebar" })).toBeVisible();
  await expect(page.getByRole("main", { name: "Thread Timeline" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Context Inspector" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Composer" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "任务输入" })).toBeDisabled();
  await expect(page.getByRole("button", { exact: true, name: "提交" })).toBeDisabled();
  await expect(page.getByText("工作台界面已按统一的 AI Elements 结构重新组织。")).toBeVisible();
});

test("uses material hierarchy instead of strong workbench borders", async ({ page }) => {
  await page.goto("/w/demo/t/thread-1");

  const presentation = await page.evaluate(() => {
    const sidebar = document.querySelector<HTMLElement>('[aria-label="Thread Sidebar"]');
    const inspector = document.querySelector<HTMLElement>('[aria-label="Context Inspector"]');
    const timeline = document.querySelector<HTMLElement>('[aria-label="Thread Timeline"]');
    const composer = document.querySelector<HTMLElement>('[aria-label="Composer"] form');

    if (sidebar === null || inspector === null || timeline === null || composer === null) {
      throw new Error("workbench surfaces are missing");
    }

    const sidebarStyles = getComputedStyle(sidebar);
    const inspectorStyles = getComputedStyle(inspector);
    const timelineStyles = getComputedStyle(timeline);
    const composerStyles = getComputedStyle(composer);

    return {
      composerBorder: composerStyles.borderTopWidth,
      composerShadow: composerStyles.boxShadow,
      inspectorBorder: inspectorStyles.borderLeftWidth,
      inspectorColor: inspectorStyles.backgroundColor,
      inspectorShadow: inspectorStyles.boxShadow,
      sidebarBorder: sidebarStyles.borderRightWidth,
      sidebarColor: sidebarStyles.backgroundColor,
      sidebarShadow: sidebarStyles.boxShadow,
      timelineColor: timelineStyles.backgroundColor,
    };
  });

  expect(presentation.sidebarBorder).toBe("0px");
  expect(presentation.inspectorBorder).toBe("0px");
  expect(presentation.composerBorder).toBe("0px");
  expect(presentation.sidebarShadow).not.toBe("none");
  expect(presentation.inspectorShadow).not.toBe("none");
  expect(presentation.composerShadow).not.toBe("none");
  expect(presentation.sidebarColor).not.toBe(presentation.timelineColor);
  expect(presentation.inspectorColor).not.toBe(presentation.timelineColor);
});

test("supports structured activity and keyboard panel dismissal", async ({ page }) => {
  await page.goto("/w/demo/t/thread-1");

  await page.getByText("读取 Web 设计规范").click();
  await expect(page.getByText("docs/web-design.md")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByRole("complementary", { name: "Context Inspector" })).not.toBeVisible();
});

test("keeps the narrow workbench layout stable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/w/demo/t/thread-1");

  await expect(page.getByRole("complementary", { name: "Thread Sidebar" })).not.toBeVisible();
  await page.getByRole("button", { name: "展开任务侧栏" }).click();
  await expect(page.getByRole("complementary", { name: "Thread Sidebar" })).toBeVisible();
  await page
    .getByRole("complementary", { name: "Thread Sidebar" })
    .getByRole("button", { name: "关闭任务侧栏" })
    .click();

  const timelineBox = await page.getByRole("main", { name: "Thread Timeline" }).boundingBox();

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
  await page.goto("/w/demo/t/thread-1");

  await expect(page.getByRole("complementary", { name: "Thread Sidebar" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Context Inspector" })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });

  await expect(page.getByRole("complementary", { name: "Thread Sidebar" })).not.toBeVisible();
  await expect(page.getByRole("complementary", { name: "Context Inspector" })).not.toBeVisible();
});

test("renders a route-level not-found state", async ({ page }) => {
  await page.goto("/missing-route");

  await expect(page.getByRole("heading", { name: "页面不存在" })).toBeVisible();
  await expect(page.getByRole("link", { name: "返回 Workspaces" })).toHaveAttribute(
    "href",
    "/workspaces",
  );
});
