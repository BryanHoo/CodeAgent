export { TauriCodeAgentTransport } from "./tauri-transport.js";

import { TauriCodeAgentTransport } from "./tauri-transport.js";

export const hostCapabilities = { nativeDirectoryPicker: true } as const;

export function createHostTransport(): TauriCodeAgentTransport {
  return new TauriCodeAgentTransport();
}
