import {
  architectureSourcePreview,
  chooseHostAttachment,
  expect,
  parseRequestRecord,
  projectGitStatus,
  taskSnapshot,
  taskSnapshotResponse,
  tasks,
  test,
} from "./fixtures/app-shell.js";

test.describe.configure({ mode: "serial" });

test("switches branches from the composer footer", async ({ page }) => {
  let switchRequest: Record<string, unknown> | undefined;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (request.method() === "POST" && url.pathname === "/v1/projects/code-agent/git/branch") {
      switchRequest = parseRequestRecord(request.postData());
    }
  });
  await page.goto("/p/code-agent/t/task-1");

  const trigger = page.getByRole("button", {
    name: "切换分支，当前分支 feat/review-targets",
  });
  await expect(trigger).toBeVisible();
  await trigger.click();
  const currentBranch = page.getByRole("menuitemradio", { name: "feat/review-targets" });
  const mainBranch = page.getByRole("menuitemradio", { name: "main", exact: true });
  await expect(currentBranch).toBeDisabled();
  await expect(currentBranch).toHaveAttribute("data-state", "checked");
  await mainBranch.click();

  await expect(page.getByRole("button", { name: "切换分支，当前分支 main" })).toBeVisible();
  expect(switchRequest).toEqual({
    branch: "main",
    expectedSnapshot: projectGitStatus.snapshot,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  const viewportMetrics = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(viewportMetrics.documentWidth).toBeLessThanOrEqual(viewportMetrics.viewportWidth);
});

test("creates and switches to a branch from the composer footer", async ({ page }) => {
  let createRequest: Record<string, unknown> | undefined;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (request.method() === "POST" && url.pathname === "/v1/projects/code-agent/git/branches") {
      createRequest = parseRequestRecord(request.postData());
    }
  });
  await page.goto("/p/code-agent/t/task-1");

  await page.getByRole("button", { name: "切换分支，当前分支 feat/review-targets" }).click();
  const createBranchItem = page.getByRole("menuitem", { name: "新建分支" });
  await expect(createBranchItem.locator("svg")).toHaveClass(/size-3\.5/u);
  await createBranchItem.click();
  const dialog = page.getByRole("dialog", { name: "新建分支" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("基于当前分支创建并立即切换");
  await dialog.getByRole("textbox", { name: "分支名称" }).fill("feat/composer-create");
  await dialog.getByRole("button", { name: "创建并切换" }).click();

  await expect(
    page.getByRole("button", { name: "切换分支，当前分支 feat/composer-create" }),
  ).toBeVisible();
  await expect(dialog).toBeHidden();
  expect(createRequest).toEqual({
    branch: "feat/composer-create",
    expectedSnapshot: projectGitStatus.snapshot,
  });
});

test("opens current-branch Git history from the inspector tab", async ({ page }) => {
  const historyRequests: string[] = [];
  const commitFileRequests: string[] = [];
  const commitDiffRequests: string[] = [];
  let releaseServerHistory: (() => void) | undefined;
  await page.route("**/v1/projects/code-agent/git/history*", async (route) => {
    const url = new URL(route.request().url());
    const cursor = url.searchParams.get("cursor");
    const repository = url.searchParams.get("repository");
    historyRequests.push(url.search);
    const count = cursor === "20" ? 1 : 20;
    const start = cursor === "20" ? 20 : 0;
    if (repository === "packages/server") {
      await new Promise<void>((resolve) => {
        releaseServerHistory = resolve;
      });
    }
    await route.fulfill({
      contentType: "application/json",
      json: {
        branch: repository === "packages/server" ? "release/server" : "feat/apps-web",
        commits: Array.from({ length: count }, (_, index) => ({
          authoredAt: "2026-08-06T08:30:00+08:00",
          authorEmail: "developer@example.com",
          authorName: "Developer",
          sha: (start + index).toString(16).padStart(40, "0"),
          title: `${repository ?? "apps/web"} commit ${String(start + index + 1)}`,
        })),
        nextCursor: cursor === null && repository !== "packages/server" ? "20" : null,
        repositories: ["apps/web", "packages/server"],
        repository: repository ?? "apps/web",
        repositoryMode: "children",
      },
    });
  });
  await page.route("**/v1/projects/code-agent/git/commit-files*", async (route) => {
    const url = new URL(route.request().url());
    const cursor = url.searchParams.get("cursor");
    commitFileRequests.push(url.search);
    const start = cursor === "100" ? 100 : 0;
    const count = cursor === "100" ? 1 : 100;
    await route.fulfill({
      contentType: "application/json",
      json: {
        files: Array.from({ length: count }, (_, index) => ({
          kind: index === 0 ? "update" : "create",
          path: `src/review-${String(start + index)}.ts`,
        })),
        nextCursor: cursor === null ? "100" : null,
      },
    });
  });
  await page.route("**/v1/projects/code-agent/git/commit-diff*", async (route) => {
    const url = new URL(route.request().url());
    commitDiffRequests.push(url.search);
    const path = url.searchParams.get("path") ?? "src/review-0.ts";
    await route.fulfill({
      contentType: "application/json",
      json: {
        diff: `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-old\n+new\n`,
        truncated: true,
      },
    });
  });
  await page.goto("/p/code-agent/t/task-1");

  const branchTrigger = page.getByRole("button", { name: /切换分支，当前分支/u });
  const inspector = page.locator(".workbench-inspector");
  const historyTab = inspector.getByRole("tab", { name: "历史" });
  await expect(page.getByRole("button", { name: "查看 Git 历史" })).toHaveCount(0);
  await expect(branchTrigger.locator("svg").first()).toHaveCSS("width", "12px");
  expect(historyRequests).toEqual([]);
  await historyTab.click();

  await expect(inspector).toBeVisible();
  await expect(inspector).toHaveAttribute("aria-label", "运行环境");
  await expect(inspector.getByRole("tab", { name: "历史" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("dialog", { name: "Git 历史" })).toHaveCount(0);
  await expect(page.locator('[data-slot="sheet-content"]')).toHaveCount(0);
  await expect(inspector.getByText("当前分支：feat/apps-web")).toBeVisible();
  await expect(inspector.getByRole("listitem")).toHaveCount(20);
  await expect(inspector.getByRole("tab", { name: "apps/web" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const initialInspectorBox = await inspector.boundingBox();
  expect(historyRequests).toEqual([""]);

  await inspector.getByRole("button", { name: /^apps\/web commit 1 /u }).click();
  const reviewDialog = page.locator('[data-slot="dialog-content"]');
  await expect(page.getByRole("dialog", { name: "apps/web commit 1" })).toBeVisible();
  await expect(inspector.getByText("apps/web commit 1", { exact: true })).toBeVisible();
  await expect(reviewDialog.getByText("Diff 过长，仅展示前 512 KiB")).toBeVisible();
  await expect(reviewDialog.locator(".file-diff-renderer")).toContainText("new");
  expect(commitFileRequests).toEqual([`?repository=apps%2Fweb&sha=${"0".repeat(40)}`]);
  expect(commitDiffRequests).toEqual([
    `?path=src%2Freview-0.ts&repository=apps%2Fweb&sha=${"0".repeat(40)}`,
  ]);
  await reviewDialog.getByRole("button", { name: "加载更多文件" }).click();
  await expect(reviewDialog.getByText("review-100.ts")).toBeVisible();
  expect(commitFileRequests).toEqual([
    `?repository=apps%2Fweb&sha=${"0".repeat(40)}`,
    `?cursor=100&repository=apps%2Fweb&sha=${"0".repeat(40)}`,
  ]);
  expect(commitDiffRequests).toHaveLength(1);
  await reviewDialog.getByRole("button", { name: "关闭文件审核" }).click();
  await expect(reviewDialog).not.toBeVisible();
  await expect(inspector.getByText("apps/web commit 1", { exact: true })).toBeVisible();

  await inspector.getByRole("tab", { name: "packages/server" }).click();
  await expect(inspector.getByText("正在读取 Git 历史...")).toBeVisible();
  await expect(inspector.getByText("当前分支：读取中...")).toBeVisible();
  const pendingInspectorBox = await inspector.boundingBox();
  expect(pendingInspectorBox?.height).toBe(initialInspectorBox?.height);
  expect(pendingInspectorBox?.y).toBe(initialInspectorBox?.y);
  await expect(inspector.getByText("apps/web commit 1", { exact: true })).toBeAttached();
  await expect(inspector.getByText("apps/web commit 1", { exact: true })).toBeHidden();
  releaseServerHistory?.();
  await expect(inspector.getByText("packages/server commit 20", { exact: true })).toBeVisible();
  await expect(inspector.getByText("当前分支：release/server")).toBeVisible();
  const loadedInspectorBox = await inspector.boundingBox();
  expect(loadedInspectorBox?.height).toBe(initialInspectorBox?.height);
  expect(loadedInspectorBox?.y).toBe(initialInspectorBox?.y);
  expect(historyRequests).toEqual(["", "?repository=packages%2Fserver"]);

  await inspector.getByRole("tab", { name: "apps/web" }).click();
  await expect(inspector.getByRole("listitem")).toHaveCount(20);
  await expect(inspector.getByText("当前分支：feat/apps-web")).toBeVisible();
  expect(historyRequests).toEqual(["", "?repository=packages%2Fserver"]);

  await inspector.getByRole("tab", { name: "项目" }).click();
  await expect(inspector.locator('[data-slot="git-history-panel"]')).toHaveCount(0);
  await historyTab.click();
  await expect(inspector.getByRole("tab", { name: "历史" })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  await page.setViewportSize({ width: 320, height: 568 });
  await expect(inspector).not.toBeVisible();
  await page.getByRole("button", { name: "展开上下文面板" }).click();
  await expect(inspector).toBeVisible();
  expect(await inspector.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
    true,
  );
  const touchControls = [
    inspector.getByRole("button", { name: "关闭上下文面板" }),
    inspector.getByRole("tab", { name: "apps/web" }),
    inspector.getByRole("tab", { name: "packages/server" }),
    inspector.getByRole("button", { name: "加载更多" }),
  ];
  const touchBoxes = await Promise.all(touchControls.map((control) => control.boundingBox()));
  for (const box of touchBoxes) expect(box?.height).toBeGreaterThanOrEqual(44);
  await inspector.getByRole("button", { name: "加载更多" }).click();
  await expect(inspector.getByRole("listitem")).toHaveCount(21);
  expect(historyRequests).toEqual(["", "?repository=packages%2Fserver", "?cursor=20"]);
});

test("paginates a single repository inside the history content", async ({ page }) => {
  await page.route("**/v1/projects/code-agent/git/history*", async (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    const start = cursor === "20" ? 20 : 0;
    const count = cursor === "20" ? 1 : 20;
    await route.fulfill({
      contentType: "application/json",
      json: {
        branch: "main",
        commits: Array.from({ length: count }, (_, index) => ({
          authoredAt: "2026-08-06T08:30:00+08:00",
          authorEmail: "developer@example.com",
          authorName: "Developer",
          sha: (start + index).toString(16).padStart(40, "0"),
          title: `root commit ${String(start + index + 1)}`,
        })),
        nextCursor: cursor === null ? "20" : null,
        repositories: [],
        repository: null,
        repositoryMode: "root",
      },
    });
  });
  await page.goto("/p/code-agent/t/task-1");
  const inspector = page.locator(".workbench-inspector");
  await inspector.getByRole("tab", { name: "历史" }).click();
  const content = inspector.locator('[data-slot="git-history-content"]');
  const loadMore = content.getByRole("button", { name: "加载更多" });
  await expect(inspector.getByRole("tab", { name: "历史" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(inspector.getByRole("tab", { name: "apps/web" })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Git 历史" })).toHaveCount(0);
  await expect(loadMore).toBeVisible();
  await expect(inspector.locator("footer")).toHaveCount(0);
  const loadMoreMetrics = await loadMore.evaluate((element) => {
    const container = element.parentElement;
    if (container === null) throw new Error("Load more container is unavailable");
    const containerStyle = getComputedStyle(container);
    return {
      height: element.getBoundingClientRect().height,
      parentContentWidth:
        container.clientWidth -
        Number.parseFloat(containerStyle.paddingLeft) -
        Number.parseFloat(containerStyle.paddingRight),
      width: element.getBoundingClientRect().width,
    };
  });
  expect(loadMoreMetrics.height).toBe(28);
  expect(Math.abs(loadMoreMetrics.width - loadMoreMetrics.parentContentWidth)).toBeLessThanOrEqual(
    1,
  );

  await loadMore.click();
  await expect(inspector.getByRole("listitem")).toHaveCount(21);
  await expect(content.getByText("已加载全部提交")).toBeVisible();
});

test("keeps composer attachment icons aligned with the compact toolbar", async ({ page }) => {
  await page.goto("/p/code-agent/t/task-1");

  const attachmentButton = page.getByRole("button", { name: "添加图片或文件" });
  await expect(attachmentButton).toHaveCSS("height", "28px");
  await expect(attachmentButton.locator("svg")).toHaveCSS("width", "14px");
  await expect(attachmentButton.locator("svg")).toHaveCSS("height", "14px");

  await attachmentButton.click();
  const imageMenuIcon = page.getByRole("menuitem", { name: "添加图片" }).locator("svg");
  await expect(imageMenuIcon).toHaveCSS("width", "16px");
  await expect(imageMenuIcon).toHaveCSS("height", "16px");
});

test("shows every mobile composer action in full on one row", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/p/code-agent/t/task-1");

  const approvalSelect = page.getByRole("combobox", { name: "批准模式" });
  const sandboxSelect = page.getByRole("combobox", { name: "沙盒模式" });
  const modelSelector = page.getByRole("button", { name: /^模型和思考量：/u });
  const submitButton = page.getByRole("button", { exact: true, name: "提交" });
  const controls = [approvalSelect, sandboxSelect, modelSelector, submitButton];
  const boxes = await Promise.all(controls.map((control) => control.boundingBox()));

  expect(boxes.every((box) => box !== null)).toBe(true);
  expect(new Set(boxes.map((box) => Math.round(box?.y ?? 0))).size).toBe(1);
  await expect(approvalSelect).toHaveCSS("field-sizing", "content");
  await expect(sandboxSelect).toHaveCSS("field-sizing", "content");
  expect(boxes[0]?.width).toBeGreaterThan(44);
  expect(boxes[1]?.width).toBeGreaterThan(44);
  expect(
    await modelSelector
      .locator("span")
      .first()
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  const footerSize = await approvalSelect.locator("xpath=../..").evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(footerSize.scrollWidth).toBeLessThanOrEqual(footerSize.clientWidth);
});

test("navigates absolute paths and toggles hidden files in the host file picker", async ({
  page,
}) => {
  const hostFileQueries: URL[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/v1/host-files") hostFileQueries.push(url);
  });
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/p/code-agent/t/task-1");

  await page.getByRole("button", { name: "添加图片或文件" }).click();
  await page.getByRole("menuitem", { name: "添加文件" }).click();
  const dialog = page.getByRole("dialog", { name: "选择本机文件" });
  const pathInput = dialog.getByRole("textbox", { name: "绝对目录路径" });
  await expect(pathInput).toHaveValue("/Users/bryan/Attachments");
  await expect(dialog.getByRole("treeitem", { name: ".secret.pdf", exact: true })).toHaveCount(0);

  await pathInput.fill("/Users/bryan/HiddenDocs");
  await pathInput.press("Enter");
  await expect(dialog.getByRole("treeitem", { name: "notes.pdf", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "显示隐藏文件" }).click();
  await expect(dialog.getByRole("treeitem", { name: ".secret.pdf", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "隐藏隐藏文件" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  expect(
    hostFileQueries.some(
      (url) =>
        url.searchParams.get("path") === "/Users/bryan/HiddenDocs" &&
        url.searchParams.get("includeHidden") === null,
    ),
  ).toBe(true);
  expect(
    hostFileQueries.some(
      (url) =>
        url.searchParams.get("path") === "/Users/bryan/HiddenDocs" &&
        url.searchParams.get("includeHidden") === "true",
    ),
  ).toBe(true);
  const toolbar = pathInput.locator("..").locator("..");
  const toolbarMetrics = await toolbar.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(toolbarMetrics.scrollWidth).toBeLessThanOrEqual(toolbarMetrics.clientWidth);
});

test("undoes text pasted into the composer", async ({ page }) => {
  await page.goto("/p/code-agent/t/task-1");

  const prompt = page.getByRole("textbox", { name: "任务输入" });
  await prompt.click();
  await page.evaluate(async () => {
    await navigator.clipboard.writeText("需要撤销的内容");
  });
  await prompt.press(process.platform === "darwin" ? "Meta+v" : "Control+v");
  await expect(prompt).toHaveAttribute("data-serialized-value", "需要撤销的内容");

  await prompt.press(process.platform === "darwin" ? "Meta+z" : "Control+z");

  await expect(prompt).toHaveAttribute("data-serialized-value", "");
});

test("recalls submitted prompt history with arrow keys and restores the draft", async ({
  page,
}) => {
  const latestTurn = {
    completedAt: "2026-08-10T08:01:00.000Z",
    error: null,
    id: "turn-latest-history",
    items: [
      {
        id: "message-latest-history",
        role: "user" as const,
        text: "最近一次输入",
        type: "message" as const,
      },
    ],
    startedAt: "2026-08-10T08:00:00.000Z",
    status: "completed" as const,
  };
  await page.route("**/v1/projects/code-agent/tasks/task-1", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        ...taskSnapshotResponse,
        snapshot: { ...taskSnapshot, turns: [...taskSnapshot.turns, latestTurn] },
      },
    });
  });
  await page.goto("/p/code-agent/t/task-1");

  const prompt = page.getByRole("textbox", { name: "任务输入" });
  await prompt.fill("尚未提交的草稿");

  await prompt.press("ArrowUp");
  await expect(prompt).toHaveAttribute("data-serialized-value", "最近一次输入");
  await prompt.press("ArrowUp");
  await expect(prompt).toHaveAttribute(
    "data-serialized-value",
    "$review-security 完成 macOS 原生风格的三栏工作台页面。",
  );
  await prompt.press("ArrowDown");
  await expect(prompt).toHaveAttribute("data-serialized-value", "最近一次输入");
  await prompt.press("ArrowDown");
  await expect(prompt).toHaveAttribute("data-serialized-value", "尚未提交的草稿");
});

test("does not submit or select a command when Safari confirms an IME candidate @smoke", async ({
  page,
}) => {
  const turnRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      request.method() === "POST" &&
      url.pathname === "/v1/projects/code-agent/tasks/task-1/turns"
    ) {
      turnRequests.push(url.pathname);
    }
  });
  await page.goto("/p/code-agent/t/task-1");

  const prompt = page.getByRole("textbox", { name: "任务输入" });
  const dispatchSafariImeEnter = () =>
    prompt.evaluate((editor) => {
      editor.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true, data: editor.textContent }),
      );
      // Safari 在候选确认后会产生 isComposing=false、keyCode=229 的 Enter keydown。
      editor.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Enter",
          keyCode: 229,
        }),
      );
    });

  await prompt.fill("中文候选");
  await dispatchSafariImeEnter();
  await expect(prompt).toHaveAttribute("data-serialized-value", "中文候选");
  expect(turnRequests).toHaveLength(0);

  await prompt.fill("/");
  const commandMenu = page.getByRole("listbox", { name: "输入命令" });
  await expect(commandMenu).toBeVisible();
  await dispatchSafariImeEnter();
  await expect(commandMenu).toBeVisible();
  await expect(prompt).toHaveAttribute("data-serialized-value", "/");
  expect(turnRequests).toHaveLength(0);
});

test("shows processing state while an existing task turn is still starting", async ({ page }) => {
  let releaseTurnStart!: () => void;
  let markTurnStartRequested!: () => void;
  const turnStartGate = new Promise<void>((resolve) => {
    releaseTurnStart = resolve;
  });
  const turnStartRequested = new Promise<void>((resolve) => {
    markTurnStartRequested = resolve;
  });
  await page.route("**/v1/projects/code-agent/tasks/task-1/turns", async (route) => {
    markTurnStartRequested();
    await turnStartGate;
    await route.fulfill({
      contentType: "application/json",
      json: {
        taskId: "task-1",
        turn: {
          completedAt: null,
          error: null,
          id: "turn-pending-start",
          items: [],
          startedAt: "2026-08-02T00:00:00.000Z",
          status: "running",
        },
      },
      status: 201,
    });
  });
  await page.goto("/p/code-agent/t/task-1");

  await page.getByRole("textbox", { name: "任务输入" }).fill("继续处理当前任务");
  await page.getByRole("button", { exact: true, name: "提交" }).click();
  await turnStartRequested;

  await expect(page.locator("[data-turn-processing-time]")).toHaveCount(2);
  await expect(page.getByLabel("AI 回复正在运行")).toBeVisible();

  releaseTurnStart();
  await expect(page.getByText("继续处理当前任务", { exact: true })).toBeVisible();
});

test("toggles the completed execution process from the processing time", async ({ page }) => {
  await page.route("**/v1/projects/code-agent/tasks/task-1", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        ...taskSnapshotResponse,
        snapshot: {
          ...taskSnapshot,
          turns: [
            {
              completedAt: "2026-08-06T00:00:08.000Z",
              error: null,
              id: "turn-collapsed-process",
              items: [
                {
                  id: "message-process-commentary",
                  phase: "commentary",
                  role: "assistant",
                  text: "正在读取项目配置。",
                  type: "message",
                },
                {
                  command: "pnpm check",
                  cwd: "/workspace/CodeAgent",
                  exitCode: 0,
                  id: "command-process-check",
                  output: "Checks passed",
                  outputTruncated: false,
                  status: "completed",
                  type: "command",
                },
                {
                  id: "message-process-final",
                  phase: "final_answer",
                  role: "assistant",
                  text: "实现与检查已完成。",
                  type: "message",
                },
              ],
              startedAt: "2026-08-06T00:00:00.000Z",
              status: "completed",
            },
          ],
          updatedAt: "2026-08-06T00:00:08.000Z",
        },
      },
    });
  });
  await page.goto("/p/code-agent/t/task-1");

  await expect(page.getByText("实现与检查已完成。", { exact: true })).toBeVisible();
  await expect(page.getByText("正在读取项目配置。", { exact: true })).toHaveCount(0);
  await expect(page.getByText("pnpm check", { exact: true })).toHaveCount(0);

  const expandProcess = page.getByRole("button", { name: "展开执行过程" });
  await expect(expandProcess).toHaveAttribute("aria-expanded", "false");
  await expandProcess.click();

  await expect(page.getByText("正在读取项目配置。", { exact: true })).toBeVisible();
  await expect(page.getByText("pnpm check", { exact: true })).toBeVisible();
  const collapseProcess = page.getByRole("button", { name: "收起执行过程" });
  await expect(collapseProcess).toHaveAttribute("aria-expanded", "true");
  await collapseProcess.click();

  await expect(page.getByText("正在读取项目配置。", { exact: true })).toHaveCount(0);
  await expect(page.getByText("pnpm check", { exact: true })).toHaveCount(0);
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
  expect(Math.abs(historicalInlineOffset)).toBeLessThanOrEqual(1);

  const prompt = page.getByRole("textbox", { name: "任务输入" });
  await prompt.fill("第一行");
  await prompt.press("End");
  // 浏览器流程验证修饰键换行的真实 DOM 插入，平台键位映射由组件单元测试覆盖。
  await prompt.press("Control+Enter");
  await page.keyboard.type("第二行");
  await expect(prompt).toHaveAttribute("data-serialized-value", "第一行\n第二行");

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
  await page.getByRole("main", { name: "任务时间线" }).click({ position: { x: 10, y: 10 } });
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
  for (const label of ["初始化", "压缩", "复制", "计划"]) {
    await expect(commandMenu.getByRole("option", { name: new RegExp(label, "u") })).toBeVisible();
  }
  await expect(commandMenu.getByRole("option", { name: /副任务|反馈/u })).toHaveCount(0);

  for (let movementIndex = 0; movementIndex < 7; movementIndex += 1) {
    await prompt.press("ArrowDown");
  }
  await expect(commandMenu.getByRole("option", { name: /Documentation writer/u })).toHaveAttribute(
    "data-active",
    "true",
  );

  await prompt.fill("说明/security");
  await expect(commandMenu).toBeHidden();
  await prompt.fill("说明 /security");
  await expect(commandMenu).toBeVisible();
  await prompt.press("Enter");
  const selectedSkill = prompt.locator('[data-prompt-skill-id="skill-security"]');
  await expect(selectedSkill).toContainText("Security review");
  await expect(selectedSkill).toHaveAttribute("data-serialized-text", "$review-security");
  await expect(prompt).toHaveAttribute("data-serialized-value", "说明 $review-security");
  const caretAnchor = await prompt.evaluate((editor) => {
    const selection = document.getSelection();
    const anchorNode = selection?.anchorNode;
    return {
      anchorOffset: selection?.anchorOffset,
      anchoredAfterSkill:
        anchorNode instanceof Node &&
        editor.contains(anchorNode) &&
        anchorNode.parentElement?.dataset["promptCaretAnchor"] !== undefined &&
        anchorNode.parentElement.previousElementSibling?.matches("[data-prompt-skill-id]") === true,
    };
  });
  // Safari 会把根节点边界选区绘制到行首，末尾 Token 必须使用可编辑文本锚点承载光标。
  expect(caretAnchor).toEqual({ anchorOffset: 1, anchoredAfterSkill: true });
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
  expect(Math.abs(editorBaselineOffset)).toBeLessThanOrEqual(1);
  await page.keyboard.type(" /documentation");
  await expect(commandMenu).toBeVisible();
  await prompt.press("Enter");
  const selectedDocumentationSkill = prompt.locator('[data-prompt-skill-id="skill-docs"]');
  await expect(selectedDocumentationSkill).toContainText("Documentation writer");
  await expect(prompt).toHaveAttribute(
    "data-serialized-value",
    "说明 $review-security $documentation-writer",
  );
  // 浏览器快捷键跟随运行平台，确保 macOS、Linux 和 Windows 都能完成全选复制。
  const primaryModifier = process.platform === "darwin" ? "Meta" : "Control";
  await prompt.press(`${primaryModifier}+a`);
  await prompt.press(`${primaryModifier}+c`);
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe("说明 $review-security $documentation-writer");
  const skillColors = await selectedSkill.evaluate((element) => {
    const probe = document.createElement("span");
    probe.style.color = "var(--ui-color-accent)";
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
  const endCaretAnchor = await prompt.evaluate((editor) => {
    const selection = document.getSelection();
    const anchorNode = selection?.anchorNode;
    return {
      anchorOffset: selection?.anchorOffset,
      anchoredAfterSkill:
        anchorNode instanceof Node &&
        editor.contains(anchorNode) &&
        anchorNode.parentElement?.dataset["promptCaretAnchor"] !== undefined &&
        anchorNode.parentElement.previousElementSibling?.matches("[data-prompt-skill-id]") === true,
    };
  });
  expect(endCaretAnchor).toEqual({ anchorOffset: 1, anchoredAfterSkill: true });
  await prompt.press("Backspace");
  await expect(selectedDocumentationSkill).toBeHidden();

  await prompt.fill("/压缩");
  await prompt.press("Enter");
  await expect(page.locator('[data-sonner-toast][data-type="success"]')).toHaveText(
    "正在压缩上下文",
  );
  await expect
    .poll(() => commandRequests.map((request) => request.path))
    .toContain("/v1/projects/code-agent/tasks/task-1/compact");

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

test("recognizes typed Codex skill references before submission", async ({ page }) => {
  let turnRequest: Record<string, unknown> | undefined;
  await page.route("**/v1/projects/code-agent/tasks/task-1/turns", async (route) => {
    turnRequest = parseRequestRecord(route.request().postData());
    await route.fulfill({
      contentType: "application/json",
      json: {
        taskId: "task-1",
        turn: {
          completedAt: null,
          error: null,
          id: "typed-skill-turn",
          items: [],
          startedAt: "2026-08-09T00:00:00.000Z",
          status: "running",
        },
      },
    });
  });
  await page.goto("/p/code-agent/t/task-1");

  const prompt = page.getByRole("textbox", { name: "任务输入" });
  await prompt.fill("/");
  await expect(page.getByRole("option", { name: /Security review/u })).toBeVisible();
  await prompt.fill("");
  await prompt.fill("$review-security 其他需求");
  await expect(prompt.locator('[data-prompt-skill-id="skill-security"]')).toContainText(
    "Security review",
  );
  await expect(prompt).toHaveAttribute("data-serialized-value", "$review-security 其他需求");
  await prompt.press("Enter");

  await expect.poll(() => turnRequest).toBeDefined();
  expect(turnRequest?.["input"]).toEqual({
    attachments: [],
    skills: [{ id: "skill-security", name: "review-security" }],
    text: "其他需求",
    type: "prompt",
  });
});

test("selects and submits a project file reference from an inline @ mention", async ({ page }) => {
  let turnRequest: Record<string, unknown> | undefined;
  const fileSearchQueries: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/v1/projects/code-agent/files/search") {
      fileSearchQueries.push(url.searchParams.get("query") ?? "");
    }
  });
  await page.route("**/v1/projects/code-agent/tasks/task-1/turns", async (route) => {
    turnRequest = parseRequestRecord(route.request().postData());
    await route.fulfill({
      contentType: "application/json",
      json: {
        taskId: "task-1",
        turn: {
          completedAt: null,
          error: null,
          id: "file-reference-turn",
          items: [],
          startedAt: "2026-08-10T00:00:00.000Z",
          status: "running",
        },
      },
      status: 201,
    });
  });
  await page.goto("/p/code-agent/t/task-1");

  const prompt = page.getByRole("textbox", { name: "任务输入" });
  await prompt.fill("请检查 ");
  await page.keyboard.type("@main", { delay: 20 });
  const fileMenu = page.getByRole("listbox", { name: "搜索项目文件" });
  await expect(fileMenu).toBeVisible();
  await expect(fileMenu.getByRole("option")).toHaveCount(2);
  expect(fileSearchQueries).toEqual(["main"]);
  await expect(fileMenu.getByRole("option").first()).toContainText("src");
  await prompt.press("Enter");

  const fileToken = prompt.locator('[data-prompt-file-path="src/main.tsx"]');
  await expect(fileToken).toBeVisible();
  await page.keyboard.type("读取文件");
  await expect(prompt).toHaveAttribute("data-serialized-value", "请检查 @src/main.tsx读取文件");
  await page.getByRole("button", { exact: true, name: "提交" }).click();

  await expect.poll(() => turnRequest).toBeDefined();
  expect(turnRequest?.["input"]).toEqual({
    attachments: [],
    skills: [],
    text: "请检查 @src/main.tsx 读取文件",
    type: "prompt",
  });
  const submittedMessage = page.locator('article[data-role="user"]').last();
  await expect(submittedMessage).toContainText("请检查");
  await expect(submittedMessage.locator('[data-prompt-file-reference="src/main.tsx"]')).toHaveText(
    "main.tsx",
  );
  await expect(submittedMessage).toContainText("读取文件");
});

test("从 AI 回复复制任务并保留到所属 Turn", async ({ page }) => {
  const forkRequests: Readonly<{ body: Record<string, unknown>; path: string }>[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (request.method() === "POST" && url.pathname.endsWith("/fork")) {
      forkRequests.push({
        body: parseRequestRecord(request.postData()),
        path: url.pathname,
      });
    }
  });
  await page.goto("/p/code-agent/t/task-1");

  const latestReply = page
    .locator('article[data-role="assistant"]')
    .filter({ hasText: "工作台界面已按统一的 项目 Agent 组件 结构重新组织。" });
  const copyMessageButton = latestReply.getByRole("button", { name: "复制消息" });
  await expect(copyMessageButton).toBeVisible();
  await expect(latestReply.getByRole("button", { name: "复制任务" })).toBeVisible();
  await copyMessageButton.hover();
  await expect(page.getByRole("tooltip")).toHaveText("复制消息");

  await latestReply.getByRole("button", { name: "复制任务" }).click();

  await expect
    .poll(() => forkRequests)
    .toContainEqual({
      body: { lastTurnId: "turn-1" },
      path: "/v1/projects/code-agent/tasks/task-1/fork",
    });
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
            plan: null,
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

test("loads long source files while scrolling", async ({ context, page }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/p/code-agent/t/task-1");

  const sourceReference = page.getByRole("button", {
    name: /architecture-design\.md\s+\(line 100\)/u,
  });
  await sourceReference.click();

  const dialog = page.getByRole("dialog", { name: "architecture-design.md (line 100)" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("部分内容")).toBeVisible();
  await expect(dialog.locator('[data-language="markdown"]')).toBeVisible();
  const highlightedLine = dialog.locator('[data-code-line="100"]');
  await expect(highlightedLine).toContainText("### 11.7 外部登录边界");
  await expect(highlightedLine).toHaveAttribute("data-highlighted", "true");
  await expect(highlightedLine).toBeInViewport();

  await dialog.locator('[data-code-line="720"]').scrollIntoViewIfNeeded();
  await expect(dialog.locator('[data-code-line="800"]')).toContainText("line 800");
  await expect(dialog.getByText("部分内容")).toBeHidden();

  await dialog.getByRole("button", { name: "预览 Markdown" }).click();
  await expect(dialog.getByRole("heading", { name: "11.7 外部登录边界" })).toBeVisible();
  await expect(dialog.locator('[data-language="markdown"]')).not.toBeAttached();

  await dialog.getByRole("button", { name: "显示原始内容" }).click();
  await expect(dialog.locator('[data-language="markdown"]')).toBeVisible();

  await dialog.getByRole("button", { name: "复制代码" }).click();
  await expect(dialog.getByRole("button", { name: "代码已复制" })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const clipboardText = await navigator.clipboard.readText();
        // Windows 剪贴板会把多行文本规范化为 CRLF，比较前统一为 LF。
        return clipboardText.replace(/\r\n?/gu, "\n");
      }),
    )
    .toBe(architectureSourcePreview);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await sourceReference.click();
  await expect(dialog).toBeVisible();
  await page.mouse.click(1, 1);
  await expect(dialog).toBeHidden();
});

test("routes assistant links, images, and system files by Markdown file rules", async ({
  page,
}) => {
  const systemOpenRequest = page.waitForRequest((request) => {
    if (new URL(request.url()).pathname !== "/v1/projects/code-agent/open") {
      return false;
    }
    const body = parseRequestRecord(request.postData());
    return (
      body["appId"] === "system-default" &&
      body["path"] === "/home/taoye/100%完成/AI 领航/后续工作交接.pptx"
    );
  });
  await page.goto("/p/code-agent/t/task-1");

  const externalLink = page.getByRole("link", { name: "OpenAI" });
  await expect(externalLink).toHaveAttribute("target", "_blank");
  await expect(externalLink).toHaveAttribute("rel", "noopener noreferrer");

  await page.getByRole("button", { name: "result.png" }).click();
  const imageDialog = page.getByRole("dialog", { name: "result.png" });
  await expect(imageDialog).toBeVisible();
  await expect(imageDialog.getByRole("img", { name: "result.png" })).toHaveAttribute(
    "src",
    "/v1/projects/code-agent/files/image?path=%2Fworkspace%2FCodeAgent%2Fdesign%2Fresult.png",
  );
  await page.keyboard.press("Escape");
  await expect(imageDialog).toBeHidden();

  await page.getByRole("button", { exact: true, name: "后续工作交接.pptx" }).click();
  await systemOpenRequest;
  await expect(page.getByRole("dialog", { name: "后续工作交接.pptx" })).toHaveCount(0);
});

test("project file tree opens changed, source, image, and system files by shared rules", async ({
  page,
}) => {
  await page.goto("/p/code-agent/t/task-1");

  const inspector = page.getByRole("complementary", { name: "运行环境" });
  await inspector.getByRole("tab", { name: "项目" }).click();
  const fileTree = inspector.getByRole("tree", { name: "项目文件" });
  await expect(fileTree).toBeVisible();
  await expect(fileTree.getByRole("treeitem", { name: "architecture-design.md" })).toHaveCount(0);

  await fileTree.getByRole("treeitem", { name: /package\.json/u }).click();
  const diffDialog = page.getByRole("dialog", { name: "package.json" });
  await expect(diffDialog.locator(".file-diff-renderer")).toContainText("pnpm run dev");
  await page.getByRole("button", { name: "关闭文件 Diff" }).click();
  await expect(diffDialog).not.toBeAttached();

  const docsRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return (
      url.pathname === "/v1/projects/code-agent/files/tree" &&
      url.searchParams.get("path") === "docs"
    );
  });
  await fileTree.getByRole("treeitem", { name: "docs" }).click();
  await docsRequest;
  await fileTree.getByRole("treeitem", { name: "architecture-design.md" }).click();
  const sourceDialog = page.getByRole("dialog", { name: "architecture-design.md" });
  await expect(sourceDialog).toBeVisible();
  await sourceDialog.getByRole("button", { name: "关闭源文件" }).click();
  await expect(sourceDialog).not.toBeAttached();

  const imageRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return (
      url.pathname === "/v1/projects/code-agent/files/image" &&
      url.searchParams.get("path") === "design/result.png"
    );
  });
  await fileTree.getByRole("button", { name: "展开文件夹 design" }).click();
  await fileTree.getByRole("treeitem", { name: "result.png" }).click();
  await imageRequest;
  const imageDialog = page.getByRole("dialog", { name: "result.png" });
  await expect(imageDialog.getByRole("img", { name: "result.png" })).toBeVisible();
  await imageDialog.getByRole("button", { name: "关闭图片预览" }).click();
  await expect(imageDialog).not.toBeAttached();

  const systemOpenRequest = page.waitForRequest((request) => {
    if (new URL(request.url()).pathname !== "/v1/projects/code-agent/open") {
      return false;
    }
    const body = parseRequestRecord(request.postData());
    return body["appId"] === "system-default" && body["path"] === "100%完成 后续工作交接.pptx";
  });
  await fileTree.getByRole("treeitem", { name: "100%完成 后续工作交接.pptx" }).click();
  await systemOpenRequest;
  await expect(page.getByRole("dialog", { name: "100%完成 后续工作交接.pptx" })).toHaveCount(0);
});

test("project file tree refresh, context menu, and ellipsis share target actions", async ({
  page,
}) => {
  let turnRequest: Record<string, unknown> | undefined;
  await page.route("**/v1/projects/code-agent/tasks/task-1/turns", async (route) => {
    turnRequest = parseRequestRecord(route.request().postData());
    await route.fulfill({
      contentType: "application/json",
      json: {
        taskId: "task-1",
        turn: {
          completedAt: null,
          error: null,
          id: "inspector-file-reference-turn",
          items: [],
          startedAt: "2026-08-11T00:00:00.000Z",
          status: "running",
        },
      },
      status: 201,
    });
  });
  await page.goto("/p/code-agent/t/task-1");

  const inspector = page.getByRole("complementary", { name: "运行环境" });
  await inspector.getByRole("tab", { name: "项目" }).click();
  const fileTree = inspector.getByRole("tree", { name: "项目文件" });
  const selectOpenApp = async (name: string) => {
    const item = page.getByRole("menuitem", { name });
    await expect(item).toBeVisible();
    await item.focus();
    await item.press("Enter");
  };
  await expect(fileTree.getByRole("button", { name: "在 Zed 中打开" })).toHaveCount(0);

  const rootRequest = page.waitForRequest((request) => {
    if (!/^\/v1\/projects\/code-agent\/open$/u.test(new URL(request.url()).pathname)) {
      return false;
    }
    const body = parseRequestRecord(request.postData());
    return body["appId"] === "finder" && !("path" in body);
  });
  const rootTreeItem = fileTree.getByRole("treeitem", { name: "CodeAgent" }).first();
  await expect(rootTreeItem).toHaveAttribute("aria-expanded", "true");
  const rootRefresh = rootTreeItem.getByRole("button", { name: "刷新项目 CodeAgent" });
  const rootTreeRefreshRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.pathname === "/v1/projects/code-agent/files/tree" && !url.searchParams.has("path");
  });
  const gitRefreshRequest = page.waitForRequest(
    (request) => new URL(request.url()).pathname === "/v1/projects/code-agent/git/status",
  );
  await expect(rootRefresh).toHaveClass(/opacity-0/u);
  await expect(rootRefresh.locator("svg")).toHaveCSS("width", "14px");
  await expect(rootRefresh.locator("svg")).toHaveCSS("height", "14px");
  await rootTreeItem.locator(":scope > div").first().hover();
  await expect(rootRefresh).toHaveCSS("opacity", "1");
  await rootRefresh.click();
  await Promise.all([rootTreeRefreshRequest, gitRefreshRequest]);
  await rootTreeItem
    .getByRole("button", { exact: true, name: "CodeAgent" })
    .click({ button: "right" });
  const rootMenu = page.getByRole("menu", { name: "~/Develop/person/CodeAgent 的操作" });
  await expect(rootMenu.getByRole("menuitem", { name: "复制名称" })).toBeVisible();
  await expect(rootMenu.getByRole("menuitem", { name: "复制路径" })).toBeVisible();
  await expect(rootMenu.getByRole("menuitem", { name: "引用" })).toHaveCount(0);
  await rootMenu.getByRole("menuitem", { name: "复制名称" }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("CodeAgent");
  await rootTreeItem
    .getByRole("button", { exact: true, name: "CodeAgent" })
    .click({ button: "right" });
  await rootMenu.getByRole("menuitem", { name: "复制路径" }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe("~/Develop/person/CodeAgent");
  await rootTreeItem
    .getByRole("button", { exact: true, name: "CodeAgent" })
    .click({ button: "right" });
  await rootMenu.getByRole("menuitem", { name: "打开" }).click();
  await selectOpenApp("Finder");
  await rootRequest;
  await expect(rootMenu).not.toBeAttached();

  const folderRequest = page.waitForRequest((request) => {
    if (!/^\/v1\/projects\/code-agent\/open$/u.test(new URL(request.url()).pathname)) {
      return false;
    }
    const body = parseRequestRecord(request.postData());
    return body["appId"] === "finder" && body["path"] === "docs";
  });
  const docsTreeItem = fileTree.getByRole("treeitem", { name: "docs" });
  const docsExpandButton = docsTreeItem.getByRole("button", { name: "展开文件夹 docs" });
  const docsNameButton = docsTreeItem.getByRole("button", { exact: true, name: "docs" });
  const [docsExpandBox, docsNameBox] = await Promise.all([
    docsExpandButton.boundingBox(),
    docsNameButton.boundingBox(),
  ]);
  expect(docsExpandBox).not.toBeNull();
  expect(docsNameBox).not.toBeNull();
  expect((docsNameBox?.x ?? 0) - ((docsExpandBox?.x ?? 0) + (docsExpandBox?.width ?? 0))).toBe(4);
  await expect(docsNameButton).toHaveCSS("padding-left", "0px");
  await expect(docsNameButton).toHaveCSS("padding-right", "0px");
  await docsTreeItem.click({ button: "right" });
  const folderMenu = page.getByRole("menu", { name: "docs 的操作" });
  await expect(folderMenu).toBeVisible();
  await expect(folderMenu.getByRole("menuitem", { name: "复制名称" })).toBeVisible();
  await expect(folderMenu.getByRole("menuitem", { name: "复制路径" })).toBeVisible();
  await expect(folderMenu.getByRole("menuitem", { name: "打开" })).toBeVisible();
  await expect(folderMenu.getByRole("menuitem", { name: "引用" })).toHaveCount(0);
  await expect(docsTreeItem).toHaveAttribute("aria-selected", "true");
  await folderMenu.getByRole("menuitem", { name: "复制路径" }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe("~/Develop/person/CodeAgent/docs");
  await docsTreeItem.click({ button: "right" });
  await folderMenu.getByRole("menuitem", { name: "打开" }).click();
  await expect(page.getByRole("menuitem", { name: "系统默认应用" })).toHaveCount(0);
  await selectOpenApp("Finder");
  await folderRequest;
  await expect(folderMenu).not.toBeAttached();

  const folderActionRequest = page.waitForRequest((request) => {
    if (!/^\/v1\/projects\/code-agent\/open$/u.test(new URL(request.url()).pathname)) {
      return false;
    }
    const body = parseRequestRecord(request.postData());
    return body["appId"] === "zed" && body["path"] === "docs";
  });
  const folderAction = docsTreeItem.getByRole("button", { name: "docs 的操作" });
  await expect(folderAction).toHaveClass(/opacity-0/u);
  await docsTreeItem.hover();
  await expect(docsTreeItem.locator(":scope > div").first()).toHaveCSS(
    "background-color",
    "rgba(23, 23, 23, 0.075)",
  );
  await expect(docsNameButton).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(folderAction).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(folderAction).toHaveCSS("opacity", "1");
  await folderAction.click();
  const folderActionMenu = page.getByRole("menu", { name: "docs 的操作" });
  await folderActionMenu.getByRole("menuitem", { name: "打开" }).click();
  const folderActionMenuIcon = page.getByRole("menuitem", { name: "Zed" }).locator("svg");
  await expect(folderActionMenuIcon).toHaveCSS("width", "16px");
  await expect(folderActionMenuIcon).toHaveCSS("height", "16px");
  await selectOpenApp("Zed");
  await folderActionRequest;
  await expect(folderActionMenu).not.toBeAttached();

  const fileRequest = page.waitForRequest((request) => {
    if (!/^\/v1\/projects\/code-agent\/open$/u.test(new URL(request.url()).pathname)) {
      return false;
    }
    const body = parseRequestRecord(request.postData());
    return body["appId"] === "system-default" && body["path"] === "package.json";
  });
  const packageTreeItem = fileTree.getByRole("treeitem", { name: /package\.json/u });
  await packageTreeItem.click({ button: "right" });
  const fileMenu = page.getByRole("menu", { name: "package.json 的操作" });
  await expect(packageTreeItem).toHaveAttribute("aria-selected", "true");
  await expect(packageTreeItem).toHaveClass(/bg-control/u);
  await fileMenu.getByRole("menuitem", { name: "打开" }).click();
  await selectOpenApp("系统默认应用");
  await fileRequest;
  await expect(fileMenu).not.toBeAttached();

  const fileActionRequest = page.waitForRequest((request) => {
    if (!/^\/v1\/projects\/code-agent\/open$/u.test(new URL(request.url()).pathname)) {
      return false;
    }
    const body = parseRequestRecord(request.postData());
    return body["appId"] === "zed" && body["path"] === "package.json";
  });
  const fileAction = packageTreeItem.getByRole("button", { name: "package.json 的操作" });
  await packageTreeItem.hover();
  await expect(fileAction).toBeVisible();
  await fileAction.click();
  const fileActionMenu = page.getByRole("menu", { name: "package.json 的操作" });
  await fileActionMenu.getByRole("menuitem", { name: "打开" }).click();
  await selectOpenApp("Zed");
  await fileActionRequest;
  await expect(fileActionMenu).not.toBeAttached();

  const prompt = page.getByRole("textbox", { name: "任务输入" });
  await docsTreeItem.click({ button: "right" });
  await expect(folderMenu.getByRole("menuitem", { name: "引用" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await packageTreeItem.click({ button: "right" });
  await fileMenu.getByRole("menuitem", { name: "引用" }).click();
  await expect(prompt.getByRole("button", { name: "@package.json" })).toBeVisible();
  await page.getByRole("button", { exact: true, name: "提交" }).click();
  await expect.poll(() => turnRequest).toBeDefined();
  expect(turnRequest?.["input"]).toEqual({
    attachments: [],
    skills: [],
    text: "@package.json",
    type: "prompt",
  });
});

test("keeps pasted images in attachments instead of the text editor @cross-browser", async ({
  page,
}) => {
  await page.goto("/p/code-agent/t/task-1");

  const prompt = page.getByRole("textbox", { name: "任务输入" });
  const pasteWasCanceled = await prompt.evaluate((element) => {
    const clipboardData = new DataTransfer();
    clipboardData.items.add(
      new File([new Uint8Array([137, 80, 78, 71])], "pasted.png", { type: "image/png" }),
    );
    const event = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData,
    });
    if (event.clipboardData !== clipboardData) {
      // Firefox 忽略 ClipboardEventInit.clipboardData，测试需显式提供真实事件字段。
      Object.defineProperty(event, "clipboardData", { value: clipboardData });
    }

    return !element.dispatchEvent(event) && event.defaultPrevented;
  });

  await expect(page.getByText("pasted.png", { exact: true })).toBeVisible();
  await expect(prompt.locator("img")).toHaveCount(0);
  expect(pasteWasCanceled).toBe(true);
});

test("converts large pasted text into a submitted file attachment", async ({ page }) => {
  let uploadRequest:
    { contentType: string | undefined; postData: string | null; url: string } | undefined;
  let turnBody: unknown;
  await page.route("**/v1/projects/code-agent/attachments/*", async (route) => {
    const request = route.request();
    uploadRequest = {
      contentType: request.headers()["content-type"],
      postData: request.postData(),
      url: request.url(),
    };
    await route.fulfill({
      contentType: "application/json",
      json: {
        attachment: {
          id: "attachment-pasted-text",
          kind: "text",
          mediaType: "text/plain",
          name: "Pasted text.txt",
          size: 1_001,
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
          id: "turn-pasted-text",
          items: [],
          startedAt: "2026-08-01T00:00:00.000Z",
          status: "running",
        },
      },
      status: 201,
    });
  });
  await page.goto("/p/code-agent/t/task-1");

  const prompt = page.getByRole("textbox", { name: "任务输入" });
  const pasteResult = await prompt.evaluate((element) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", "x".repeat(1_001));
    const event = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData,
    });

    const dispatchResult = element.dispatchEvent(event);
    return {
      clipboardTextLength: clipboardData.getData("text/plain").length,
      pasteWasCanceled: !dispatchResult && event.defaultPrevented,
    };
  });

  expect(pasteResult).toEqual({ clipboardTextLength: 1_001, pasteWasCanceled: true });
  await expect(prompt).toHaveAttribute("data-serialized-value", "");
  await expect(page.getByText("Pasted text.txt", { exact: true })).toBeVisible();

  await page.getByRole("button", { exact: true, name: "提交" }).click();
  const submittedAttachment = page.locator('[data-message-attachment="text"]');
  await expect(submittedAttachment).toBeVisible();
  await expect(submittedAttachment).toContainText("Pasted text.txt");
  await expect(submittedAttachment).toContainText("1001 B");
  await expect(submittedAttachment.locator("img")).toHaveCount(0);

  expect(uploadRequest?.url).toMatch(/\/attachments\/text$/u);
  expect(uploadRequest?.contentType).toMatch(/^multipart\/form-data; boundary=/u);
  expect(uploadRequest?.postData).toContain('name="attachment"; filename="Pasted text.txt"');
  expect(turnBody).toMatchObject({
    input: {
      attachments: [{ id: "attachment-pasted-text" }],
      text: "",
      type: "prompt",
    },
  });
});

test("submits host attachments, approval policy, model, and reasoning effort through the real client contract", async ({
  page,
}) => {
  let importRequest: { body: unknown; url: string } | undefined;
  let turnBody: unknown;
  const previewRequests: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "GET" &&
      request.url().endsWith("/v1/projects/code-agent/attachments/attachment-1")
    ) {
      previewRequests.push(request.url());
    }
  });
  await page.route("**/v1/projects/code-agent/attachments/image/host", async (route) => {
    const request = route.request();
    importRequest = {
      body: request.postDataJSON(),
      url: request.url(),
    };
    await route.fulfill({
      contentType: "application/json",
      json: {
        attachment: {
          id: "attachment-1",
          kind: "image",
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

  const modelSelector = page.getByRole("button", { name: /^模型和思考量：/u });
  await expect(modelSelector).toHaveAccessibleName("模型和思考量：GPT-5.6 Sol，高");
  await modelSelector.click();
  const selectorMenu = page.getByRole("menu", { name: "模型和思考量" });
  expect((await selectorMenu.boundingBox())?.width).toBeLessThanOrEqual(160);
  await page.getByRole("menuitem", { name: "选择模型" }).click();
  const modelMenu = page.getByRole("menu", { name: "选择模型" });
  await expect(modelMenu.getByRole("menuitemradio")).toHaveCount(2);
  await expect(modelMenu).not.toContainText("适合复杂编码任务");
  expect((await modelMenu.boundingBox())?.width).toBeLessThanOrEqual(160);
  await modelMenu.getByRole("menuitemradio", { name: /GPT-5\.6 Terra/u }).click();
  await expect(modelSelector).toHaveAccessibleName("模型和思考量：GPT-5.6 Terra，中");

  await modelSelector.click();
  await page.getByRole("menuitem", { name: "选择思考量" }).click();
  const reasoningMenu = page.getByRole("menu", { name: "选择思考量" });
  await expect(reasoningMenu.getByRole("menuitemradio")).toHaveCount(2);
  await expect(reasoningMenu.getByRole("menuitemradio")).toHaveText(["低", "中"]);
  expect((await reasoningMenu.boundingBox())?.width).toBeLessThanOrEqual(112);
  await reasoningMenu.getByRole("menuitemradio", { name: /低/u }).click();
  await expect(modelSelector).toHaveAccessibleName("模型和思考量：GPT-5.6 Terra，低");
  const approvalSelect = page.getByRole("combobox", { name: "批准模式" });
  const sandboxSelect = page.getByRole("combobox", { name: "沙盒模式" });
  await expect(approvalSelect.locator("xpath=following-sibling::select[1]")).toHaveAttribute(
    "aria-label",
    "沙盒模式",
  );
  await approvalSelect.selectOption("auto-review");
  await sandboxSelect.selectOption("danger-full-access");
  await chooseHostAttachment(page, "image", "screen.png");
  await expect(page.getByText("screen.png", { exact: true })).toBeVisible();
  await expect.poll(() => previewRequests).toHaveLength(1);
  const prompt = page.getByRole("textbox", { name: "任务输入" });
  const commandMenu = page.getByRole("listbox", { name: "输入命令" });
  await prompt.fill("/plan");
  await expect(commandMenu.getByRole("option", { name: /计划/u })).toBeVisible();
  await prompt.press("Enter");
  const planModeTag = page.getByRole("button", { name: "取消计划模式" });
  await expect(planModeTag).toBeVisible();
  await expect
    .poll(() =>
      sandboxSelect.evaluate(
        (element) => element.nextElementSibling?.hasAttribute("data-plan-mode") ?? false,
      ),
    )
    .toBe(true);
  await planModeTag.hover();
  await expect(planModeTag.locator("svg").last()).toHaveCSS("opacity", "1");
  await planModeTag.click();
  await expect(planModeTag).toHaveCount(0);
  await prompt.fill("/plan");
  await prompt.press("Enter");
  await expect(page.getByRole("button", { name: "取消计划模式" })).toBeVisible();
  await prompt.fill("/security");
  await expect(commandMenu.getByRole("option", { name: /Security review/u })).toBeVisible();
  await prompt.press("Enter");
  await expect(prompt.locator('[data-prompt-skill-id="skill-security"]')).toBeVisible();
  await prompt.focus();
  await prompt.press("End");
  await page.keyboard.type(" /documentation");
  await expect(commandMenu.getByRole("option", { name: /Documentation writer/u })).toBeVisible();
  await prompt.press("Enter");
  await expect(prompt.locator('[data-prompt-skill-id="skill-docs"]')).toBeVisible();
  await prompt.focus();
  await prompt.press("End");
  await page.keyboard.type(" 按截图完成改造");
  await page.getByRole("button", { exact: true, name: "提交" }).click();

  await expect(prompt).toHaveAttribute("data-serialized-value", "");
  await expect(prompt.locator("[data-prompt-skill-id]")).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "消息编辑器" }).getByText("screen.png", { exact: true }),
  ).toHaveCount(0);
  await expect(page.locator('[data-message-skill="documentation-writer"]')).toBeVisible();
  expect(importRequest?.url).toMatch(/\/attachments\/image\/host$/u);
  expect(importRequest?.body).toEqual({ path: "/Users/bryan/Attachments/screen.png" });
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
      collaborationMode: "plan",
      model: "gpt-5.6-terra",
      reasoningEffort: "low",
      sandboxMode: "danger-full-access",
    },
  });
});

test("selects, clears, and submits goal mode", async ({ page }) => {
  let turnBody: unknown;
  await page.route("**/v1/projects/code-agent/tasks/task-1/turns", async (route) => {
    turnBody = route.request().postDataJSON();
    await route.fulfill({
      contentType: "application/json",
      json: {
        taskId: "task-1",
        turn: {
          completedAt: null,
          error: null,
          id: "turn-goal",
          items: [],
          startedAt: "2026-08-05T13:00:00.000Z",
          status: "running",
        },
      },
      status: 201,
    });
  });
  await page.goto("/p/code-agent/t/task-1");

  const prompt = page.getByRole("textbox", { name: "任务输入" });
  const commandMenu = page.getByRole("listbox", { name: "输入命令" });
  const sandboxSelect = page.getByRole("combobox", { name: "沙盒模式" });
  await prompt.fill("/goal");
  await expect(commandMenu.getByRole("option", { name: /目标/u })).toBeVisible();
  await prompt.press("Enter");

  const goalModeTag = page.getByRole("button", { name: "取消目标模式" });
  await expect(goalModeTag).toBeVisible();
  await expect
    .poll(() =>
      sandboxSelect.evaluate(
        (element) => element.nextElementSibling?.hasAttribute("data-goal-mode") ?? false,
      ),
    )
    .toBe(true);
  await goalModeTag.hover();
  await expect(goalModeTag.locator("svg").last()).toHaveCSS("opacity", "1");
  await goalModeTag.click();
  await expect(goalModeTag).toHaveCount(0);

  await prompt.fill("/goal");
  await prompt.press("Enter");
  await prompt.fill("仅回复 GOAL_MODE_CHECK，不修改文件");
  await page.getByRole("button", { exact: true, name: "提交" }).click();

  await expect(page.getByRole("button", { name: "取消目标模式" })).toHaveCount(0);
  expect(turnBody).toEqual({
    input: {
      attachments: [],
      skills: [],
      text: "仅回复 GOAL_MODE_CHECK，不修改文件",
      type: "prompt",
    },
    options: {
      ...taskSnapshot.settings,
      goalMode: true,
    },
  });
});

test("builds a completed plan as a normal development turn", async ({ page }) => {
  let turnBody: unknown;
  const completedPlanSnapshot = {
    ...taskSnapshot,
    status: "idle" as const,
    turns: [
      {
        completedAt: "2026-08-05T06:00:30.000Z",
        error: null,
        id: "turn-plan",
        items: [
          {
            id: "plan-1",
            text: "# 实施计划\n\n- 调整计划卡片\n- 验证构建流程",
            type: "plan" as const,
          },
        ],
        startedAt: "2026-08-05T06:00:00.000Z",
        status: "completed" as const,
      },
    ],
  };
  await page.route("**/v1/projects/code-agent/tasks/task-1", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        checkpoint: { sequence: 0, sessionId: "e2e-session" },
        snapshot: completedPlanSnapshot,
      },
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
          id: "turn-build-plan",
          items: [],
          startedAt: "2026-08-05T06:01:00.000Z",
          status: "running",
        },
      },
      status: 201,
    });
  });
  await page.goto("/p/code-agent/t/task-1");

  const prompt = page.getByRole("textbox", { name: "任务输入" });
  await prompt.fill("/plan");
  await prompt.press("Enter");
  await expect(page.getByRole("button", { name: "取消计划模式" })).toBeVisible();
  await expect(page.locator('[data-ai-plan-card=""]')).toBeVisible();
  await expect(page.getByRole("heading", { name: "实施计划" })).toBeVisible();

  await page.getByRole("button", { exact: true, name: "构建" }).click();

  await expect(page.getByRole("button", { name: "取消计划模式" })).toHaveCount(0);
  await expect(page.getByText("请开始按照上述计划进行开发。", { exact: true })).toBeVisible();
  expect(turnBody).toEqual({
    input: {
      attachments: [],
      skills: [],
      text: "请开始按照上述计划进行开发。",
      type: "prompt",
    },
    options: taskSnapshot.settings,
  });
});

test("selects and submits a host file as an attachment", async ({ page }) => {
  let importRequest: { body: unknown; url: string } | undefined;
  let turnBody: unknown;
  await page.route("**/v1/projects/code-agent/attachments/file/host", async (route) => {
    const request = route.request();
    importRequest = {
      body: request.postDataJSON(),
      url: request.url(),
    };
    await route.fulfill({
      contentType: "application/json",
      json: {
        attachment: {
          id: "attachment-pdf",
          kind: "file",
          mediaType: "application/pdf",
          name: "specification.pdf",
          size: 8,
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
          id: "turn-file-attachment",
          items: [],
          startedAt: "2026-08-02T00:00:00.000Z",
          status: "running",
        },
      },
      status: 201,
    });
  });
  await page.goto("/p/code-agent/t/task-1");

  await chooseHostAttachment(page, "file", "specification.pdf");
  await expect(page.getByText("specification.pdf", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "任务输入" }).fill("总结附件");
  await page.getByRole("button", { exact: true, name: "提交" }).click();
  await expect.poll(() => turnBody).not.toBeUndefined();

  expect(importRequest?.url).toMatch(/\/attachments\/file\/host$/u);
  expect(importRequest?.body).toEqual({ path: "/Users/bryan/Attachments/specification.pdf" });
  expect(turnBody).toMatchObject({
    input: {
      attachments: [{ id: "attachment-pdf" }],
      text: "总结附件",
      type: "prompt",
    },
  });
});

test("opens file diffs and review from the timeline while keeping Inspector commit-only", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  const failedResources: string[] = [];
  const reviewListChange = {
    diff: `+export const reviewList = "${"wide-diff-content-".repeat(40)}";`,
    kind: "create" as const,
    path: "apps/web/src/review-list.tsx",
  };
  await page.route("**/v1/projects/code-agent/tasks/task-1", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        ...taskSnapshotResponse,
        snapshot: {
          ...taskSnapshot,
          turns: taskSnapshot.turns.map((turn) => ({
            ...turn,
            items: turn.items.map((item) =>
              item.type === "file_change"
                ? { ...item, changes: [...(item.changes ?? []), reviewListChange] }
                : item,
            ),
          })),
        },
      },
    });
  });
  await page.route("**/v1/projects/code-agent/git/status*", async (route) => {
    // 此用例使用两个不同目录的文件，覆盖紧凑树路径与四方向导航，避免改变全局 Fixture。
    const detailedStatus = {
      ...projectGitStatus,
      unstaged: [...projectGitStatus.unstaged, reviewListChange],
    };
    const includeDiff = new URL(route.request().url()).searchParams.get("includeDiff") === "true";
    await route.fulfill({
      contentType: "application/json",
      json: includeDiff
        ? detailedStatus
        : {
            ...detailedStatus,
            unstaged: detailedStatus.unstaged.map((change) => ({ ...change, diff: "" })),
          },
    });
  });
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

  const inspector = page.getByRole("complementary", { name: "运行环境" });
  const contextTab = inspector.getByRole("tab", { name: "上下文" });
  const projectTab = inspector.getByRole("tab", { name: "项目" });
  await expect(contextTab).toHaveAttribute("aria-selected", "true");

  await expect(page.getByRole("region", { name: "本次修改了 2 个文件" })).toHaveCSS(
    "margin-top",
    "16px",
  );
  await page.getByRole("button", { name: /已编辑 package\.json.*打开 Diff/ }).click();
  const dialog = page.getByRole("dialog", { name: "package.json" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".file-diff-renderer")).toContainText("pnpm run dev");
  await expect(dialog.locator(".file-diff-renderer")).toContainText("node ./dist/cli.js");
  await page.getByRole("button", { name: "关闭文件 Diff" }).click();
  await expect(dialog).not.toBeAttached();

  const changedFiles = page.getByRole("region", { name: "本次修改了 2 个文件" });
  const timelineReviewButton = changedFiles.getByRole("button", { name: "审核", exact: true });
  const gitChanges = inspector.getByRole("region", { name: "未提交变更" });
  const commitButton = gitChanges.getByRole("button", { name: "提交 2 个未提交变更" });
  const changeStats = gitChanges.getByLabel("变更统计");
  await expect(page.getByRole("button", { name: "审核 2 个未提交变更" })).toHaveCount(0);
  await expect(commitButton).toHaveText("提交");
  await expect(changeStats).toHaveText("2 个变更+2-1");
  await expect(gitChanges.getByRole("tree", { name: "变更文件导航" })).toHaveCount(0);
  await expect(gitChanges.getByText("package.json", { exact: true })).toHaveCount(0);
  await projectTab.click();
  await expect(inspector.getByRole("region", { name: "未提交变更" })).toHaveCount(0);
  await expect(
    inspector
      .getByRole("tree", { name: "项目文件" })
      .getByLabel("package.json，新增 1 行，删除 1 行"),
  ).toHaveCount(0);
  await contextTab.click();
  const [statsBox, commitBox] = await Promise.all([
    changeStats.boundingBox(),
    commitButton.boundingBox(),
  ]);
  expect(statsBox?.x).toBeLessThan(commitBox?.x ?? 0);
  await timelineReviewButton.click();
  const reviewDialog = page.getByRole("dialog");
  const reviewContent = reviewDialog.getByRole("region", { name: "审核文件内容" });
  const reviewNavigation = reviewDialog.getByRole("complementary", { name: "变更文件导航" });
  await expect(reviewNavigation).toBeVisible();
  await expect(reviewDialog.getByRole("button", { name: "收起变更文件导航" })).toBeVisible();
  const changedFileTree = reviewDialog.getByRole("tree", { name: "变更文件导航" });
  const packageFileTreeItem = changedFileTree.getByRole("treeitem", {
    name: "package.json，新增 1 行，删除 1 行",
  });
  const reviewFileTreeItem = changedFileTree.getByRole("treeitem", {
    name: "apps/web/src/review-list.tsx，新增 1 行，删除 0 行",
  });
  await expect(reviewDialog).toHaveAccessibleName("package.json");
  await expect(
    changedFileTree.getByRole("button", { name: "收起文件夹 apps/web/src", exact: true }),
  ).toBeVisible();
  await expect(packageFileTreeItem).toHaveAttribute("aria-selected", "true");
  await expect(reviewFileTreeItem).toBeVisible();
  const [reviewContentBox, reviewNavigationBox] = await Promise.all([
    reviewContent.boundingBox(),
    reviewNavigation.boundingBox(),
  ]);
  expect(reviewContentBox?.x).toBeLessThan(reviewNavigationBox?.x ?? 0);
  await reviewContent.evaluate((element) => {
    // 模拟长 Diff，确保左侧审核区产生真实滚动距离。
    const spacer = document.createElement("div");
    spacer.setAttribute("aria-hidden", "true");
    spacer.style.height = "2000px";
    element.append(spacer);
  });
  await reviewContent.evaluate((element) => {
    element.scrollTop = 320;
  });
  await expect
    .poll(() => reviewContent.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  await reviewFileTreeItem.click();
  await expect(reviewDialog).toHaveAccessibleName("review-list.tsx");
  await expect.poll(() => reviewContent.evaluate((element) => element.scrollTop)).toBe(0);
  await packageFileTreeItem.click();
  await expect(reviewDialog).toHaveAccessibleName("package.json");
  await page.keyboard.press("ArrowDown");
  await expect(reviewDialog).toHaveAccessibleName("review-list.tsx");
  const horizontalDiffScroller = reviewContent.locator("[data-code]");
  await expect
    .poll(() =>
      horizontalDiffScroller.evaluate((element) => element.scrollWidth > element.clientWidth),
    )
    .toBe(true);
  await horizontalDiffScroller.hover();
  await page.mouse.wheel(240, 0);
  await expect
    .poll(() => horizontalDiffScroller.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(0);
  await expect(reviewContent.locator(".file-diff-renderer")).toContainText(
    "export const reviewList",
  );
  await expect(reviewFileTreeItem).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowUp");
  await expect(reviewDialog).toHaveAccessibleName("package.json");
  await page.keyboard.press("Escape");
  await expect(reviewDialog).not.toBeAttached();
  expect({ consoleErrors, failedResources }).toEqual({ consoleErrors: [], failedResources: [] });
});

test("generates a message and commits only selected files", async ({ page }) => {
  const snapshot = "c".repeat(64);
  const additionalChanges = Array.from({ length: 16 }, (_, index) => ({
    diff: `+export const generated${String(index + 1)} = true;`,
    kind: "create",
    path: `apps/web/src/generated-${String(index + 1).padStart(2, "0")}.ts`,
  }));
  let messageRequest: Record<string, unknown> | undefined;
  let commitRequest: Record<string, unknown> | undefined;
  let commitIdempotencyKey: string | undefined;
  let historyRequestCount = 0;
  await page.route("**/v1/projects/code-agent/git/status*", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        ...projectGitStatus,
        snapshot,
        unstaged: [...projectGitStatus.unstaged, ...additionalChanges],
      },
    });
  });
  await page.route("**/v1/projects/code-agent/git/commit-message", async (route) => {
    messageRequest = parseRequestRecord(route.request().postData());
    await route.fulfill({
      contentType: "application/json",
      json: { message: "feat(git): 生成选中文件提交", snapshot },
    });
  });
  await page.route("**/v1/projects/code-agent/git/commits", async (route) => {
    commitRequest = parseRequestRecord(route.request().postData());
    commitIdempotencyKey = route.request().headers()["idempotency-key"];
    await route.fulfill({
      contentType: "application/json",
      json: {
        branch: "feat/review-targets",
        commitSha: "0123456789abcdef0123456789abcdef01234567",
        message: commitRequest["message"],
        pushError: "fatal: remote rejected",
        pushStatus: "failed",
      },
      status: 201,
    });
  });
  await page.route("**/v1/projects/code-agent/git/history*", async (route) => {
    historyRequestCount += 1;
    await route.fulfill({
      contentType: "application/json",
      json: {
        branch: "feat/review-targets",
        commits: [],
        nextCursor: null,
        repositories: [],
        repository: null,
        repositoryMode: "root",
      },
    });
  });

  await page.goto("/p/code-agent/t/task-1");
  await page.getByRole("button", { name: "提交 17 个未提交变更" }).click();
  const inspector = page.locator(".workbench-inspector");
  const changesTab = inspector.getByRole("tab", { name: "变更" });
  const panel = inspector.locator('[data-slot="commit-changes-panel"]');
  await expect(changesTab).toHaveAttribute("aria-selected", "true");
  await expect(panel).toBeVisible();
  await expect(page.locator('[data-slot="sheet-content"]')).toHaveCount(0);
  const unstagedTree = panel.getByRole("tree", { name: "未暂存" });
  const allFilesCheckbox = panel.getByRole("checkbox", { name: "未暂存", exact: true });
  const generateMessageButton = panel.getByRole("button", { name: "生成 message 信息" });
  await expect(allFilesCheckbox).toBeChecked();
  await expect(generateMessageButton).toHaveCSS("height", "28px");
  await expect(generateMessageButton).toHaveCSS("width", "28px");
  await expect(generateMessageButton).toHaveText("");
  const inputGroup = panel.locator('[data-slot="input-group"]');
  const generateIcon = generateMessageButton.locator("svg");
  const [inputGroupBox, generateButtonBox, generateIconBox] = await Promise.all([
    inputGroup.boundingBox(),
    generateMessageButton.boundingBox(),
    generateIcon.boundingBox(),
  ]);
  expect(
    Math.abs(
      (inputGroupBox?.x ?? 0) +
        (inputGroupBox?.width ?? 0) -
        (generateButtonBox?.x ?? 0) -
        (generateButtonBox?.width ?? 0),
    ),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(
      (generateButtonBox?.x ?? 0) +
        (generateButtonBox?.width ?? 0) / 2 -
        (generateIconBox?.x ?? 0) -
        (generateIconBox?.width ?? 0) / 2,
    ),
  ).toBeLessThanOrEqual(1);
  await generateMessageButton.hover();
  await expect(page.getByRole("tooltip")).toHaveText("生成 message 信息");
  const messageInput = panel.getByRole("textbox", { name: "提交信息" });
  await expect(messageInput).toHaveJSProperty("tagName", "TEXTAREA");
  const changesScroll = panel.locator('[data-slot="commit-changes-scroll"]');
  const panelMetrics = await panel.evaluate((element) => ({
    clientHeight: element.clientHeight,
    overflowY: getComputedStyle(element).overflowY,
    scrollHeight: element.scrollHeight,
  }));
  await changesScroll.evaluate((element) => {
    // 模拟超长变更列表，验证滚动被限制在面板文件区域。
    const spacer = document.createElement("div");
    spacer.setAttribute("aria-hidden", "true");
    spacer.style.height = "1200px";
    element.append(spacer);
  });
  const changesScrollMetrics = await changesScroll.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    return {
      clientHeight: element.clientHeight,
      overflowY: getComputedStyle(element).overflowY,
      scrollHeight: element.scrollHeight,
      scrollTop: element.scrollTop,
    };
  });
  expect(panelMetrics.scrollHeight).toBeLessThanOrEqual(panelMetrics.clientHeight);
  expect(panelMetrics.overflowY).toBe("hidden");
  expect(changesScrollMetrics.scrollHeight).toBeGreaterThan(changesScrollMetrics.clientHeight);
  expect(changesScrollMetrics.overflowY).toBe("auto");
  expect(changesScrollMetrics.scrollTop).toBeGreaterThan(0);
  expect(await panel.evaluate((element) => element.scrollTop)).toBe(0);
  await expect(panel).not.toContainText("feat/review-targets");
  await expect(panel.getByText("当前分支历史")).toHaveCount(0);
  expect(historyRequestCount).toBe(0);

  const packageFile = unstagedTree.getByRole("treeitem", { name: "package.json" });
  await packageFile.click();
  const fileDiffDialog = page.getByRole("dialog", { name: "package.json" });
  await expect(fileDiffDialog).toBeVisible();
  await expect(fileDiffDialog.locator(".file-diff-renderer")).toContainText("pnpm run dev");
  await fileDiffDialog.getByRole("button", { name: "关闭文件 Diff" }).click();
  await expect(fileDiffDialog).not.toBeAttached();
  await expect(allFilesCheckbox).toBeChecked();

  await allFilesCheckbox.uncheck();
  const packageCheckbox = unstagedTree.getByRole("checkbox", {
    name: "未暂存: package.json",
  });
  await expect(packageCheckbox).not.toBeChecked();
  await packageCheckbox.check();
  await generateMessageButton.click();
  await expect(messageInput).toHaveValue("feat(git): 生成选中文件提交");
  await expect(page.locator('[data-sonner-toast][data-type="success"]')).toHaveCount(0);
  await messageInput.fill("feat(git): 提交选中文件\n\n保留提交正文");
  const messageMetrics = await messageInput.evaluate((element) => ({
    clientHeight: element.clientHeight,
    overflowY: getComputedStyle(element).overflowY,
    scrollHeight: element.scrollHeight,
  }));
  expect(messageMetrics.scrollHeight).toBeGreaterThan(messageMetrics.clientHeight);
  expect(messageMetrics.overflowY).toBe("auto");
  await messageInput.fill("feat(git): 提交选中文件");
  await expect(panel.getByRole("button", { name: "提交", exact: true }).locator("svg")).toHaveCSS(
    "width",
    "16px",
  );
  await panel.getByRole("button", { name: "选择提交方式" }).click();
  await expect(page.getByRole("menuitem", { name: "提交并推送" }).locator("svg")).toHaveCSS(
    "width",
    "14px",
  );
  await page.getByRole("menuitem", { name: "提交并推送" }).click();

  await expect(panel.getByText("提交已完成，但推送失败")).toHaveCount(0);
  const pushErrorToast = page.locator('[data-sonner-toast][data-type="error"]');
  await expect(pushErrorToast).toHaveText("fatal: remote rejected");
  expect(messageRequest).toEqual({ expectedSnapshot: snapshot, paths: ["package.json"] });
  expect(commitRequest).toEqual({
    action: "commit_and_push",
    expectedSnapshot: snapshot,
    message: "feat(git): 提交选中文件",
    paths: ["package.json"],
  });
  expect(commitIdempotencyKey).toBeTruthy();
  expect(historyRequestCount).toBe(0);

  await page.setViewportSize({ width: 320, height: 568 });
  await page.getByRole("button", { name: "展开上下文面板" }).click();
  const mobilePanel = page.locator('[data-slot="commit-changes-panel"]');
  await expect(mobilePanel).toBeVisible();
  expect(await mobilePanel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
    true,
  );
});

test("defaults to the first child repository and keeps the changes panel mounted when switching", async ({
  page,
}) => {
  const aggregateSnapshot = "a".repeat(64);
  const backendSnapshot = "b".repeat(64);
  const frontendSnapshot = "c".repeat(64);
  const requestedRepositories: string[] = [];
  await page.route("**/v1/projects/code-agent/git/status*", async (route) => {
    const repository = new URL(route.request().url()).searchParams.get("repository");
    if (repository !== null) requestedRepositories.push(repository);
    const status =
      repository === "backend"
        ? {
            ...projectGitStatus,
            branch: "feat/backend",
            snapshot: backendSnapshot,
            staged: [],
            unstaged: [{ diff: "+backend", kind: "update", path: "src/server.ts" }],
          }
        : repository === "frontend"
          ? {
              ...projectGitStatus,
              branch: "feat/frontend",
              snapshot: frontendSnapshot,
              staged: [],
              unstaged: [{ diff: "+frontend", kind: "update", path: "src/app.tsx" }],
            }
          : {
              baseBranches: [],
              branch: null,
              branches: [],
              repositoryMode: "children",
              snapshot: aggregateSnapshot,
              staged: [],
              unstaged: [
                { diff: "+backend", kind: "update", path: "backend/src/server.ts" },
                { diff: "+frontend", kind: "update", path: "frontend/src/app.tsx" },
              ],
            };
    await route.fulfill({ contentType: "application/json", json: status });
  });
  await page.goto("/p/code-agent/t/task-1");
  await page.getByRole("button", { name: "提交 2 个未提交变更" }).click();
  const panel = page.locator('[data-slot="commit-changes-panel"]');
  const repositorySelect = panel.getByRole("combobox", { name: "Git 项目" });
  await expect(repositorySelect).toContainText("backend");
  await expect(panel.getByRole("treeitem", { name: "src/server.ts" })).toBeVisible();
  await panel.getByRole("textbox", { name: "提交信息" }).fill("fix(backend): 更新服务");
  await panel.evaluate((element) => {
    element.dataset["mountMarker"] = "stable";
  });

  await repositorySelect.click();
  await page.getByRole("option", { name: "frontend" }).click();

  await expect(repositorySelect).toContainText("frontend");
  await expect(panel).toHaveAttribute("data-mount-marker", "stable");
  await expect(panel.getByRole("treeitem", { name: "src/app.tsx" })).toBeVisible();
  await expect(panel.getByRole("textbox", { name: "提交信息" })).toHaveValue("");
  expect(requestedRepositories).toEqual(["backend", "frontend"]);
});

for (const scenario of [
  { actionName: "提交", pushStatus: "not_requested", toastMessage: "提交成功" },
  { actionName: "提交并推送", pushStatus: "pushed", toastMessage: "提交并推送成功" },
] as const) {
  test(`${scenario.actionName}成功后保留变更标签并显示 toast`, async ({ page }) => {
    await page.route("**/v1/projects/code-agent/git/status*", async (route) => {
      await route.fulfill({ contentType: "application/json", json: projectGitStatus });
    });
    await page.route("**/v1/projects/code-agent/git/commits", async (route) => {
      const request = parseRequestRecord(route.request().postData());
      await route.fulfill({
        contentType: "application/json",
        json: {
          branch: "feat/review-targets",
          commitSha: "0123456789abcdef0123456789abcdef01234567",
          message: request["message"],
          pushError: null,
          pushStatus: scenario.pushStatus,
        },
        status: 201,
      });
    });
    await page.goto("/p/code-agent/t/task-1");
    await page.getByRole("button", { name: /提交 \d+ 个未提交变更/u }).click();
    const inspector = page.locator(".workbench-inspector");
    const panel = inspector.locator('[data-slot="commit-changes-panel"]');
    await panel.getByRole("textbox", { name: "提交信息" }).fill("fix(git): 验证提交成功反馈");
    if (scenario.actionName === "提交并推送") {
      await panel.getByRole("button", { name: "选择提交方式" }).click();
      await page.getByRole("menuitem", { name: "提交并推送" }).click();
    } else {
      await panel.getByRole("button", { name: scenario.actionName, exact: true }).click();
    }

    await expect(inspector.getByRole("tab", { name: "变更" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(panel).toContainText("0123456");
    await expect(page.locator('[data-slot="sheet-content"]')).toHaveCount(0);
    const toaster = page.locator("[data-sonner-toaster]");
    await expect(toaster).toHaveAttribute("data-x-position", "center");
    await expect(toaster).toHaveAttribute("data-y-position", "top");
    const successToast = page.locator('[data-sonner-toast][data-type="success"]');
    await expect(successToast).toBeVisible();
    await expect(successToast).toHaveText(scenario.toastMessage);
    await expect(successToast.getByRole("button", { name: "关闭通知" })).toHaveCount(0);
    await expect(successToast).not.toBeAttached({ timeout: 7_000 });
  });
}

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
  await chooseHostAttachment(page, "image", "task-draft.png");
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
  const mountedTurns = conversation.locator('section[aria-label^="Turn "]');
  await expect.poll(() => mountedTurns.count()).toBeLessThan(longTurns.length);
  await expect(conversation.locator('section[aria-label="Turn 24"]')).toBeVisible();

  await conversation.evaluate((element) => {
    element.scrollTop = 120;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await page.getByRole("link", { name: /优化输入框交互/u }).click();
  await expect(page).toHaveURL(/\/p\/code-agent\/t\/input-design$/u);
  await expect(conversation).toContainText("工作台界面已按统一的 项目 Agent 组件 结构重新组织。");

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

test("scrolls direct user submissions to the bottom without scrolling queued messages", async ({
  page,
}) => {
  const longTurns = Array.from({ length: 24 }, (_, turnIndex) => ({
    completedAt: `2026-07-22T08:${String(turnIndex).padStart(2, "0")}:30.000Z`,
    error: null,
    id: `submission-scroll-turn-${String(turnIndex)}`,
    items: [
      {
        id: `submission-scroll-user-${String(turnIndex)}`,
        role: "user",
        text: `滚动测试问题 ${String(turnIndex + 1)}`,
        type: "message",
      },
      {
        id: `submission-scroll-assistant-${String(turnIndex)}`,
        role: "assistant",
        text: `滚动测试回复 ${String(turnIndex + 1)}：${"保持足够内容以验证中栏滚动行为。".repeat(8)}`,
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
  await page.route("**/v1/projects/code-agent/tasks/task-1/turns", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        taskId: "task-1",
        turn: {
          completedAt: null,
          error: null,
          id: "direct-submission-turn",
          items: [],
          startedAt: "2026-08-03T00:00:00.000Z",
          status: "running",
        },
      },
      status: 201,
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

  const prompt = page.getByRole("textbox", { name: "任务输入" });
  await prompt.fill("直接发送的新消息");
  await page.getByRole("button", { exact: true, name: "提交" }).click();
  await expect(page.getByRole("button", { exact: true, name: "停止" })).toBeVisible();
  await expect(page.getByText("直接发送的新消息", { exact: true })).toBeVisible();
  await expect(page.getByLabel("AI 回复正在运行")).toBeVisible();
  await expect(conversation.locator("[data-turn-processing-time]").last()).toBeVisible();
  await expect
    .poll(() =>
      conversation.evaluate(
        (element) => element.scrollHeight - element.scrollTop - element.clientHeight,
      ),
    )
    .toBeLessThanOrEqual(1);

  await conversation.evaluate((element) => {
    element.scrollTop = 120;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await prompt.fill("运行中排队的消息");
  await page.getByRole("button", { exact: true, name: "排队消息" }).click();
  await expect(page.getByRole("list", { name: "排队消息" })).toContainText("运行中排队的消息");
  await expect
    .poll(() =>
      conversation.evaluate(
        (element) => element.scrollHeight - element.scrollTop - element.clientHeight,
      ),
    )
    .toBeGreaterThan(100);
});

test("keeps a streaming code block within the conversation and copies its code", async ({
  context,
  page,
}) => {
  const streamedCode = `const streamed = "${"x".repeat(2_000)}";`;
  const historicalTurn = taskSnapshot.turns[0];
  if (historicalTurn === undefined) {
    throw new Error("Expected the task fixture to contain a turn");
  }

  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.route("**/v1/projects/code-agent/tasks/task-1", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        ...taskSnapshotResponse,
        snapshot: {
          ...taskSnapshot,
          status: "running",
          turns: [
            {
              ...historicalTurn,
              completedAt: null,
              items: [
                {
                  id: "message-streaming-code",
                  role: "assistant",
                  text: `\`\`\`typescript\n${streamedCode}\n\`\`\``,
                  type: "message",
                },
              ],
              status: "running",
            },
          ],
        },
      },
    });
  });
  await page.goto("/p/code-agent/t/task-1");

  const copyButton = page.locator('[data-streamdown="code-block-copy-button"]');
  await expect(copyButton).toBeVisible();
  await expect(copyButton).toBeEnabled();
  const conversation = page.getByRole("log", { name: "会话内容" });
  expect(await conversation.evaluate((element) => element.scrollWidth)).toBe(
    await conversation.evaluate((element) => element.clientWidth),
  );
  await copyButton.click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(`${streamedCode}\n`);
});
