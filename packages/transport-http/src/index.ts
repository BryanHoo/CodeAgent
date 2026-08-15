export { HttpCodeAgentTransport } from "./http-transport.js";
export type { CodeAgentClientOptions, CodeAgentRequestTimeouts } from "./http-client-transport.js";
export type { WebSocketFactory } from "./event-client.js";

import type { CodeAgentClient } from "@code-agent/client";

import { HttpCodeAgentTransport } from "./http-transport.js";

export function createHostTransport(): HttpCodeAgentTransport {
  return new HttpCodeAgentTransport();
}

export const createHostExternalUrlApi: () => undefined = () => undefined;

export const createHostNotificationApi: (client: CodeAgentClient) => undefined = () => {
  // Web 宿主不提供原生通知能力，Composition Root 直接使用 Browser Notification。
  return undefined;
};
