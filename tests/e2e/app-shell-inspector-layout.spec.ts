import { expect, taskSnapshot, tasks, test } from "./fixtures/app-shell.js";

test.describe.configure({ mode: "serial" });

test("orders persistent search, task actions, pinned tasks and projects in the sidebar", async ({
  page,
}) => {
  await page.goto("/p/code-agent/t/task-1");

  const sidebar = page.getByRole("complementary", { name: "项目侧栏" });
  const newAgent = sidebar.getByRole("link", { name: "新建任务" });
  const search = sidebar.getByRole("textbox", { name: "搜索任务" });
  const productBrand = sidebar.getByText("CodeAgent", { exact: true }).first();
  await expect(productBrand).toBeVisible();
  await expect(search).toBeVisible();
  await expect(sidebar.getByRole("button", { name: "搜索" })).toHaveCount(0);
  await expect(sidebar.getByRole("button", { name: "添加项目" })).toBeVisible();

  const newAgentBox = await newAgent.boundingBox();
  const searchBox = await search.boundingBox();
  const pinnedBox = await sidebar.getByRole("heading", { name: "已固定" }).boundingBox();
  const projectsBox = await sidebar.getByRole("heading", { name: "项目" }).boundingBox();
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

test("keeps the original sidebar logo and provides it as favicon", async ({ page }) => {
  await page.goto("/p/code-agent");

  const sidebar = page.getByRole("complementary", { name: "项目侧栏" });
  const productBrand = sidebar.getByText("CodeAgent", { exact: true }).first().locator("..");
  const brandMark = productBrand.getByText("CA", { exact: true });

  await expect(brandMark).toBeVisible();
  await expect(brandMark).toHaveClass(/bg-foreground/);
  await expect(productBrand.locator('img[src="/favicon.svg"]')).toHaveCount(0);
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute("href", "/favicon.svg?v=2");

  expect(
    await brandMark.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        borderRadius: style.borderRadius,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        height: style.height,
        width: style.width,
      };
    }),
  ).toEqual({
    borderRadius: "6px",
    fontSize: "10px",
    fontWeight: "700",
    height: "28px",
    width: "28px",
  });

  const faviconResponse = await page.request.get("/favicon.svg?v=2");
  expect(faviconResponse.ok()).toBe(true);
  const favicon = await faviconResponse.text();
  const faviconDefinition = await page.evaluate((source) => {
    const document = new DOMParser().parseFromString(source, "image/svg+xml");
    const root = document.documentElement;
    const rectangle = document.querySelector("rect");
    const text = document.querySelector("text");
    return {
      fontSize: text?.getAttribute("font-size"),
      fontWeight: text?.getAttribute("font-weight"),
      height: rectangle?.getAttribute("height"),
      label: text?.textContent,
      radius: rectangle?.getAttribute("rx"),
      styles: document.querySelector("style")?.textContent,
      viewBox: root.getAttribute("viewBox"),
      width: rectangle?.getAttribute("width"),
    };
  }, favicon);
  expect(faviconDefinition).toMatchObject({
    fontSize: "10",
    fontWeight: "700",
    height: "28",
    label: "CA",
    radius: "6",
    viewBox: "0 0 28 28",
    width: "28",
  });
  expect(faviconDefinition.styles).toContain('"Geist", "Inter", -apple-system');
  expect(faviconDefinition.styles).toContain("@media (prefers-color-scheme: dark)");
});

test("adds a folder through the host project picker", async ({ page }) => {
  let addProjectRequestCount = 0;
  await page.route("**/v1/projects", async (route) => {
    if (route.request().method() === "POST") {
      addProjectRequestCount += 1;
    }
    await route.fallback();
  });
  await page.goto("/p/code-agent");

  await page.getByRole("button", { name: "添加项目" }).evaluate((button) => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

  await expect(page).toHaveURL(/\/p\/added-project$/);
  expect(addProjectRequestCount).toBe(1);
  await expect(page.getByRole("heading", { name: "AddedProject" })).toBeVisible();
  await expect(
    page.getByRole("complementary", { name: "项目侧栏" }).getByRole("link", { name: "新聊天" }),
  ).toHaveCount(0);
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

  const sidebar = page.getByRole("complementary", { name: "项目侧栏" });
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

  const sidebar = page.getByRole("complementary", { name: "项目侧栏" });
  await sidebar.getByRole("link", { name: "新建任务" }).click();
  await expect(page).toHaveURL(/\/p\/code-agent$/);
  await expect(sidebar.getByRole("link", { name: "新聊天" })).toHaveCount(0);

  // 已经位于首个项目的新聊天时继续复用当前草稿，不创建空 Codex Task。
  await sidebar.getByRole("link", { name: "新建任务" }).click();
  await expect(page).toHaveURL(/\/p\/code-agent$/);
  await sidebar.getByRole("button", { name: "在 superwork 中新建任务" }).click();
  await expect(page).toHaveURL(/\/p\/superwork$/);
  await expect(sidebar.getByRole("link", { name: "新聊天" })).toHaveCount(0);
  expect(taskCreationRequests).toEqual([]);
});

test("shows a newly submitted task and AI reply state before the task snapshot loads", async ({
  page,
}) => {
  let taskStartRequestCount = 0;
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
  let releaseTurnStartRequest: () => void = () => undefined;
  const turnStartGate = new Promise<void>((resolve) => {
    releaseTurnStartRequest = resolve;
  });
  let releaseSnapshotRequest: () => void = () => undefined;
  let snapshotResponseSent = false;
  const snapshotGate = new Promise<void>((resolve) => {
    releaseSnapshotRequest = resolve;
  });

  await page.route("**/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/v1/projects/code-agent/tasks" && route.request().method() === "POST") {
      taskStartRequestCount += 1;
      await route.fulfill({ contentType: "application/json", json: { task: createdTask } });
      return;
    }
    if (
      url.pathname === `/v1/projects/code-agent/tasks/${createdTask.id}/turns` &&
      route.request().method() === "POST"
    ) {
      await turnStartGate;
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
          checkpoint: { sequence: 0, sessionId: "e2e-session" },
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
  await page.getByRole("button", { exact: true, name: "提交" }).evaluate((button) => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await expect.poll(() => taskStartRequestCount).toBe(1);

  // Codex 返回真实 taskId 后立即写入并选中 Sidebar，中栏仍保留可重试的 Project 草稿。
  await expect(page).toHaveURL(/\/p\/code-agent$/u);
  const main = page.getByRole("main", { name: "任务时间线" });
  const sidebar = page.getByRole("complementary", { name: "项目侧栏" });
  const runningTaskLink = sidebar.getByRole("link", { name: "新聊天" });
  await expect(runningTaskLink).toHaveAttribute("aria-current", "page");

  releaseTurnStartRequest();

  await expect(page).toHaveURL(new RegExp(`/p/code-agent/t/${createdTask.id}$`, "u"));
  await expect(main.getByRole("heading", { name: "新聊天" })).toBeVisible();
  const timelineMessages = main.locator('[role="log"] article');
  await expect(timelineMessages.nth(0)).toContainText("你好");
  await expect(timelineMessages.nth(1)).toContainText("正在运行");
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
  await page.getByRole("button", { name: "添加图片或文件" }).click();
  await page.getByRole("menuitem", { name: "添加图片" }).click();
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
  const sidebar = page.getByRole("complementary", { name: "项目侧栏" });
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

  const sidebar = page.getByRole("complementary", { name: "项目侧栏" });
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

test("loads tasks only for the current or expanded projects", async ({ page }) => {
  let superworkTaskRequests = 0;
  await page.route("**/v1/projects/superwork/tasks?*", async (route) => {
    superworkTaskRequests += 1;
    await route.fallback();
  });

  await page.goto("/p/code-agent/t/task-1");

  const sidebar = page.getByRole("complementary", { name: "项目侧栏" });
  await expect(sidebar.getByRole("link", { name: "优化输入框交互" })).toBeVisible();
  expect(superworkTaskRequests).toBe(0);

  await sidebar.getByRole("button", { name: "切换项目 superwork" }).click();

  await expect.poll(() => superworkTaskRequests).toBe(1);
});

test("loads one project task page only after showing more", async ({ page }) => {
  // 隔离并行用例的实时广播，只验证用户触发的 Cursor 分页请求。
  await page.routeWebSocket("**/v1/projects/code-agent/events?*", () => undefined);
  const taskListRequests: URL[] = [];
  page.on("request", (request) => {
    const requestUrl = new URL(request.url());
    if (requestUrl.pathname === "/v1/projects/code-agent/tasks") {
      taskListRequests.push(requestUrl);
    }
  });

  await page.goto("/p/code-agent/t/task-1");

  const sidebar = page.getByRole("complementary", { name: "项目侧栏" });
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

  const sidebar = page.getByRole("complementary", { name: "项目侧栏" });
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
    const sidebar = document.querySelector<HTMLElement>('[aria-label="项目侧栏"]');
    const inspector = document.querySelector<HTMLElement>('[aria-label="项目检查器"]');
    const timeline = document.querySelector<HTMLElement>('[aria-label="任务时间线"]');
    const sidebarToolbar = sidebar?.querySelector<HTMLElement>(":scope > div") ?? null;
    const inspectorToolbar = inspector?.querySelector<HTMLElement>(":scope > div") ?? null;
    const toolbar = timeline?.querySelector<HTMLElement>("header") ?? null;
    const timelineContent = document.querySelector<HTMLElement>('[role="log"] > div');
    const composerRegion = document.querySelector<HTMLElement>('[aria-label="消息编辑器"]');
    const composer = document.querySelector<HTMLElement>('[aria-label="消息编辑器"] form');

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
  await expect(page.getByRole("complementary", { name: "项目侧栏" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "项目检查器" })).toBeVisible();
});

test("resizes desktop workbench panels within bounds", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/p/code-agent/t/task-1");

  await expect(page.getByRole("button", { name: "更多操作" })).toHaveCount(0);

  const sidebar = page.getByRole("complementary", { name: "项目侧栏" });
  const inspector = page.getByRole("complementary", { name: "项目检查器" });
  const sidebarResizer = page.getByRole("separator", { name: "调整项目侧栏宽度" });
  const inspectorResizer = page.getByRole("separator", { name: "调整上下文面板宽度" });

  await expect(sidebarResizer).toHaveAttribute("aria-valuemin", "220");
  await expect(sidebarResizer).toHaveAttribute("aria-valuemax", "400");
  await expect(inspectorResizer).toHaveAttribute("aria-valuemin", "260");
  await expect(inspectorResizer).toHaveAttribute("aria-valuemax", "480");

  const sidebarResizerBox = await sidebarResizer.boundingBox();
  expect(sidebarResizerBox).not.toBeNull();
  await page.mouse.move(
    (sidebarResizerBox?.x ?? 0) + (sidebarResizerBox?.width ?? 0) / 2,
    (sidebarResizerBox?.y ?? 0) + 100,
  );
  await page.mouse.down();
  await page.mouse.move(900, 100);
  await page.mouse.up();
  expect((await sidebar.boundingBox())?.width).toBe(400);

  const expandedSidebarResizerBox = await sidebarResizer.boundingBox();
  await page.mouse.move((expandedSidebarResizerBox?.x ?? 0) + 4, 100);
  await page.mouse.down();
  await page.mouse.move(0, 100);
  await page.mouse.up();
  expect((await sidebar.boundingBox())?.width).toBe(220);

  const inspectorResizerBox = await inspectorResizer.boundingBox();
  expect(inspectorResizerBox).not.toBeNull();
  await page.mouse.move(
    (inspectorResizerBox?.x ?? 0) + (inspectorResizerBox?.width ?? 0) / 2,
    (inspectorResizerBox?.y ?? 0) + 100,
  );
  await page.mouse.down();
  await page.mouse.move(0, 100);
  await page.mouse.up();
  expect((await inspector.boundingBox())?.width).toBe(480);

  const expandedInspectorResizerBox = await inspectorResizer.boundingBox();
  await page.mouse.move((expandedInspectorResizerBox?.x ?? 0) + 4, 100);
  await page.mouse.down();
  await page.mouse.move(1400, 100);
  await page.mouse.up();
  expect((await inspector.boundingBox())?.width).toBe(260);
});

test("keeps the narrow workbench layout stable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/p/code-agent/t/task-1");

  await expect(page.getByRole("complementary", { name: "项目侧栏" })).not.toBeVisible();
  await page.getByRole("button", { name: "展开项目侧栏" }).click();
  await expect(page.getByRole("complementary", { name: "项目侧栏" })).toBeVisible();
  await page
    .getByRole("complementary", { name: "项目侧栏" })
    .getByRole("button", { name: "关闭项目侧栏" })
    .click();

  const timelineBox = await page.getByRole("main", { name: "任务时间线" }).boundingBox();

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

  await expect(page.getByRole("complementary", { name: "项目侧栏" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "项目检查器" })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });

  await expect(page.getByRole("complementary", { name: "项目侧栏" })).not.toBeVisible();
  await expect(page.getByRole("complementary", { name: "项目检查器" })).not.toBeVisible();
});

test("renders a route-level not-found state", async ({ page }) => {
  await page.goto("/missing-route");

  await expect(page.getByRole("heading", { name: "页面不存在" })).toBeVisible();
  await expect(page.getByRole("link", { name: "返回工作台" })).toHaveAttribute("href", "/");
});
