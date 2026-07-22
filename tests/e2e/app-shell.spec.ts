import { expect, test } from "@playwright/test";

test("redirects the root route to the workspace index", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByTestId("app-root")).toBeAttached();
  await expect(page).toHaveURL(/\/workspaces$/);
  await expect(page.getByRole("heading", { name: "Workspaces" })).toBeVisible();
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

test("renders a route-level not-found state", async ({ page }) => {
  await page.goto("/missing-route");

  await expect(page.getByRole("heading", { name: "页面不存在" })).toBeVisible();
  await expect(page.getByRole("link", { name: "返回 Workspaces" })).toHaveAttribute(
    "href",
    "/workspaces",
  );
});
