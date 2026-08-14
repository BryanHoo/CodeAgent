export { TauriCodeAgentTransport } from "./tauri-transport.js";

import type { CodeAgentClient } from "@code-agent/client";

import { TauriCodeAgentTransport } from "./tauri-transport.js";

export type HostNotificationApi = Readonly<{
  show: (title: string, options: Readonly<{ body: string; tag: string }>) => Promise<void>;
}>;

export function createHostTransport(): TauriCodeAgentTransport {
  return new TauriCodeAgentTransport();
}

export function createHostNotificationApi(client: CodeAgentClient): HostNotificationApi {
  // Desktop 在构建期注入 Tauri 能力，避免 Web 通过失败请求探测宿主。
  return {
    async show(title, options) {
      await client.showHostNotification({ title, ...options });
    },
  };
}
