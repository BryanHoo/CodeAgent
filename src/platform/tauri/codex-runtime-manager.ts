import { invoke } from "@tauri-apps/api/core";
import type { CodexRuntimeAvailability } from "@/protocol/index.js";

export function inspectCodexRuntime(): Promise<CodexRuntimeAvailability> {
  return invoke<CodexRuntimeAvailability>("inspect_codex_runtime");
}

export async function downloadAndInspectCodexRuntime(): Promise<CodexRuntimeAvailability> {
  await invoke<CodexRuntimeAvailability>("install_codex_runtime");
  // 安装完成后重新走统一发现逻辑，保证进入工作台前使用的是已验证路径。
  return inspectCodexRuntime();
}
