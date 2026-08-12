import type { AgentEvent } from "@code-agent/protocol";

import { i18n } from "../../i18n/i18n.js";

const MAX_FAILED_TURN_KEYS = 256;

export type BrowserNotificationHandle = Readonly<{
  addClickListener: (listener: () => void) => void;
  close: () => void;
}>;

export type BrowserNotificationApi = Readonly<{
  getPermission: () => NotificationPermission;
  requestPermission: () => Promise<NotificationPermission>;
  show: (title: string, options: NotificationOptions) => BrowserNotificationHandle;
}>;

export type TaskNotifier = Readonly<{
  notify: (projectId: string, event: AgentEvent, taskTitle: string) => void;
  requestPermission: () => Promise<void>;
}>;

export type NativeNotificationApi = Readonly<{
  show: (title: string, options: Readonly<{ body: string; tag: string }>) => Promise<void>;
}>;

type BrowserTaskNotifierOptions = Readonly<{
  api?: BrowserNotificationApi | undefined;
  focusPage?: (() => void) | undefined;
  isPageForeground?: (() => boolean) | undefined;
  navigateToTask?: ((projectId: string, taskId: string) => void) | undefined;
  nativeApi?: NativeNotificationApi | undefined;
}>;

type TaskNotification = Readonly<{
  body: string;
  tag: string;
}>;

function createDefaultNotificationApi(): BrowserNotificationApi | undefined {
  if (typeof globalThis.Notification === "undefined") {
    return undefined;
  }
  const BrowserNotification = globalThis.Notification;
  return {
    getPermission: () => BrowserNotification.permission,
    requestPermission: () => BrowserNotification.requestPermission(),
    show(title, options) {
      const notification = new BrowserNotification(title, options);
      return {
        addClickListener(listener) {
          notification.addEventListener("click", listener);
        },
        close() {
          notification.close();
        },
      };
    },
  };
}

function createTurnKey(event: Extract<AgentEvent, { turnId: string }>): string {
  return `${event.taskId}:${event.turnId}`;
}

function mapTaskNotification(projectId: string, event: AgentEvent): TaskNotification | undefined {
  switch (event.type) {
    case "turn.completed": {
      const body =
        event.payload.turn.status === "completed"
          ? i18n.t("notification.completed", { ns: "conversation" })
          : event.payload.turn.status === "interrupted"
            ? i18n.t("notification.interrupted", { ns: "conversation" })
            : event.payload.turn.status === "failed"
              ? i18n.t("notification.failed", { ns: "conversation" })
              : undefined;
      return body === undefined
        ? undefined
        : {
            body,
            tag: `${projectId}:${event.taskId}:${event.turnId}:terminal`,
          };
    }
    case "provider.error":
      return event.payload.willRetry
        ? undefined
        : {
            body: i18n.t("notification.failedWithMessage", {
              message: event.payload.message,
              ns: "conversation",
            }),
            tag: `${projectId}:${event.taskId}:${event.turnId}:terminal`,
          };
    case "pending_request.created":
      return {
        body:
          event.payload.request.type === "user_input"
            ? i18n.t("notification.waitingInput", { ns: "conversation" })
            : i18n.t("notification.waitingApproval", { ns: "conversation" }),
        tag: `${projectId}:${event.taskId}:${event.payload.request.requestId}:request`,
      };
    default:
      return undefined;
  }
}

class BrowserTaskNotifier implements TaskNotifier {
  readonly #api: BrowserNotificationApi | undefined;
  readonly #failedTurnKeys = new Set<string>();
  readonly #focusPage: () => void;
  readonly #isPageForeground: () => boolean;
  readonly #navigateToTask: (projectId: string, taskId: string) => void;
  readonly #nativeApi: NativeNotificationApi | undefined;
  #permissionRequest: Promise<void> | undefined;

  public constructor(options: BrowserTaskNotifierOptions) {
    this.#api = options.api;
    this.#focusPage =
      options.focusPage ??
      (() => {
        globalThis.window.focus();
      });
    this.#isPageForeground =
      options.isPageForeground ??
      (() => globalThis.document.visibilityState === "visible" && globalThis.document.hasFocus());
    this.#navigateToTask = options.navigateToTask ?? (() => undefined);
    this.#nativeApi = options.nativeApi;
  }

  public notify(projectId: string, event: AgentEvent, taskTitle: string): void {
    if (this.#nativeApi === undefined && this.#api === undefined) {
      return;
    }
    if (this.#isPageForeground()) {
      return;
    }

    if (event.type === "provider.error" && !event.payload.willRetry) {
      const turnKey = createTurnKey(event);
      if (this.#failedTurnKeys.has(turnKey)) {
        return;
      }
      if (this.#failedTurnKeys.size >= MAX_FAILED_TURN_KEYS) {
        const oldestTurnKey = this.#failedTurnKeys.values().next().value;
        if (oldestTurnKey !== undefined) {
          this.#failedTurnKeys.delete(oldestTurnKey);
        }
      }
      this.#failedTurnKeys.add(turnKey);
    } else if (
      event.type === "turn.completed" &&
      this.#failedTurnKeys.delete(createTurnKey(event))
    ) {
      // 不可恢复错误已立即提醒；随后同 Turn 的终态只负责清理去重记录。
      return;
    }

    const taskNotification = mapTaskNotification(projectId, event);
    if (taskNotification === undefined) {
      return;
    }

    try {
      const normalizedTaskTitle = taskTitle.trim() || "Task";
      if (this.#nativeApi !== undefined) {
        void this.#nativeApi
          .show(`CodeAgent · ${normalizedTaskTitle}`, taskNotification)
          .catch(() => {
            this.#showBrowserNotification(
              normalizedTaskTitle,
              taskNotification,
              projectId,
              event.taskId,
            );
          });
        return;
      }
      this.#showBrowserNotification(normalizedTaskTitle, taskNotification, projectId, event.taskId);
    } catch {
      // 系统通知属于增强能力，浏览器拒绝构造时不能中断实时事件处理。
    }
  }

  #showBrowserNotification(
    normalizedTaskTitle: string,
    taskNotification: TaskNotification,
    projectId: string,
    taskId: string,
  ): void {
    if (this.#api?.getPermission() !== "granted") return;
    try {
      const notification = this.#api.show(`CodeAgent · ${normalizedTaskTitle}`, {
        body: taskNotification.body,
        data: { projectId, taskId },
        tag: taskNotification.tag,
      });
      notification.addClickListener(() => {
        notification.close();
        this.#focusPage();
        this.#navigateToTask(projectId, taskId);
      });
    } catch {
      // 浏览器拒绝通知时保持实时事件处理继续运行。
    }
  }

  public requestPermission(): Promise<void> {
    if (this.#api === undefined) {
      return Promise.resolve();
    }
    if (this.#permissionRequest !== undefined) {
      return this.#permissionRequest;
    }
    let browserPermissionRequest: Promise<NotificationPermission>;
    try {
      if (this.#api.getPermission() !== "default") {
        return Promise.resolve();
      }
      browserPermissionRequest = this.#api.requestPermission();
    } catch {
      return Promise.resolve();
    }
    this.#permissionRequest = browserPermissionRequest
      .then(() => undefined)
      .catch(() => undefined)
      .finally(() => {
        this.#permissionRequest = undefined;
      });
    return this.#permissionRequest;
  }
}

export function createBrowserTaskNotifier(options: BrowserTaskNotifierOptions = {}): TaskNotifier {
  return new BrowserTaskNotifier({
    ...options,
    api: options.api ?? createDefaultNotificationApi(),
  });
}
