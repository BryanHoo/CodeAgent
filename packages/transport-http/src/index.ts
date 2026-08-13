export { HttpCodeAgentTransport } from "./http-transport.js";
export type { CodeAgentClientOptions, CodeAgentRequestTimeouts } from "./http-client-transport.js";
export type { WebSocketFactory } from "./event-client.js";

import { HttpCodeAgentTransport } from "./http-transport.js";

export function createHostTransport(): HttpCodeAgentTransport {
  return new HttpCodeAgentTransport();
}
