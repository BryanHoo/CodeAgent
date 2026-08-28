import type { AgentEvent } from "@/protocol/index.js";

import { i18n } from "../../i18n/i18n.js";
import {
  showDesktopNotification,
  type DesktopNotification,
} from "../../platform/tauri/desktop-notification.js";
import { recordInternalWarning } from "./internal-diagnostics.js";

const MAX_FAILED_TURN_KEYS = 256;

export type DesktopNotificationApi = Readonly<{
  show: (notification: DesktopNotification) => Promise<void>;
}>;

export type TaskNotifier = Readonly<{
  notify: (projectId: string, event: AgentEvent, taskTitle: string) => void;
}>;

type DesktopTaskNotifierOptions = Readonly<{
  api?: DesktopNotificationApi | undefined;
  isEnabled?: (() => boolean) | undefined;
  isPageForeground?: (() => boolean) | undefined;
}>;

function createTurnKey(event: Extract<AgentEvent, { turnId: string }>): string {
  return `${event.taskId}:${event.turnId}`;
}

function mapTaskNotification(event: AgentEvent): string | undefined {
  switch (event.type) {
    case "turn.completed":
      return event.payload.turn.status === "completed"
        ? i18n.t("notification.completed", { ns: "conversation" })
        : event.payload.turn.status === "interrupted"
          ? i18n.t("notification.interrupted", { ns: "conversation" })
          : event.payload.turn.status === "failed"
            ? i18n.t("notification.failed", { ns: "conversation" })
            : undefined;
    case "provider.error":
      return event.payload.willRetry
        ? undefined
        : i18n.t("notification.failedWithMessage", {
            message: event.payload.message,
            ns: "conversation",
          });
    case "pending_request.created":
      return event.payload.request.type === "user_input"
        ? i18n.t("notification.waitingInput", { ns: "conversation" })
        : i18n.t("notification.waitingApproval", { ns: "conversation" });
    default:
      return undefined;
  }
}

class DesktopTaskNotifier implements TaskNotifier {
  readonly #api: DesktopNotificationApi;
  readonly #failedTurnKeys = new Set<string>();
  readonly #isEnabled: () => boolean;
  readonly #isPageForeground: () => boolean;

  public constructor(options: DesktopTaskNotifierOptions) {
    this.#api = options.api ?? { show: showDesktopNotification };
    this.#isEnabled = options.isEnabled ?? (() => true);
    this.#isPageForeground =
      options.isPageForeground ??
      (() => globalThis.document.visibilityState === "visible" && globalThis.document.hasFocus());
  }

  public notify(projectId: string, event: AgentEvent, taskTitle: string): void {
    if (!this.#isEnabled() || this.#isPageForeground()) return;

    if (event.type === "provider.error" && !event.payload.willRetry) {
      const turnKey = createTurnKey(event);
      if (this.#failedTurnKeys.has(turnKey)) return;
      if (this.#failedTurnKeys.size >= MAX_FAILED_TURN_KEYS) {
        const oldestTurnKey = this.#failedTurnKeys.values().next().value;
        if (oldestTurnKey !== undefined) this.#failedTurnKeys.delete(oldestTurnKey);
      }
      this.#failedTurnKeys.add(turnKey);
    } else if (
      event.type === "turn.completed" &&
      this.#failedTurnKeys.delete(createTurnKey(event))
    ) {
      // 不可恢复错误已立即提醒；随后同 Turn 的终态只负责清理去重记录。
      return;
    }

    const body = mapTaskNotification(event);
    if (body === undefined) return;

    const normalizedTaskTitle = taskTitle.trim() || "Task";
    void this.#api
      .show({ body, title: `CodeAgent · ${normalizedTaskTitle}` })
      .catch((error: unknown) => {
        recordInternalWarning("desktop_notification_show_failed", error, {
          projectId,
          taskId: event.taskId,
        });
      });
  }
}

export function createDesktopTaskNotifier(
  options: DesktopTaskNotifierOptions = {},
): TaskNotifier {
  return new DesktopTaskNotifier(options);
}
