import { Channel } from "@tauri-apps/api/core";
import type {
  CodexRuntimeAvailability,
  CodexRuntimeInstallProgress,
} from "@/protocol/index.js";

import { invoke } from "./native-invoke.js";

export function inspectCodexRuntime(): Promise<CodexRuntimeAvailability> {
  return invoke<CodexRuntimeAvailability>("inspect_codex_runtime");
}

export async function downloadAndInspectCodexRuntime(
  onProgress: (progress: CodexRuntimeInstallProgress) => void = () => undefined,
): Promise<CodexRuntimeAvailability> {
  let latestSequence = 0;
  const progressChannel = new Channel<CodexRuntimeInstallProgress>((progress) => {
    if (progress.sequence <= latestSequence) return;
    latestSequence = progress.sequence;
    onProgress(progress);
  });
  await invoke<CodexRuntimeAvailability>("install_codex_runtime", {
    onProgress: progressChannel,
  });
  // 安装完成后重新走统一发现逻辑，保证进入工作台前使用的是已验证路径。
  return inspectCodexRuntime();
}
