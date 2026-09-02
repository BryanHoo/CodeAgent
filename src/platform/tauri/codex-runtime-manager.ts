import { Channel } from "@tauri-apps/api/core";
import type {
  CodexRuntimeAvailability,
  CodexRuntimeInstallProgress,
} from "@/protocol/index.js";

import { invoke } from "./native-invoke.js";

function createProgressChannel(
  onProgress: (progress: CodexRuntimeInstallProgress) => void,
): Channel<CodexRuntimeInstallProgress> {
  let latestSequence = 0;
  return new Channel<CodexRuntimeInstallProgress>((progress) => {
    if (progress.sequence <= latestSequence) return;
    latestSequence = progress.sequence;
    onProgress(progress);
  });
}

export function inspectCodexRuntime(
  onProgress: (progress: CodexRuntimeInstallProgress) => void = () => undefined,
): Promise<CodexRuntimeAvailability> {
  return invoke<CodexRuntimeAvailability>("inspect_codex_runtime", {
    onProgress: createProgressChannel(onProgress),
  });
}

export async function downloadAndInspectCodexRuntime(
  onProgress: (progress: CodexRuntimeInstallProgress) => void = () => undefined,
): Promise<CodexRuntimeAvailability> {
  await invoke<CodexRuntimeAvailability>("install_codex_runtime", {
    onProgress: createProgressChannel(onProgress),
  });
  // 安装完成后重新走统一发现逻辑，保证进入工作台前使用的是已验证路径。
  return inspectCodexRuntime();
}
