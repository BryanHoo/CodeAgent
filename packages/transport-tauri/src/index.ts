export { TauriCodeAgentTransport } from "./tauri-transport.js";

import type { CodeAgentClient } from "@code-agent/client";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { v4 as uuid } from "uuid";

import { TauriCodeAgentTransport } from "./tauri-transport.js";

const HOST_NOTIFICATION_ACTION_EVENT = "host-notification-action";

export type HostNotificationTarget = Readonly<{
  projectId: string;
  taskId: string;
}>;

export type HostNotificationApi = Readonly<{
  onAction: (listener: (target: HostNotificationTarget) => void) => Promise<() => void>;
  show: (
    title: string,
    options: Readonly<{ body: string; projectId: string; tag: string; taskId: string }>,
  ) => Promise<void>;
}>;

export type HostExternalUrlApi = Readonly<{
  open: (url: string) => Promise<void>;
}>;

export function createHostTransport(): TauriCodeAgentTransport {
  return new TauriCodeAgentTransport();
}

export function createHostExternalUrlApi(): HostExternalUrlApi {
  return {
    open(url) {
      return invoke("host_external_url_open", { requestId: uuid(), url });
    },
  };
}

export function createHostNotificationApi(client: CodeAgentClient): HostNotificationApi {
  // Desktop 在构建期注入 Tauri 能力，避免 Web 通过失败请求探测宿主。
  return {
    onAction(listener) {
      return listen<HostNotificationTarget>(HOST_NOTIFICATION_ACTION_EVENT, ({ payload }) => {
        listener(payload);
      });
    },
    async show(title, options) {
      await client.showHostNotification({ title, ...options });
    },
  };
}
