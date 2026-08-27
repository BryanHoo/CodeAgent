import type { MockRoute as Route } from "./mock-route.js";
import { parseRequestRecord } from "./mock-request.js";
import type { AppShellApiState } from "./mock-state.js";

function taskActionMatch(pathname: string, action: string): RegExpExecArray | null {
  return new RegExp(`^/v1/projects/([^/]+)/tasks/([^/]+)/${action}$`, "u").exec(pathname);
}

function attachmentFromPath(pathname: string, body: string | null) {
  const kind = pathname.endsWith("/image") ? ("image" as const) : ("file" as const);
  const fileName =
    /filename="([^"]+)"/u.exec(body ?? "")?.[1] ??
    `mock.${kind === "image" ? "png" : "txt"}`;
  return {
    attachment: {
      id: `mock-attachment-${Date.now().toString(36)}`,
      kind,
      mediaType: kind === "image" ? ("image/png" as const) : ("text/plain" as const),
      name: fileName,
      size: 1,
    },
  };
}

// 覆盖无需持久化状态的协议动作，确保完整前端交互不会请求真实后端。
export async function handleAppShellFallbackRoute(
  route: Route,
  state: AppShellApiState,
): Promise<boolean> {
  const url = new URL(route.request().url());
  const method = route.request().method();
  const bodyText = route.request().postData();
  const taskPath = /^\/v1\/projects\/([^/]+)\/tasks\/([^/]+)/u.exec(url.pathname);
  const projectId = taskPath?.[1] ?? "";
  const taskId = taskPath?.[2] ?? "";
  let body: unknown;

  if (url.pathname === "/v1/app-update" && method === "POST") {
    body = {
      appVersion: "1.3.0",
      codexVersion: "0.149.0",
      latestVersion: "1.3.0",
      releaseNotes: null,
      status: "restart-required",
      updateAvailable: false,
    };
  } else if (url.pathname === "/v1/access/pair" && method === "POST") {
    body = { authenticated: true, mode: "local", version: 1 };
  } else if (url.pathname === "/v1/access/logout" && method === "POST") {
    // 本地 mock 不进入登录门禁，退出后仍维持可用工作台。
    body = { authenticated: true, mode: "local", version: 1 };
  } else if (
    /^\/v1\/projects\/[^/]+\/attachments\/(?:file|image)$/u.test(url.pathname) &&
    method === "POST"
  ) {
    body = attachmentFromPath(url.pathname, bodyText);
  } else if (
    /^\/v1\/projects\/[^/]+\/tasks\/[^/]+\/attachments\/[^/]+\/open$/u.test(url.pathname)
  ) {
    const segments = url.pathname.split("/");
    body = { attachmentId: segments.at(-2) ?? "mock-attachment", status: "opened" };
  } else if (
    /^\/v1\/projects\/[^/]+\/tasks\/[^/]+\/background-terminals\/[^/]+\/terminate$/u.test(
      url.pathname,
    )
  ) {
    body = { status: "terminated", terminalId: url.pathname.split("/").at(-2) ?? "terminal" };
  } else if (taskActionMatch(url.pathname, "unsubscribe") !== null) {
    body = { status: "unsubscribed", taskId };
  } else if (taskActionMatch(url.pathname, "unarchive") !== null) {
    const task = state.archivedTasks.find((item) => item.id === taskId) ?? {
      id: taskId,
      pinned: false,
      projectId,
      title: "Restored task",
      updatedAt: "2026-08-27T12:00:00.000Z",
    };
    state.archivedTasks = state.archivedTasks.filter((item) => item.id !== taskId);
    if (!state.routedTasks.some((item) => item.id === task.id)) state.routedTasks.unshift(task);
    body = { task };
  } else if (taskActionMatch(url.pathname, "feedback") !== null) {
    body = { status: "sent", taskId };
  } else if (taskActionMatch(url.pathname, "goal") !== null) {
    if (method === "DELETE") {
      body = { cleared: true };
    } else {
      const request = parseRequestRecord(bodyText);
      body = {
        goal: {
          createdAt: "2026-08-27T12:00:00.000Z",
          objective: "完成当前工作台任务",
          status: request["status"] === "paused" ? "paused" : "active",
          timeUsedSeconds: 0,
          tokenBudget: null,
          tokensUsed: 0,
          updatedAt: "2026-08-27T12:00:00.000Z",
        },
      };
    }
  } else if (/\/turns\/[^/]+\/steer$/u.test(url.pathname)) {
    body = { status: "accepted", taskId, turnId: url.pathname.split("/").at(-2) ?? "turn" };
  } else if (/\/turns\/[^/]+\/interrupt$/u.test(url.pathname)) {
    body = {
      status: "interrupting",
      taskId,
      turnId: url.pathname.split("/").at(-2) ?? "turn",
    };
  } else if (/\/pending-requests\/[^/]+\/resolve$/u.test(url.pathname)) {
    const request = parseRequestRecord(bodyText);
    const requestId = url.pathname.split("/").at(-2) ?? "request";
    const itemId = typeof request["itemId"] === "string" ? request["itemId"] : "item";
    const turnId = typeof request["turnId"] === "string" ? request["turnId"] : "turn";
    body = {
      request: {
        availableDecisions: ["allow"],
        createdAt: "2026-08-27T12:00:00.000Z",
        expiresAt: null,
        grantRoot: null,
        itemId,
        projectId,
        reason: null,
        requestId,
        status: "resolved",
        taskId,
        turnId,
        type: "file_change_approval",
      },
    };
  } else {
    return false;
  }

  await route.fulfill({ contentType: "application/json", json: body });
  return true;
}
