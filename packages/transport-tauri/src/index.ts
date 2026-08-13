export { TauriCodeAgentTransport } from "./tauri-transport.js";

import { TauriCodeAgentTransport } from "./tauri-transport.js";

export function createHostTransport(): TauriCodeAgentTransport {
  return new TauriCodeAgentTransport();
}
