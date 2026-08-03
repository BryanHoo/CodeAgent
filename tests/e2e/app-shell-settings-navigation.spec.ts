import {
  expect,
  parseProjectOrderRequest,
  parseRequestRecord,
  taskSnapshot,
  taskSnapshotResponse,
  test,
} from "./fixtures/app-shell.js";

test.describe.configure({ mode: "serial" });

test("redirects the root route to the default project workbench", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByTestId("app-root")).toBeAttached();
  await expect(page).toHaveURL(/\/p\/code-agent$/);
  await expect(page.getByRole("main", { name: "任务时间线" })).toBeVisible();
});

test("edits global defaults in a dialog without overriding task settings", async ({ page }) => {
  await page.goto("/p/code-agent/t/task-1");
  const workbenchUrl = page.url();
  const taskModel = page.getByRole("combobox", { name: "选择模型" });
  const taskApproval = page.getByRole("combobox", { name: "批准模式" });
  await expect(taskModel).toHaveValue("gpt-5.6-sol");
  await expect(taskApproval).toHaveValue("on-request");

  await page.getByRole("button", { name: /设置，终端连接状态/u }).click();
  const dialog = page.getByRole("dialog", { name: "全局设置" });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(workbenchUrl);

  await dialog.getByRole("button", { name: "深色模式" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await dialog.getByRole("button", { name: "Agent 默认值" }).click();
  await dialog.getByRole("combobox", { name: "审批" }).selectOption("never");
  await dialog.getByRole("combobox", { name: "工作区" }).selectOption("danger-full-access");
  await dialog.getByRole("combobox", { name: "跟进消息" }).selectOption("steer");
  await dialog.getByRole("combobox", { name: "模型" }).selectOption("gpt-5.6-terra");
  await expect(dialog.getByRole("combobox", { name: "思考" })).toHaveValue("medium");
  await dialog.getByRole("button", { name: "提交消息" }).click();
  await dialog.getByRole("combobox", { name: "提交模型" }).selectOption("gpt-5.6-terra");
  await dialog.getByRole("combobox", { name: "提交思考量" }).selectOption("low");
  await dialog.getByRole("textbox", { name: "提交提示词" }).fill("突出用户可见影响。");
  await dialog.getByRole("button", { name: "应用集成" }).click();
  await dialog.getByRole("combobox", { name: "默认打开方式" }).selectOption("finder");
  await dialog.getByRole("button", { name: "保存全局默认" }).click();

  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(workbenchUrl);
  await expect(taskModel).toHaveValue("gpt-5.6-sol");
  await expect(taskApproval).toHaveValue("on-request");
  await expect(page.getByRole("button", { name: "在 Finder 中打开" })).toBeVisible();

  await page.getByRole("button", { name: /设置，终端连接状态/u }).click();
  const reopenedDialog = page.getByRole("dialog", { name: "全局设置" });
  await expect(reopenedDialog.getByRole("button", { name: "深色模式" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await reopenedDialog.getByRole("button", { name: "Agent 默认值" }).click();
  await expect(reopenedDialog.getByRole("combobox", { name: "审批" })).toHaveValue("never");
  await expect(reopenedDialog.getByRole("combobox", { name: "工作区" })).toHaveValue(
    "danger-full-access",
  );
  await expect(reopenedDialog.getByRole("combobox", { name: "跟进消息" })).toHaveValue("steer");
  await expect(reopenedDialog.getByRole("combobox", { name: "模型" })).toHaveValue("gpt-5.6-terra");
  await reopenedDialog.getByRole("button", { name: "提交消息" }).click();
  await expect(reopenedDialog.getByRole("combobox", { name: "提交模型" })).toHaveValue(
    "gpt-5.6-terra",
  );
  await expect(reopenedDialog.getByRole("combobox", { name: "提交思考量" })).toHaveValue("low");
  await expect(reopenedDialog.getByRole("textbox", { name: "提交提示词" })).toHaveValue(
    "突出用户可见影响。",
  );
  await reopenedDialog.getByRole("button", { name: "应用集成" }).click();
  await expect(reopenedDialog.getByRole("combobox", { name: "默认打开方式" })).toHaveValue(
    "finder",
  );

  await page.setViewportSize({ height: 844, width: 390 });
  const dialogBounds = await reopenedDialog.boundingBox();
  expect(dialogBounds).not.toBeNull();
  expect(dialogBounds?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect(dialogBounds?.y ?? -1).toBeGreaterThanOrEqual(0);
  expect((dialogBounds?.x ?? 0) + (dialogBounds?.width ?? 0)).toBeLessThanOrEqual(390);
  expect((dialogBounds?.y ?? 0) + (dialogBounds?.height ?? 0)).toBeLessThanOrEqual(844);
  expect(
    await reopenedDialog.evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
});

test("switches the interface language and restores it after reload", async ({ page }) => {
  await page.goto("/p/code-agent/t/task-1");

  await page.getByRole("button", { name: /设置，终端连接状态/u }).click();
  const chineseDialog = page.getByRole("dialog", { name: "全局设置" });
  await chineseDialog.getByRole("combobox", { name: "语言" }).selectOption("en");

  const englishDialog = page.getByRole("dialog", { name: "Global settings" });
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await englishDialog.getByRole("button", { name: "Agent defaults" }).click();
  await expect(englishDialog.getByRole("combobox", { name: "Reasoning effort" })).toBeVisible();
  await expect(englishDialog.getByRole("combobox", { name: "Approval policy" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "构建 macOS 工作台", level: 1 })).toBeVisible();
  await expect(
    page.getByText("工作台界面已按统一的 AI Elements 结构重新组织。", { exact: false }),
  ).toBeVisible();

  await englishDialog.getByRole("button", { name: "Close global settings" }).click();
  await page.reload();

  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.getByRole("button", { name: /Settings, terminal connection status/u }).click();
  await expect(page.getByRole("dialog", { name: "Global settings" })).toBeVisible();
});

test("uses global defaults throughout a new task composer", async ({ page }) => {
  await page.route("**/v1/settings", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        settings: {
          approvalPolicy: "never",
          approvalsReviewer: "user",
          commitMessageModel: "gpt-5.6-sol",
          commitMessagePrompt: "",
          commitMessageReasoningEffort: "high",
          defaultOpenAppId: "finder",
          followUpBehavior: "queue",
          model: "gpt-5.6-terra",
          reasoningEffort: "medium",
          sandboxMode: "danger-full-access",
        },
      },
    });
  });
  await page.route("**/v1/projects/code-agent/defaults", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        settings: {
          model: "gpt-5.6-terra",
          reasoningEffort: "medium",
          sandboxMode: "danger-full-access",
        },
      },
    });
  });

  await page.goto("/p/code-agent");

  await expect(page.getByRole("combobox", { name: "批准模式" })).toHaveValue("never");
  await expect(page.getByRole("combobox", { name: "沙盒模式" })).toHaveValue("danger-full-access");
  await expect(page.getByRole("combobox", { name: "选择模型" })).toHaveValue("gpt-5.6-terra");
  await expect(page.getByRole("combobox", { name: "选择思考量" })).toHaveValue("medium");
});

test("project open split control selects, opens, and restores a host app", async ({ page }) => {
  const openRequests: Record<string, unknown>[] = [];
  await page.route("**/v1/projects/code-agent/open", async (route) => {
    openRequests.push(parseRequestRecord(route.request().postData()));
    await route.fallback();
  });
  await page.route("**/v1/projects/code-agent/open-capabilities", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        apps: [
          { id: "explorer", kind: "file-manager", name: "文件资源管理器" },
          { id: "zed", kind: "editor", name: "Zed" },
        ],
        platform: "win32",
      },
    });
  });
  await page.goto("/p/code-agent/t/task-1");

  const menuTrigger = page.getByRole("button", { name: "选择打开方式" });
  await menuTrigger.hover();
  await expect(page.getByRole("menu", { name: "选择打开方式" })).toHaveCount(0);
  await menuTrigger.click();
  const menu = page.getByRole("menu", { name: "选择打开方式" });
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitemradio", { name: "Zed" }).click();
  const openButton = page.getByRole("button", { name: "在 Zed 中打开" });
  await expect(openButton).toBeVisible();

  await openButton.evaluate((button) => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await expect.poll(() => openRequests).toEqual([{ appId: "zed" }]);

  await page.reload();
  await expect(page.getByRole("button", { name: "在 Zed 中打开" })).toBeVisible();
});

test("restores the project folder expansion preference after reload", async ({ page }) => {
  await page.goto("/p/code-agent");

  const firstProject = page.getByRole("button", { name: "切换项目 CodeAgent" });
  const secondProject = page.getByRole("button", { name: "切换项目 superwork" });
  await expect(firstProject).toHaveAttribute("aria-expanded", "true");
  await expect(secondProject).toHaveAttribute("aria-expanded", "false");

  await firstProject.click();
  await secondProject.click();
  await expect(page).toHaveURL(/\/p\/code-agent$/u);
  await expect(firstProject).toHaveAttribute("aria-expanded", "false");
  await expect(secondProject).toHaveAttribute("aria-expanded", "true");

  await page.reload();

  await expect(firstProject).toHaveAttribute("aria-expanded", "false");
  await expect(secondProject).toHaveAttribute("aria-expanded", "true");

  await page.goto("/");

  await expect(page).toHaveURL(/\/p\/superwork$/u);
  await expect(page.getByRole("main", { name: "任务时间线" })).toBeVisible();
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
      const inlineCode = document.createElement("code");
      inlineCode.dataset["streamdown"] = "inline-code";
      root.append(inlineCode);
      const inlineCodeBackground = getComputedStyle(inlineCode).backgroundColor;
      inlineCode.remove();
      const styles = getComputedStyle(root);

      return {
        accent: resolveColor("--ui-color-accent"),
        bodyFontWeight: getComputedStyle(document.body).fontWeight,
        bodyFontSize: styles.getPropertyValue("--ui-font-size-body").trim(),
        content: resolveColor("--ui-color-content"),
        control: resolveColor("--ui-color-control"),
        diffAdded: resolveColor("--ui-color-diff-added"),
        diffRemoved: resolveColor("--ui-color-diff-removed"),
        ink: resolveColor("--ui-color-text"),
        inlineCodeBackground,
        mutedInk: resolveColor("--ui-color-text-muted"),
        panel: resolveColor("--ui-color-panel"),
        sidebar: resolveColor("--ui-color-sidebar"),
        spaceUnit: styles.getPropertyValue("--ui-space-unit").trim(),
        subtleInk: resolveColor("--ui-color-text-subtle"),
        surface: styles.backgroundColor,
      };
    }, theme);

  expect(await readTheme("light")).toEqual({
    accent: "rgb(0, 106, 255)",
    bodyFontWeight: "450",
    bodyFontSize: expect.stringMatching(/^0?\.875rem$/),
    content: "rgb(255, 255, 255)",
    control: "rgba(17, 17, 17, 0.04)",
    diffAdded: "rgb(40, 169, 72)",
    diffRemoved: "rgb(235, 0, 29)",
    ink: "rgb(17, 17, 17)",
    inlineCodeBackground: "rgba(17, 17, 17, 0.08)",
    mutedInk: "rgba(17, 17, 17, 0.72)",
    panel: "rgb(255, 255, 255)",
    sidebar: "rgb(255, 255, 255)",
    spaceUnit: expect.stringMatching(/^0?\.25rem$/),
    subtleInk: "rgba(17, 17, 17, 0.52)",
    surface: "rgb(255, 255, 255)",
  });

  expect(await readTheme("dark")).toEqual({
    accent: "rgb(51, 156, 255)",
    bodyFontWeight: "450",
    bodyFontSize: expect.stringMatching(/^0?\.875rem$/),
    content: "rgb(24, 24, 24)",
    control: "rgba(255, 255, 255, 0.07)",
    diffAdded: "rgb(64, 201, 119)",
    diffRemoved: "rgb(250, 66, 62)",
    ink: "rgb(255, 255, 255)",
    inlineCodeBackground: "rgba(255, 255, 255, 0.12)",
    mutedInk: "rgba(255, 255, 255, 0.68)",
    panel: "rgb(24, 24, 24)",
    sidebar: "rgb(24, 24, 24)",
    spaceUnit: expect.stringMatching(/^0?\.25rem$/),
    subtleInk: "rgba(255, 255, 255, 0.5)",
    surface: "rgb(24, 24, 24)",
  });
});

test("exposes the documented navigation routes", async ({ page }) => {
  const routes = [
    { path: "/p/code-agent", heading: "CodeAgent" },
    { path: "/p/code-agent/t/task-1", heading: "构建 macOS 工作台" },
  ];

  for (const route of routes) {
    await page.goto(route.path);
    await expect(
      page.getByRole("main").getByRole("heading", { name: route.heading }),
    ).toBeVisible();
  }
});

test("keeps the current task open when the product logo is clicked", async ({ page }) => {
  await page.goto("/p/code-agent/t/task-1");

  const sidebar = page.getByRole("complementary", { name: "项目侧栏" });
  await sidebar.getByText("CodeAgent", { exact: true }).first().click();

  await expect(page).toHaveURL(/\/p\/code-agent\/t\/task-1$/);
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

test("项目文件夹操作支持重命名和删除且不修改磁盘目录", async ({ page }) => {
  await page.goto("/p/code-agent");
  const sidebar = page.getByRole("complementary", { name: "项目侧栏" });
  const projectMenuTrigger = sidebar.getByRole("button", {
    name: "打开 CodeAgent 的项目操作菜单",
  });
  const addTaskButton = sidebar.getByRole("button", { name: "在 CodeAgent 中新建任务" });
  const [menuTriggerBounds, addTaskBounds] = await Promise.all([
    projectMenuTrigger.boundingBox(),
    addTaskButton.boundingBox(),
  ]);
  if (menuTriggerBounds === null || addTaskBounds === null) {
    throw new Error("Project action buttons are not visible");
  }
  expect(menuTriggerBounds.x).toBeLessThan(addTaskBounds.x);

  await projectMenuTrigger.click();
  const projectMenu = page.getByRole("menu", { name: "CodeAgent 的项目操作" });
  await expect(projectMenu.getByRole("menuitem")).toHaveCount(2);
  await expect(projectMenu.getByRole("menuitem").allTextContents()).resolves.toEqual([
    "重命名",
    "删除",
  ]);
  await projectMenu.getByRole("menuitem", { name: "重命名" }).click();
  const renameDialog = page.getByRole("dialog", { name: "重命名项目" });
  await expect(renameDialog).toContainText("不会修改磁盘上的文件夹名称");
  await renameDialog.getByRole("textbox", { name: "项目名称" }).fill("本地工作台");
  const renameRequestPromise = page.waitForRequest(
    (request) =>
      request.url().endsWith("/v1/projects/code-agent/rename") && request.method() === "POST",
  );
  const renameResponsePromise = page.waitForResponse((response) =>
    response.url().endsWith("/v1/projects/code-agent/rename"),
  );
  await renameDialog.getByRole("button", { name: "保存" }).click();
  const [renameRequest, renameResponse] = await Promise.all([
    renameRequestPromise,
    renameResponsePromise,
  ]);
  expect(parseRequestRecord(renameRequest.postData())).toEqual({ name: "本地工作台" });
  expect(renameRequest.headers()["idempotency-key"]).toBeTruthy();
  await expect(renameResponse.json()).resolves.toMatchObject({
    project: { name: "本地工作台", rootPath: "~/Develop/person/CodeAgent" },
  });
  await expect(sidebar.getByRole("button", { name: "切换项目 本地工作台" })).toBeVisible();
  await expect(page).toHaveURL(/\/p\/code-agent$/u);

  await sidebar.getByRole("button", { name: "打开 本地工作台 的项目操作菜单" }).click();
  await page
    .getByRole("menu", { name: "本地工作台 的项目操作" })
    .getByRole("menuitem", { name: "删除" })
    .click();
  const removeDialog = page.getByRole("dialog", { name: "移除项目" });
  await expect(removeDialog).toContainText("不会删除磁盘上的文件夹及文件");
  const removeRequestPromise = page.waitForRequest((request) =>
    request.url().endsWith("/v1/projects/code-agent/remove"),
  );
  await removeDialog.getByRole("button", { name: "删除" }).click();
  const removeRequest = await removeRequestPromise;
  expect(removeRequest.headers()["idempotency-key"]).toBeTruthy();
  await expect(page).toHaveURL(/\/p\/superwork$/u);
  await expect(sidebar.getByRole("button", { name: "切换项目 本地工作台" })).toHaveCount(0);

  await sidebar.getByRole("button", { name: "打开 superwork 的项目操作菜单" }).click();
  await page
    .getByRole("menu", { name: "superwork 的项目操作" })
    .getByRole("menuitem", { name: "删除" })
    .click();
  const removeLastProjectRequest = page.waitForRequest((request) =>
    request.url().endsWith("/v1/projects/superwork/remove"),
  );
  await page
    .getByRole("dialog", { name: "移除项目" })
    .getByRole("button", { name: "删除" })
    .click();
  await removeLastProjectRequest;

  await expect(page).toHaveURL(/\/$/u);
  await expect(page.getByText("尚未添加项目", { exact: true })).toBeVisible();
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

  const sidebar = page.getByRole("complementary", { name: "项目侧栏" });
  expect(failedProjectRequestCount).toBe(0);
  await sidebar.getByRole("button", { name: "切换项目 superwork" }).click();

  await expect.poll(() => failedProjectRequestCount).toBe(2);
  await expect(page.getByRole("heading", { name: "构建 macOS 工作台" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Codex Runtime 不可用" })).toHaveCount(0);
});

test("renders skills from a reopened task history", async ({ page }) => {
  await page.goto("/p/code-agent/t/task-1");

  const historicalSkill = page.locator('[data-message-skill="review-security"]');
  await expect(historicalSkill).toContainText("$review-security");
  await expect(historicalSkill).toHaveCSS("color", "rgb(0, 106, 255)");
  await expect(page.getByText("完成 macOS 原生风格的三栏工作台页面。")).toBeVisible();
});

test("uses the available user message width before wrapping or truncating", async ({ page }) => {
  await page.route("**/v1/projects/code-agent/tasks/task-1", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        ...taskSnapshotResponse,
        snapshot: {
          ...taskSnapshotResponse.snapshot,
          turns: [
            {
              ...taskSnapshot.turns[0],
              items: [
                {
                  id: "message-short-text",
                  role: "user",
                  skills: [],
                  text: "现在系统的 gh cli 是可以用的",
                  type: "message",
                },
              ],
            },
            {
              ...taskSnapshot.turns[0],
              id: "turn-skill-only",
              items: [
                {
                  id: "message-skill-only",
                  role: "user",
                  skills: [{ name: "git-commit" }],
                  text: "",
                  type: "message",
                },
              ],
            },
          ],
        },
      },
    });
  });
  await page.goto("/p/code-agent/t/task-1");

  const shortText = page.getByText("现在系统的 gh cli 是可以用的", { exact: true });
  const shortTextLineCount = await shortText.evaluate((element) => {
    const textNode = element.firstChild;
    if (!(textNode instanceof Text)) {
      throw new Error("Expected a short user message text node");
    }
    const range = document.createRange();
    range.selectNodeContents(textNode);
    return range.getClientRects().length;
  });
  expect(shortTextLineCount).toBe(1);

  const skillLabel = page.locator('[data-message-skill="git-commit"] > span');
  const skillOverflow = await skillLabel.evaluate(
    (element) => element.scrollWidth - element.clientWidth,
  );
  expect(skillOverflow).toBeLessThanOrEqual(0);
});

test("uses subtle hairline separation across registered routes", async ({ page }) => {
  const surfaces = [
    {
      path: "/p/code-agent",
      selector: "main header",
      border: "borderBottomWidth",
      offset: "0px 1px 0px 0px",
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

  const mainHeader = page.getByRole("main", { name: "任务时间线" }).locator(":scope > header");
  const leftTitle = page
    .getByRole("complementary", { name: "项目侧栏" })
    .getByText("CodeAgent", { exact: true })
    .first();
  const centerTitle = page.getByRole("heading", { name: "构建 macOS 工作台", level: 1 });
  const rightTitle = page.getByRole("heading", { name: "项目检查器", level: 2 });
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

  const main = page.getByRole("main", { name: "任务时间线" });
  const inspector = page.getByRole("complementary", { name: "项目检查器" });
  await expect(page.getByRole("complementary", { name: "项目侧栏" })).toBeVisible();
  await expect(main).toBeVisible();
  await expect(inspector).toBeVisible();
  await expect(page.getByRole("heading", { name: "项目检查器" })).toBeVisible();
  await expect(page.getByRole("region", { name: "消息编辑器" })).toBeVisible();
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
  const composerForm = page.getByRole("region", { name: "消息编辑器" }).locator("form");
  const composerControls = [
    prompt,
    page.getByRole("button", { name: "添加图片或文件" }),
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

test("renders enabled MCP servers and sources in inspector", async ({ page }) => {
  await page.goto("/p/code-agent/t/task-1");

  const inspector = page.getByRole("complementary", { name: "项目检查器" });
  await inspector.getByRole("tab", { name: "上下文" }).click();
  const mcp = inspector.getByRole("region", { name: "MCP" });
  const sources = inspector.getByRole("region", { name: "来源" });

  await expect(mcp.getByText("fast-context", { exact: true })).toBeVisible();
  await expect(mcp.getByText("chrome-devtools", { exact: true })).toBeVisible();
  await expect(inspector.getByRole("region", { name: "环境" })).toHaveCount(0);
  await expect(inspector.getByText("gpt-5.6-sol", { exact: true })).toHaveCount(0);
  await expect(inspector.getByText("工作区可写", { exact: true })).toHaveCount(0);
  await expect(inspector.getByText("feat/review-targets", { exact: true })).toHaveCount(0);
  await expect(sources.getByText("Security review", { exact: true })).toBeVisible();
  await expect(sources.getByText("项目目录", { exact: true })).toBeVisible();
  await expect(inspector.getByText("This Mac", { exact: true })).toHaveCount(0);
  await expect(inspector.getByText("AI Elements", { exact: true })).toHaveCount(0);
  await expect(inspector.getByRole("button", { name: "添加来源" })).toHaveCount(0);
});

test("opens message images in a preview dialog", async ({ context, page }) => {
  await page.route("**/v1/projects/code-agent/tasks/task-1", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        ...taskSnapshotResponse,
        snapshot: {
          ...taskSnapshotResponse.snapshot,
          turns: taskSnapshot.turns.map((turn) => ({
            ...turn,
            items: turn.items.map((item) =>
              item.id === "message-1"
                ? {
                    ...item,
                    attachments: [
                      {
                        id: "history/image-1",
                        kind: "image",
                        mediaType: "image/png",
                        name: "diagram.png",
                        size: 68,
                      },
                    ],
                    skills: [],
                    text: "阅读并理解项目",
                  }
                : item,
            ),
          })),
        },
      },
    });
  });
  await page.route("**/attachments/history%2Fimage-1", async (route) => {
    await route.fulfill({
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      ),
      contentType: "image/png",
    });
  });
  await page.setViewportSize({ height: 844, width: 390 });
  await page.goto("/p/code-agent/t/task-1");

  const userMessage = page.locator('article[data-role="user"]').first();
  const attachment = userMessage.locator('[data-message-attachment="image"]');
  const textBubble = userMessage.locator('[data-message-text="true"]');
  await expect(attachment).toBeVisible();
  await expect(attachment).toHaveCSS("border-radius", "8px");
  await expect(attachment).toHaveCSS("height", "160px");
  await expect(attachment).toHaveCSS("width", "160px");
  await expect(userMessage.getByText("diagram.png", { exact: true })).toHaveCount(0);

  const attachmentBounds = await attachment.boundingBox();
  const textBounds = await textBubble.boundingBox();
  expect(attachmentBounds).not.toBeNull();
  expect(textBounds).not.toBeNull();
  expect(attachmentBounds?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(textBounds?.y ?? 0);
  expect((attachmentBounds?.x ?? 0) + (attachmentBounds?.width ?? 0)).toBeLessThanOrEqual(390);

  await attachment.click();
  const imagePreview = page.getByRole("dialog", { name: "diagram.png" });
  await expect(imagePreview).toBeVisible();
  expect(context.pages()).toHaveLength(1);
  await imagePreview.getByRole("button", { name: "关闭图片预览" }).click();
  await expect(imagePreview).toHaveCount(0);
});

test("keeps Projects fixed and manages task actions from the compact tree", async ({ page }) => {
  await page.goto("/p/code-agent/t/task-1");

  const sidebar = page.getByRole("complementary", { name: "项目侧栏" });
  const projectsHeading = sidebar.getByRole("heading", { name: "项目" });
  const pinnedHeading = sidebar.getByRole("heading", { name: "已固定" });
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

test("renames the active task from the center title", async ({ page }) => {
  await page.goto("/p/code-agent/t/task-1");

  const main = page.getByRole("main", { name: "任务时间线" });
  await main.getByRole("button", { name: "重命名任务 构建 macOS 工作台" }).click();

  const dialog = page.getByRole("dialog", { name: "重命名任务" });
  await dialog.getByRole("textbox", { name: "任务名称" }).fill("重命名中栏任务");
  await dialog.getByRole("button", { name: "保存" }).click();

  await expect(main.getByRole("heading", { name: "重命名中栏任务" })).toBeVisible();
  await expect(
    page
      .getByRole("complementary", { name: "项目侧栏" })
      .getByRole("link", { name: /重命名中栏任务/u }),
  ).toHaveCount(2);
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
