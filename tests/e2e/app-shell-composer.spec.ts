import {
  architectureSourcePreview,
  expect,
  parseRequestRecord,
  projectGitStatus,
  taskSnapshot,
  taskSnapshotResponse,
  tasks,
  test,
} from "./fixtures/app-shell.js";

test.describe.configure({ mode: "serial" });

test("does not submit or select a command when Safari confirms an IME candidate", async ({
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
  await expect(page.getByRole("status").filter({ hasText: "正在压缩上下文" })).toBeVisible();
  await expect
    .poll(() => commandRequests.map((request) => request.path))
    .toContain("/v1/projects/code-agent/tasks/task-1/compact");

  await prompt.fill("/反馈");
  await prompt.press("Enter");
  await expect(page.getByRole("button", { name: "取消反馈" })).toBeVisible();
  await prompt.fill("Slash 命令操作顺畅");
  await page.getByRole("button", { exact: true, name: "提交" }).click();
  await expect(page.getByRole("status").filter({ hasText: "反馈已发送" })).toBeVisible();
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
      body["appId"] === "system-default" && body["path"] === "/workspace/CodeAgent/report.docx"
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

  await page.getByRole("button", { name: "report.docx" }).click();
  await systemOpenRequest;
  await expect(page.getByRole("dialog", { name: "report.docx" })).toHaveCount(0);
});

test("project file tree opens changed, source, image, and system files by shared rules", async ({
  page,
}) => {
  await page.goto("/p/code-agent/t/task-1");

  const inspector = page.getByRole("complementary", { name: "项目检查器" });
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
    return body["appId"] === "system-default" && body["path"] === "report.docx";
  });
  await fileTree.getByRole("treeitem", { name: "report.docx" }).click();
  await systemOpenRequest;
  await expect(page.getByRole("dialog", { name: "report.docx" })).toHaveCount(0);
});

test("project file tree context menu opens files and folders with a selected app", async ({
  page,
}) => {
  await page.goto("/p/code-agent/t/task-1");

  const inspector = page.getByRole("complementary", { name: "项目检查器" });
  const fileTree = inspector.getByRole("tree", { name: "项目文件" });
  const defaultOpenButton = page.getByRole("button", { name: "在 Zed 中打开" });
  await expect(defaultOpenButton).toBeVisible();

  const folderRequest = page.waitForRequest((request) => {
    if (!/^\/v1\/projects\/code-agent\/open$/u.test(new URL(request.url()).pathname)) {
      return false;
    }
    const body = parseRequestRecord(request.postData());
    return body["appId"] === "finder" && body["path"] === "docs";
  });
  const docsTreeItem = fileTree.getByRole("treeitem", { name: "docs" });
  await docsTreeItem.click({ button: "right" });
  const folderMenu = page.getByRole("menu", { name: "打开 docs 的方式" });
  await expect(folderMenu).toBeVisible();
  await expect(folderMenu.getByText("打开方式", { exact: true })).toBeVisible();
  await expect(folderMenu.getByText("docs", { exact: true })).toBeVisible();
  await expect(folderMenu.getByRole("menuitem", { name: "系统默认应用" })).toHaveCount(0);
  await expect(folderMenu.getByText("__SYSTEM_DEFAULT__", { exact: true })).toHaveCount(0);
  await expect(docsTreeItem).toHaveAttribute("aria-selected", "true");
  await folderMenu.getByRole("menuitem", { name: "Finder" }).click();
  await folderRequest;
  await expect(folderMenu).not.toBeAttached();
  await expect(defaultOpenButton).toBeVisible();

  const fileRequest = page.waitForRequest((request) => {
    if (!/^\/v1\/projects\/code-agent\/open$/u.test(new URL(request.url()).pathname)) {
      return false;
    }
    const body = parseRequestRecord(request.postData());
    return body["appId"] === "system-default" && body["path"] === "package.json";
  });
  const packageTreeItem = fileTree.getByRole("treeitem", { name: /package\.json/u });
  await packageTreeItem.click({ button: "right" });
  const fileMenu = page.getByRole("menu", { name: "打开 package.json 的方式" });
  await expect(packageTreeItem).toHaveAttribute("aria-selected", "true");
  await expect(packageTreeItem).toHaveClass(/bg-control/u);
  await fileMenu.getByRole("menuitem", { name: "系统默认应用" }).click();
  await fileRequest;
  await expect(fileMenu).not.toBeAttached();
});

test("keeps pasted images in attachments instead of the text editor", async ({ page }) => {
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

test("submits attachments, approval policy, model, and reasoning effort through the real client contract", async ({
  page,
}) => {
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
  await page.getByRole("button", { name: "添加图片或文件" }).click();
  await page.getByRole("menuitem", { name: "添加图片" }).click();
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
  const commandMenu = page.getByRole("listbox", { name: "输入命令" });
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
  await expect(page.getByText("screen.png", { exact: true })).toHaveCount(0);
  await expect(page.locator('[data-message-skill="documentation-writer"]')).toBeVisible();
  expect(uploadRequest?.url).toMatch(/\/attachments\/image$/u);
  expect(uploadRequest?.contentType).toMatch(/^multipart\/form-data; boundary=/u);
  expect(uploadRequest?.postData).toContain('name="attachment"; filename="screen.png"');
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

test("selects and submits an official file input as an attachment", async ({ page }) => {
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

  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "添加图片或文件" }).click();
  await page.getByRole("menuitem", { name: "添加文件" }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    buffer: Buffer.from("%PDF-1.4"),
    mimeType: "application/pdf",
    name: "specification.pdf",
  });
  await expect(page.getByText("specification.pdf", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "任务输入" }).fill("总结附件");
  await page.getByRole("button", { exact: true, name: "提交" }).click();
  await expect.poll(() => turnBody).not.toBeUndefined();

  expect(uploadRequest?.url).toMatch(/\/attachments\/file$/u);
  expect(uploadRequest?.contentType).toMatch(/^multipart\/form-data; boundary=/u);
  expect(uploadRequest?.postData).toContain('name="attachment"; filename="specification.pdf"');
  expect(turnBody).toMatchObject({
    input: {
      attachments: [{ id: "attachment-pdf" }],
      text: "总结附件",
      type: "prompt",
    },
  });
});

test("opens file diffs from the timeline and uncommitted review button", async ({ page }) => {
  const consoleErrors: string[] = [];
  const failedResources: string[] = [];
  await page.route("**/v1/projects/code-agent/git/status", async (route) => {
    // 此用例使用两个不同目录的文件，覆盖紧凑树路径与四方向导航，避免改变全局 Fixture。
    await route.fulfill({
      contentType: "application/json",
      json: {
        ...projectGitStatus,
        unstaged: [
          ...projectGitStatus.unstaged,
          {
            diff: "export const reviewList = true;",
            kind: "create",
            path: "apps/web/src/review-list.tsx",
          },
        ],
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

  await expect(page.getByRole("region", { name: "本次修改了 1 个文件" })).toHaveCSS(
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

  const reviewButton = page.getByRole("button", { name: "审核 2 个未提交变更" });
  const commitButton = page.getByRole("button", { name: "提交 2 个未提交变更" });
  const changeStats = page.getByLabel("变更统计");
  await expect(reviewButton).toHaveText("审核");
  await expect(commitButton).toHaveText("提交");
  await expect(changeStats).toHaveText("2 个变更+2-1");
  const [statsBox, reviewBox, commitBox, reviewBackground, commitBackground] = await Promise.all([
    changeStats.boundingBox(),
    reviewButton.boundingBox(),
    commitButton.boundingBox(),
    reviewButton.evaluate((element) => getComputedStyle(element).backgroundColor),
    commitButton.evaluate((element) => getComputedStyle(element).backgroundColor),
  ]);
  expect(statsBox?.x).toBeLessThan(reviewBox?.x ?? 0);
  expect(reviewBox?.y).toBe(commitBox?.y);
  expect(commitBackground).toBe(reviewBackground);
  await reviewButton.click();
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
  await page.keyboard.press("ArrowRight");
  await expect(reviewDialog).toHaveAccessibleName("review-list.tsx");
  await page.keyboard.press("ArrowLeft");
  await expect(reviewDialog).toHaveAccessibleName("package.json");
  await page.keyboard.press("ArrowDown");
  await expect(reviewDialog).toHaveAccessibleName("review-list.tsx");
  await expect(reviewContent.locator(".file-diff-renderer")).toContainText(
    "export const reviewList = true;",
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
  await page.route("**/v1/projects/code-agent/git/status", async (route) => {
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
        pushStatus: "failed",
      },
      status: 201,
    });
  });

  await page.goto("/p/code-agent/t/task-1");
  await page.getByRole("button", { name: "提交 17 个未提交变更" }).click();
  const dialog = page.getByRole("dialog", { name: "提交变更" });
  await expect(dialog).toBeVisible();
  const fileDisclosure = dialog.getByRole("button", {
    name: "选择文件，已选择 17/17 个文件",
  });
  await expect(fileDisclosure).toHaveAttribute("aria-expanded", "false");
  await expect(dialog.getByRole("checkbox")).toHaveCount(0);
  await fileDisclosure.click();
  await expect(fileDisclosure).toHaveAttribute("aria-expanded", "true");

  const fileList = dialog.locator('[data-commit-file-list=""]');
  const allFilesCheckbox = fileList.getByRole("checkbox", { name: "全选文件" });
  await expect(allFilesCheckbox).toBeChecked();
  const messageInput = dialog.getByRole("textbox", { name: "提交信息" });
  const messageBoxBeforeScroll = await messageInput.boundingBox();
  const scrollMetrics = await fileList.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    return {
      clientHeight: element.clientHeight,
      overflowY: getComputedStyle(element).overflowY,
      scrollHeight: element.scrollHeight,
      scrollTop: element.scrollTop,
    };
  });
  const messageBoxAfterScroll = await messageInput.boundingBox();
  expect(scrollMetrics.scrollHeight).toBeGreaterThan(scrollMetrics.clientHeight);
  expect(scrollMetrics.overflowY).toBe("auto");
  expect(scrollMetrics.scrollTop).toBeGreaterThan(0);
  expect(await dialog.evaluate((element) => element.scrollTop)).toBe(0);
  expect(messageBoxAfterScroll?.y).toBe(messageBoxBeforeScroll?.y);

  await allFilesCheckbox.uncheck();
  await expect(dialog.getByText("已选择 0 个文件")).toBeVisible();
  const packageCheckbox = fileList.getByRole("checkbox", { name: /package\.json/u });
  await expect(packageCheckbox).not.toBeChecked();
  await packageCheckbox.check();
  await expect(dialog.getByText("已选择 1 个文件")).toBeVisible();
  await dialog.getByRole("button", { name: "生成 message" }).click();
  await expect(messageInput).toHaveValue("feat(git): 生成选中文件提交");
  await messageInput.fill("feat(git): 提交选中文件");
  await dialog.getByRole("button", { name: "提交并推送" }).click();

  await expect(dialog.getByText("提交已完成，但推送失败")).toBeVisible();
  expect(messageRequest).toEqual({ expectedSnapshot: snapshot, paths: ["package.json"] });
  expect(commitRequest).toEqual({
    action: "commit_and_push",
    expectedSnapshot: snapshot,
    message: "feat(git): 提交选中文件",
    paths: ["package.json"],
  });
  expect(commitIdempotencyKey).toBeTruthy();
});

for (const scenario of [
  { actionName: "提交", pushStatus: "not_requested", toastMessage: "提交成功" },
  { actionName: "提交并推送", pushStatus: "pushed", toastMessage: "提交并推送成功" },
] as const) {
  test(`${scenario.actionName}成功后关闭弹窗并显示 toast`, async ({ page }) => {
    await page.route("**/v1/projects/code-agent/git/status", async (route) => {
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
          pushStatus: scenario.pushStatus,
        },
        status: 201,
      });
    });

    await page.goto("/p/code-agent/t/task-1");
    await page.getByRole("button", { name: /提交 \d+ 个未提交变更/u }).click();
    const dialog = page.getByRole("dialog", { name: "提交变更" });
    await dialog.getByRole("textbox", { name: "提交信息" }).fill("fix(git): 验证提交成功反馈");
    await dialog.getByRole("button", { name: scenario.actionName, exact: true }).click();

    await expect(dialog).not.toBeAttached();
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
  await page.getByRole("button", { name: "添加图片或文件" }).click();
  await page.getByRole("menuitem", { name: "添加图片" }).click();
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
  const mountedTurns = conversation.locator('section[aria-label^="Turn "]');
  await expect.poll(() => mountedTurns.count()).toBeLessThan(longTurns.length);
  await expect(conversation.locator('section[aria-label="Turn 24"]')).toBeVisible();

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

test("copies the current code from a streaming assistant reply", async ({ context, page }) => {
  const streamedCode = "const streamed = true;";
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
  await copyButton.click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(`${streamedCode}\n`);
});
