import {
  chooseHostAttachment,
  expect,
  taskSnapshot,
  taskSnapshotResponse,
  tasks,
  test,
} from "./fixtures/app-shell.js";

test.describe.configure({ mode: "serial" });

test("shows a task error when the initial snapshot request fails", async ({ page }) => {
  await page.route("**/v1/projects/code-agent/tasks/task-1", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: { code: "SNAPSHOT_FAILED", message: "Snapshot failed" },
      status: 500,
    });
  });

  await page.goto("/p/code-agent/t/task-1");

  await expect(page.getByText("Snapshot failed", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("log", { name: "会话内容" }).getByText("Snapshot failed"),
  ).toHaveCount(0);
});

test("waits for an old task snapshot before loading task-scoped resources", async ({ page }) => {
  let releaseSnapshot: (() => void) | undefined;
  const snapshotBlocked = new Promise<void>((resolve) => {
    releaseSnapshot = resolve;
  });
  let signalSnapshotRequestStarted: (() => void) | undefined;
  const snapshotRequestStarted = new Promise<void>((resolve) => {
    signalSnapshotRequestStarted = resolve;
  });
  let mcpRequestCount = 0;
  let terminalRequestCount = 0;

  await page.route("**/v1/projects/code-agent/tasks/task-1", async (route) => {
    signalSnapshotRequestStarted?.();
    await snapshotBlocked;
    await route.fulfill({ contentType: "application/json", json: taskSnapshotResponse });
  });
  await page.route("**/v1/projects/code-agent/tasks/task-1/mcp-servers", async (route) => {
    mcpRequestCount += 1;
    await route.fulfill({ contentType: "application/json", json: { data: [] } });
  });
  await page.route("**/v1/projects/code-agent/tasks/task-1/background-terminals", async (route) => {
    terminalRequestCount += 1;
    await route.fulfill({ contentType: "application/json", json: { data: [] } });
  });

  await page.goto("/p/code-agent/t/task-1");
  await snapshotRequestStarted;
  const taskResourceRequestedBeforeSnapshot =
    mcpRequestCount + terminalRequestCount > 0
      ? true
      : await page
          .waitForRequest(
            (request) =>
              /\/(?:mcp-servers|background-terminals)$/u.test(new URL(request.url()).pathname),
            { timeout: 500 },
          )
          .then(
            () => true,
            () => false,
          );
  expect(taskResourceRequestedBeforeSnapshot).toBe(false);

  releaseSnapshot?.();
  await expect.poll(() => mcpRequestCount).toBe(1);
  await expect.poll(() => terminalRequestCount).toBe(1);
});

test("keeps retrying Snapshot recovery and applies later realtime events", async ({ page }) => {
  let snapshotRequestCount = 0;
  await page.route("**/v1/projects/code-agent/tasks/task-1", async (route) => {
    snapshotRequestCount += 1;
    if (snapshotRequestCount === 1) {
      await route.fulfill({ contentType: "application/json", json: taskSnapshotResponse });
      return;
    }
    if (snapshotRequestCount <= 3) {
      await route.fulfill({
        contentType: "application/json",
        json: { code: "SNAPSHOT_FAILED", message: "Snapshot failed" },
        status: 503,
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      json: {
        ...taskSnapshotResponse,
        checkpoint: { sequence: 8, sessionId: "e2e-session" },
      },
    });
  });
  await page.addInitScript(() => {
    class ResyncWebSocket extends EventTarget {
      static connectionCount = 0;
      public readonly bufferedAmount = 0;
      public readyState = 0;

      public constructor() {
        super();
        ResyncWebSocket.connectionCount += 1;
        const connectionCount = ResyncWebSocket.connectionCount;
        queueMicrotask(() => {
          if (this.readyState === 3) {
            return;
          }
          this.readyState = 1;
          this.dispatchEvent(new Event("open"));
          const messages =
            connectionCount === 1
              ? [
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
                ]
              : [
                  {
                    latestSequence: 8,
                    sessionId: "e2e-session",
                    type: "connection.ready",
                    version: 2,
                  },
                  {
                    itemId: "message-recovered",
                    payload: {
                      item: {
                        id: "message-recovered",
                        role: "assistant",
                        text: "恢复失败后收到的实时消息",
                        type: "message",
                      },
                    },
                    provider: "codex",
                    sequence: 9,
                    sessionId: "e2e-session",
                    taskId: "task-1",
                    timestamp: "2026-07-23T00:00:00.000Z",
                    turnId: "turn-1",
                    type: "item.completed",
                    version: 2,
                  },
                ];
          for (const message of messages) {
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

  await expect.poll(() => snapshotRequestCount).toBeGreaterThanOrEqual(3);
  await expect(page.getByText("工作台界面已按统一的 项目 Agent 组件 结构重新组织。")).toBeVisible();
  await expect(page.getByText("实时连接恢复中")).toBeVisible();

  await expect.poll(() => snapshotRequestCount).toBeGreaterThanOrEqual(4);
  await expect(page.getByText("恢复失败后收到的实时消息")).toBeVisible();
  await expect(page.getByText("实时连接恢复中")).toHaveCount(0);
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

test("clears transient realtime errors after the WebSocket reconnects @cross-browser", async ({
  page,
}) => {
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
  await expect(page.getByText("工作台界面已按统一的 项目 Agent 组件 结构重新组织。")).toBeVisible();
  await expect.poll(() => page.evaluate(() => WebSocket.name)).toBe("ReconnectingWebSocket");
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem("__testWebSocketFailed")))
    .toBe("true");
  await expect.poll(() => snapshotRequestCount).toBeGreaterThanOrEqual(2);
  await page.waitForTimeout(50);

  // Snapshot 刷新失败属于非阻塞恢复错误，已渲染 Timeline 不能被替换。
  await expect(page.getByRole("alert", { name: "会话内容" })).toHaveCount(0);
  await expect(page.getByText("工作台界面已按统一的 项目 Agent 组件 结构重新组织。")).toBeVisible();
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

test("opens a completed file change diff while the turn is still running", async ({ page }) => {
  const liveChange = {
    diff: "@@ -1 +1 @@\n-export const live = false;\n+export const live = true;",
    kind: "update" as const,
    path: "src/live.ts",
  };
  await page.route("**/v1/projects/code-agent/tasks/task-1", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        checkpoint: { sequence: 0, sessionId: "e2e-session" },
        snapshot: {
          ...taskSnapshot,
          status: "running",
          turns: [
            {
              completedAt: null,
              error: null,
              id: "turn-live-file",
              items: [
                {
                  id: "message-live-file",
                  role: "user",
                  text: "更新实时文件",
                  type: "message",
                },
              ],
              startedAt: "2026-08-09T00:00:00.000Z",
              status: "running",
            },
          ],
        },
      },
    });
  });
  await page.addInitScript(() => {
    type FileChangeEventWindow = Window & {
      __emitFileChangeEvent?: (event: unknown) => void;
    };

    class FileChangeWebSocket extends EventTarget {
      public readonly bufferedAmount = 0;
      public readyState = 0;

      public constructor() {
        super();
        (window as FileChangeEventWindow).__emitFileChangeEvent = (event) => {
          this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(event) }));
        };
        queueMicrotask(() => {
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
        this.readyState = 3;
        this.dispatchEvent(new CloseEvent("close", { code, reason }));
      }

      public send(): void {
        return undefined;
      }
    }

    Object.defineProperty(window, "WebSocket", {
      configurable: true,
      value: FileChangeWebSocket,
    });
  });

  await page.goto("/p/code-agent/t/task-1");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          typeof (window as Window & { __emitFileChangeEvent?: (event: unknown) => void })
            .__emitFileChangeEvent,
      ),
    )
    .toBe("function");
  await page.evaluate((change) => {
    const emit = (window as Window & { __emitFileChangeEvent?: (event: unknown) => void })
      .__emitFileChangeEvent;
    if (emit === undefined) throw new Error("File change event emitter is unavailable");
    emit({
      itemId: "file-live",
      payload: {
        item: {
          changes: [change],
          id: "file-live",
          status: "completed",
          type: "file_change",
        },
      },
      provider: "codex",
      sequence: 1,
      sessionId: "e2e-session",
      taskId: "task-1",
      timestamp: "2026-08-09T00:00:01.000Z",
      turnId: "turn-live-file",
      type: "item.completed",
      version: 2,
    });
  }, liveChange);

  const fileButton = page.getByRole("button", {
    name: "已编辑 live.ts，新增 1 行，删除 1 行，打开 Diff",
  });
  await expect(fileButton).toBeVisible();
  await fileButton.click();

  const dialog = page.getByRole("dialog", { name: "live.ts" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".file-diff-renderer")).toContainText("export const live = true;");
});

test("updates a running background task title and clears attention after entering", async ({
  page,
}) => {
  let backgroundSnapshotReadCount = 0;
  await page.route("**/v1/projects/code-agent/tasks?*", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    const projectTasks = tasks
      .filter((task) => task.projectId === "code-agent")
      .slice(0, 5)
      .map((task) => (task.id === "markdown" ? { ...task, title: "新聊天" } : task));
    await route.fulfill({
      contentType: "application/json",
      json: { data: projectTasks, nextCursor: "5" },
    });
  });
  await page.route("**/v1/projects/code-agent/tasks/markdown", async (route) => {
    backgroundSnapshotReadCount += 1;
    const hasFormalTitle = backgroundSnapshotReadCount > 1;
    await route.fulfill({
      contentType: "application/json",
      json: {
        checkpoint: { sequence: 2, sessionId: "e2e-session" },
        snapshot: {
          ...taskSnapshot,
          id: "markdown",
          pinned: false,
          status: "running",
          title: hasFormalTitle ? "后台任务正式标题" : "新聊天",
          turns: [
            {
              completedAt: null,
              error: null,
              id: "turn-markdown",
              items: [
                { id: "markdown-user", role: "user", text: "更新后台任务标题", type: "message" },
                ...(hasFormalTitle
                  ? [
                      {
                        id: "markdown-assistant",
                        role: "assistant" as const,
                        text: "正在回复",
                        type: "message" as const,
                      },
                    ]
                  : []),
              ],
              startedAt: "2026-07-29T00:00:00.000Z",
              status: "running",
            },
          ],
          updatedAt: "2026-07-29T00:00:01.000Z",
        },
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
  const sidebar = page.getByRole("complementary", { name: "项目侧栏" });
  const projectTree = sidebar.getByTestId("project-tree-scroll");
  const backgroundTask = projectTree.getByRole("link", { name: /优化输入框交互/ });
  const completedTask = projectTree.locator('a[href="/p/code-agent/t/markdown"]');
  const failedTask = projectTree.getByRole("link", { name: /完善 Runtime 状态/ });
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

  const approvalStatus = backgroundTask.getByRole("status", { name: "任务等待审批" });
  await expect(approvalStatus).toBeVisible();
  await expect(approvalStatus).toHaveCSS("color", "rgb(178, 89, 0)");
  await expect(approvalStatus.locator(".sidebar-task-status-dot")).toHaveCSS(
    "animation-duration",
    "2.4s",
  );
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
  const runningStatus = completedTask.getByRole("status", { name: "任务运行中" });
  await expect(runningStatus).toBeVisible();
  await expect(runningStatus).toHaveCSS("color", "rgb(0, 106, 255)");
  await expect(runningStatus.locator(".sidebar-task-status-dot")).toHaveCSS(
    "animation-duration",
    "2.4s",
  );
  await emitTaskEvent({
    itemId: "markdown-assistant",
    payload: { delta: "正在回复" },
    provider: "codex",
    sequence: 2,
    sessionId: "e2e-session",
    taskId: "markdown",
    timestamp: "2026-07-29T00:00:01.000Z",
    turnId: completedTurn.id,
    type: "message.delta",
    version: 2,
  });

  // 不进入后台 Task，也必须在 AI 仍回复时读取 Snapshot 并替换“新聊天”。
  await expect.poll(() => backgroundSnapshotReadCount).toBe(1);
  await expect(completedTask).toContainText("更新后台任务标题");
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
    sequence: 3,
    sessionId: "e2e-session",
    taskId: "markdown",
    timestamp: "2026-07-29T00:00:02.000Z",
    turnId: completedTurn.id,
    type: "turn.completed",
    version: 2,
  });

  const completedStatus = completedTask.getByRole("status", { name: "AI 回复已完成" });
  await expect(completedStatus).toBeVisible();
  await expect(completedStatus).toHaveCSS("color", "rgb(40, 169, 72)");
  await expect(completedStatus.locator(".sidebar-task-status-dot")).toHaveCSS(
    "animation-name",
    "none",
  );
  await expect(completedTask).toContainText("后台任务正式标题");

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
  const failedStatus = failedTask.getByRole("status", { name: "AI 回复未完成" });
  await expect(failedStatus).toBeVisible();
  await expect(failedStatus).toHaveCSS("color", "rgb(235, 0, 29)");
  await expect(failedStatus.locator(".sidebar-task-status-dot")).toHaveCSS(
    "animation-name",
    "none",
  );

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
  await expect(allow).toBeFocused();
  await page.keyboard.press("Enter");
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

test("streams Fake App Server notifications into the Timeline @smoke", async ({ page }) => {
  await page.unroute("**/v1/**");
  await page.goto("/p/code-agent/t/task-realtime");

  await expect(page.getByText("Realtime connected", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("button", { name: "上下文已使用 13%" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText("启动子代理 · 1 个子代理已完成", { exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "项目" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "上下文" }).click();
  await expect(
    page.getByRole("region", { name: "MCP" }).getByText("context7", { exact: true }),
  ).toBeVisible();
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

test("shows MCP startup diagnostics and manually retries the current task", async ({ page }) => {
  let retries = 0;
  await page.route("**/v1/projects/code-agent/tasks/task-1/mcp-servers", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        data: [
          {
            authStatus: null,
            description: null,
            error: "MCP startup timed out after 10s\nProcess exited with code 1",
            failureReason: "reauthenticationRequired",
            name: "docs",
            status: "failed",
            title: null,
            toolCount: 0,
            version: null,
          },
          {
            authStatus: "unsupported",
            description: "Provider-only MCP description",
            error: null,
            failureReason: null,
            name: "context7",
            status: "ready",
            title: "Context7",
            toolCount: 2,
            version: "4.0.0",
          },
        ],
      },
    });
  });
  await page.route("**/v1/projects/code-agent/tasks/task-1/mcp-servers/retry", async (route) => {
    retries += 1;
    await route.fulfill({
      contentType: "application/json",
      json: {
        data: [
          {
            authStatus: null,
            description: null,
            error: null,
            failureReason: null,
            name: "docs",
            status: "starting",
            title: null,
            toolCount: 0,
            version: null,
          },
        ],
      },
    });
  });

  await page.goto("/p/code-agent/t/task-1");
  const startupError = "MCP startup timed out after 10s\nProcess exited with code 1";
  await expect(page.getByRole("listitem").filter({ hasText: startupError })).toBeVisible();
  await page.getByRole("tab", { name: "上下文" }).click();
  const mcp = page.getByRole("region", { name: "MCP" });
  const reloadIcon = mcp.getByRole("button", { name: "重新加载 MCP" }).locator("svg");
  await expect
    .poll(() => reloadIcon.evaluate((icon) => icon.getBoundingClientRect().width))
    .toBeLessThanOrEqual(16);
  await expect(mcp.getByText("启动失败", { exact: true })).toBeVisible();
  await expect(mcp.getByText("已就绪", { exact: false })).toBeVisible();
  await expect(mcp.getByText("Provider-only MCP description", { exact: true })).toHaveCount(0);
  await expect(mcp.getByText("需要重新认证", { exact: true })).toHaveCount(0);
  await expect(mcp.getByRole("button", { name: "查看错误日志" })).toHaveCount(0);
  await expect(mcp.getByText(startupError, { exact: true })).toHaveCount(0);
  await mcp.getByRole("button", { name: "重新加载 MCP" }).click();
  await expect.poll(() => retries).toBe(1);
  await expect(mcp.getByText("正在启动", { exact: true })).toBeVisible();
});

test("shows original Codex MCP request errors once", async ({ page }) => {
  await page.route("**/v1/projects/code-agent/tasks/task-1/mcp-servers", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        code: "PROVIDER_ERROR",
        message: "mcpServerStatus/list failed: MCP server `docs` executable was not found",
        retryable: true,
      },
      status: 502,
    });
  });
  await page.route("**/v1/projects/code-agent/tasks/task-1/mcp-servers/retry", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        code: "PROVIDER_ERROR",
        message: "config/mcpServer/reload failed: transport channel closed",
        retryable: true,
      },
      status: 502,
    });
  });

  await page.goto("/p/code-agent/t/task-1");
  await page.getByRole("tab", { name: "上下文" }).click();
  const mcp = page.getByRole("region", { name: "MCP" });
  await expect(
    page.getByText("mcpServerStatus/list failed: MCP server `docs` executable was not found"),
  ).toBeVisible();
  await expect(
    mcp.getByText("mcpServerStatus/list failed: MCP server `docs` executable was not found"),
  ).toHaveCount(0);
  await expect(mcp.getByText("PROVIDER_ERROR · HTTP 502")).toHaveCount(0);
  await expect(mcp.getByRole("button", { name: "查看错误日志" })).toHaveCount(0);

  await mcp.getByRole("button", { name: "重新加载 MCP" }).click();
  await expect(
    page.getByText("config/mcpServer/reload failed: transport channel closed"),
  ).toBeVisible();
  await expect(mcp.getByText("config/mcpServer/reload failed", { exact: false })).toHaveCount(0);
  await expect(mcp.getByText("重新加载 MCP 失败", { exact: true })).toHaveCount(0);
});

test("queues follow-up messages and can steer or cancel them during an active turn", async ({
  page,
}) => {
  let followUpBehavior: "queue" | "steer" = "queue";
  await page.unroute("**/v1/**");
  await page.route("**/v1/settings", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { settings: Record<string, unknown> };
    await route.fulfill({
      response,
      json: { settings: { ...body.settings, followUpBehavior } },
    });
  });
  await page.goto("/p/code-agent");
  const input = page.getByRole("textbox", { name: "任务输入" });
  await input.fill("等待中断");
  await page.getByRole("button", { exact: true, name: "提交" }).click();
  await expect(page).toHaveURL(/\/p\/code-agent\/t\/task-action-\d+$/u);
  await expect(page.getByRole("button", { name: "停止" })).toBeVisible();
  await expect(input).toHaveAttribute("data-placeholder", "输入后续要求");

  let steerPayload: unknown;
  await page.route("**/v1/projects/code-agent/tasks/*/turns/*/steer", async (route) => {
    const request = route.request();
    const pathParts = new URL(request.url()).pathname.split("/");
    const payload = request.postDataJSON() as { taskId: string };
    const turnId = pathParts[7] ?? "";
    steerPayload = payload;
    await route.fulfill({
      contentType: "application/json",
      json: { status: "accepted", taskId: payload.taskId, turnId },
      status: 202,
    });
  });
  const queueMessage = page.getByRole("button", { name: "排队消息" });
  await input.fill("先补充失败测试");
  await expect(queueMessage).toBeVisible();
  await queueMessage.click();

  await expect(page.getByText("先补充失败测试", { exact: true })).toBeVisible();
  const queuedList = page.getByRole("list", { name: "已排队消息" });
  expect(await queuedList.evaluate((element) => element.closest("form") === null)).toBe(true);
  await page.getByRole("button", { name: "编辑排队消息：先补充失败测试" }).click();
  await expect(input).toHaveText("先补充失败测试");
  await expect(queuedList).toHaveCount(0);
  await input.fill("先补充失败测试并覆盖确认状态");
  await queueMessage.click();
  const steerQueued = page.getByRole("button", {
    name: "立即引导：先补充失败测试并覆盖确认状态",
  });
  await expect(steerQueued).toBeEnabled();
  await steerQueued.hover();
  await expect(page.getByRole("tooltip")).toHaveText("立即作为引导发送");
  await steerQueued.click();
  await expect
    .poll(() => steerPayload)
    .toEqual({
      input: {
        attachments: [],
        skills: [],
        text: "先补充失败测试并覆盖确认状态",
        type: "prompt",
      },
      taskId: expect.stringMatching(/^task-action-\d+$/u),
    });
  await expect(page.getByText("先补充失败测试并覆盖确认状态", { exact: true })).toBeVisible();
  await expect(page.getByText("等待发送", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "编辑排队消息：先补充失败测试并覆盖确认状态" }),
  ).toHaveCount(0);

  await page.reload();
  await expect(page.getByText("先补充失败测试并覆盖确认状态", { exact: true })).toBeVisible();
  await expect(page.getByText("等待发送", { exact: true })).toBeVisible();

  await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("code-agent.composer-queue.")) localStorage.removeItem(key);
    }
  });
  followUpBehavior = "steer";
  await page.reload();
  await input.fill("直接引导等待确认");
  await page.getByRole("button", { name: "发送引导" }).click();
  await expect(input).toHaveText("直接引导等待确认");
  await expect(input).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByText("等待发送", { exact: true })).toBeVisible();

  await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("code-agent.composer-queue.")) localStorage.removeItem(key);
    }
  });
  followUpBehavior = "queue";
  await page.reload();

  await input.fill("无需继续的消息");
  await queueMessage.click();
  const cancelQueued = page.getByRole("button", { name: "取消排队：无需继续的消息" });
  await cancelQueued.hover();
  await expect(page.getByRole("tooltip")).toHaveText("取消排队");
  await cancelQueued.click();
  await expect(page.getByText("无需继续的消息", { exact: true })).toHaveCount(0);

  await input.fill("自动续发消息");
  await queueMessage.click();
  await page.getByRole("button", { name: "停止" }).click();
  const nextTurn = page.getByLabel("Turn 2");
  await expect(nextTurn.getByText("自动续发消息", { exact: true })).toBeVisible();
  await expect(nextTurn).toHaveAttribute("data-status", "completed");
});

test("submits a prompt and streams the completed reply @cross-browser", async ({ page }) => {
  await page.unroute("**/v1/**");
  await page.goto("/p/code-agent");

  await page.getByRole("textbox", { name: "任务输入" }).fill("完成流式回复");
  await page.getByRole("button", { exact: true, name: "提交" }).click();

  await expect(page).toHaveURL(/\/p\/code-agent\/t\/task-action-\d+$/);
  await expect(page.getByText("完成流式回复", { exact: true })).toHaveCount(1);
  await expect(page.getByText("流式回复完成", { exact: true })).toHaveCount(1);
  await expect(page.getByLabel("Turn 1")).toHaveAttribute("data-status", "completed");
  await expect(page.getByRole("button", { exact: true, name: "提交" })).toBeVisible();
});

test("shows the latest raw Codex operation throughout a running turn", async ({ page }) => {
  await page.unroute("**/v1/**");
  await page.goto("/p/code-agent");

  await page.getByRole("textbox", { name: "任务输入" }).fill("检查运行状态");
  await page.getByRole("button", { exact: true, name: "提交" }).click();

  await expect(page.getByText("正在运行 rg --files", { exact: true })).toBeVisible();
  const runningShimmer = page.locator('[data-agent-shimmer][aria-label^="AI 回复正在运行"]');
  const initialShimmer = await runningShimmer.elementHandle();
  if (initialShimmer === null) {
    throw new Error("未找到运行态 Shimmer");
  }
  // 节点可见后 CSS 动画仍可能尚未启动，先等待时间轴完成初始化。
  await expect
    .poll(() =>
      runningShimmer.evaluate((node) => {
        const animation = node.getAnimations()[0];
        return animation?.playState === "running" && animation.startTime !== null;
      }),
    )
    .toBe(true);
  const initialAnimation = await runningShimmer.evaluate((node) => ({
    currentTime: Number(node.getAnimations()[0]?.currentTime ?? 0),
    spread: node.style.getPropertyValue("--ui-shimmer-spread"),
    startTime: Number(node.getAnimations()[0]?.startTime ?? 0),
  }));

  await expect(page.getByText("正在运行 context7/query-docs", { exact: true })).toBeVisible();
  const retainedShimmer = await runningShimmer.evaluate(
    (node, initialNode) => node === initialNode,
    initialShimmer,
  );
  const updatedAnimation = await runningShimmer.evaluate((node) => ({
    currentTime: Number(node.getAnimations()[0]?.currentTime ?? 0),
    spread: node.style.getPropertyValue("--ui-shimmer-spread"),
    startTime: Number(node.getAnimations()[0]?.startTime ?? 0),
  }));
  expect(retainedShimmer).toBe(true);
  expect(updatedAnimation.spread).toBe(initialAnimation.spread);
  expect(updatedAnimation.startTime).toBe(initialAnimation.startTime);
  expect(updatedAnimation.currentTime).toBeGreaterThan(initialAnimation.currentTime);
  await expect(page.getByText("流式回复完成", { exact: true })).toBeVisible();
});

test("shows wrapped command details and input in a fixed-width tooltip", async ({ page }) => {
  const command =
    "pnpm exec vitest run apps/web/src/features/workbench/components/task-timeline.test.tsx --testNamePattern tool-command-title-tooltip";
  await page.route("**/v1/projects/code-agent/tasks/task-1", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        ...taskSnapshotResponse,
        snapshot: {
          ...taskSnapshot,
          turns: taskSnapshot.turns.map((turn) => ({
            ...turn,
            items: [
              ...turn.items,
              {
                command,
                cwd: "/workspace/CodeAgent",
                id: "command-with-truncated-title",
                output: "268 passed",
                outputTruncated: false,
                status: "completed",
                type: "command",
              },
            ],
          })),
        },
      },
    });
  });
  await page.setViewportSize({ height: 720, width: 640 });
  await page.goto("/p/code-agent/t/task-1");

  // 等待异步 Markdown 升级完成，避免前序内容重排在 Tooltip 延迟期间取消 hover。
  await expect(page.getByRole("link", { name: "OpenAI" })).toBeVisible();
  const commandSummary = page.locator("summary").filter({ hasText: command });
  const commandDetails = commandSummary.locator("..");
  const commandTitle = commandSummary.getByText(command, { exact: true });
  await expect(commandTitle).toBeVisible();
  expect(await commandTitle.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(
    true,
  );

  await commandSummary.click();
  await expect(commandDetails.getByText("参数", { exact: true })).toBeVisible();
  await expect(commandDetails.locator("pre").first()).toContainText(command);
  await expect(commandDetails.locator("pre").first()).toContainText("/workspace/CodeAgent");
  await expect(commandDetails.getByText("输出", { exact: true })).toBeVisible();
  await expect(commandDetails.locator('[data-terminal=""]')).toContainText("268 passed");
  await commandSummary.click();

  await commandTitle.hover();
  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toHaveText(command);
  await expect(tooltip).toHaveCSS("width", "256px");
  expect(
    await tooltip.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    })),
  ).toMatchObject({ clientWidth: 256, scrollWidth: 256 });
  expect(await tooltip.evaluate((element) => element.closest("details") === null)).toBe(true);

  await page.mouse.move(0, 0);
  await expect(tooltip).toHaveCount(0);
  await page.getByRole("textbox", { name: "任务输入" }).focus();
  await commandSummary.focus();
  await expect(page.getByRole("tooltip")).toHaveText(command);
});

test("keeps long automatic approval details within the conversation", async ({ page }) => {
  const historicalTurn = taskSnapshot.turns[0];
  if (historicalTurn === undefined) {
    throw new Error("Expected the task fixture to contain a turn");
  }
  const longDetail = encodeURIComponent(
    JSON.stringify({
      "effort-estimate.md": "有效输出路径与需求分析".repeat(300),
    }),
  );
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
                  action: { detail: longDetail, type: "command" },
                  id: "approval-review-long-detail",
                  rationale: "用户明确要求执行该命令",
                  riskLevel: "low",
                  status: "in_progress",
                  targetItemId: "command-long-detail",
                  type: "approval_review",
                  userAuthorization: "high",
                },
              ],
              status: "running",
            },
          ],
        },
      },
    });
  });
  await page.setViewportSize({ height: 720, width: 1_280 });
  await page.goto("/p/code-agent/t/task-1");

  const approvalReview = page.locator("[data-ai-task]").filter({ hasText: "自动审批：审批中" });
  await approvalReview.getByText("自动审批：审批中", { exact: true }).click();
  const conversation = page.getByRole("log", { name: "会话内容" });
  await expect(approvalReview).toContainText(longDetail);
  expect(await conversation.evaluate((element) => element.scrollWidth)).toBe(
    await conversation.evaluate((element) => element.clientWidth),
  );
});

test("does not reserve virtual rows for non-rendering stream items", async ({ page }) => {
  const historicalTurn = taskSnapshot.turns[0];
  if (historicalTurn === undefined) throw new Error("Expected the task fixture to contain a turn");
  const items = Array.from({ length: 41 }, (_, index) => [
    {
      id: `visible-tool-${String(index)}`,
      name: `visible_tool_${String(index)}`,
      status: "completed" as const,
      type: "tool" as const,
    },
    {
      content: "internal reasoning",
      id: `hidden-reasoning-${String(index)}`,
      summary: "",
      type: "reasoning" as const,
    },
  ]).flat();
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
                ...items,
                {
                  id: "activity-context-compaction",
                  label: "上下文压缩",
                  status: "running",
                  type: "activity",
                  visibility: "running_only",
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

  const conversation = page.getByRole("log", { name: "会话内容" });
  await expect(conversation.getByLabel("AI 回复正在运行：上下文压缩")).toBeVisible();
  const layout = await conversation
    .locator("[data-conversation-nested-virtual-item]")
    .evaluateAll((rows) => {
      const visibleBounds = rows.flatMap((row) => {
        const content = row.firstElementChild;
        return content === null ? [] : [content.getBoundingClientRect()];
      });
      return {
        emptyRows: rows.filter((row) => row.childElementCount === 0).length,
        maxGap: visibleBounds.slice(1).reduce((maximum, bounds, index) => {
          const previous = visibleBounds[index];
          return previous === undefined ? maximum : Math.max(maximum, bounds.top - previous.bottom);
        }, 0),
      };
    });

  expect(layout.emptyRows).toBe(0);
  expect(layout.maxGap).toBeLessThanOrEqual(17);
});

test("allows a command approval and completes the turn", async ({ page }) => {
  await page.unroute("**/v1/**");
  await page.goto("/p/code-agent");

  await page.getByRole("textbox", { name: "任务输入" }).fill("审批命令");
  await page.getByRole("button", { exact: true, name: "提交" }).click();
  await expect(page.getByRole("region", { name: "命令审批请求" })).toBeVisible();
  // 当前 Task 已在用户视野内，审批提醒只保留在 Timeline，不重复占用 Sidebar 状态位。
  await expect(page.getByRole("status", { name: "任务等待审批" })).toHaveCount(0);
  const allow = page.getByRole("button", { exact: true, name: "允许" });
  await expect(allow).toBeFocused();
  await page.keyboard.press("Enter");

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

  await expect(page.getByText("执行模式: 继续", { exact: true })).toBeVisible();
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

test("ignores repeated interrupt clicks while the request is in flight", async ({ page }) => {
  await page.unroute("**/v1/**");
  const idempotencyKeys: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/turns\/[^/]+\/interrupt$/u.test(request.url())) {
      idempotencyKeys.push(request.headers()["idempotency-key"] ?? "");
    }
  });
  await page.goto("/p/code-agent");

  await page.getByRole("textbox", { name: "任务输入" }).fill("等待中断");
  await page.getByRole("button", { exact: true, name: "提交" }).click();
  await expect(page).toHaveURL(/\/p\/code-agent\/t\/task-action-\d+$/);

  const stopButton = page.getByRole("button", { exact: true, name: "停止" });
  await expect(stopButton).toBeEnabled();
  await stopButton.evaluate((button) => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

  await expect.poll(() => idempotencyKeys).toHaveLength(1);
  expect(idempotencyKeys[0]).toBeTruthy();
});

test("preserves the prompt draft when submission fails", async ({ page }) => {
  await page.route("**/v1/projects/code-agent/attachments/image/host", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        attachment: {
          id: "attachment-preserved",
          kind: "image",
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
  await chooseHostAttachment(page, "image", "preserved.png");

  await prompt.fill("失败后保留这段草稿");
  await page.getByRole("button", { exact: true, name: "提交" }).click();

  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(
    page.getByRole("listitem").filter({ hasText: "Agent provider request failed" }),
  ).toBeVisible();
  await expect(prompt).toHaveAttribute("data-serialized-value", "失败后保留这段草稿");
  await expect(page.getByText("preserved.png", { exact: true })).toBeVisible();
});
