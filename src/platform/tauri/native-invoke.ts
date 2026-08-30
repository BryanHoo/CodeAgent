import { invoke as tauriInvoke } from "@tauri-apps/api/core";

export type NativeInvoke = <T>(
  command: string,
  args?: Record<string, unknown>,
) => Promise<T>;

declare global {
  interface Window {
    __CODEAGENT_WEBVIEW_TEST_INVOKE__?: NativeInvoke;
  }
}

export function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  // 测试传输层仅存在于专用构建，生产路径始终调用 Tauri IPC。
  if (import.meta.env.VITE_WEBVIEW_TEST === "1") {
    const testInvoke = window.__CODEAGENT_WEBVIEW_TEST_INVOKE__;
    if (testInvoke !== undefined) {
      return args === undefined ? testInvoke<T>(command) : testInvoke<T>(command, args);
    }
  }
  return args === undefined ? tauriInvoke<T>(command) : tauriInvoke<T>(command, args);
}
