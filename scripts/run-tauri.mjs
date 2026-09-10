import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { resolveTauriArguments } from "./tauri-build-constraints.mjs";

const tauriCli = fileURLToPath(
  new URL("../node_modules/@tauri-apps/cli/tauri.js", import.meta.url),
);

let argumentsList;
const profile = process.env.CODEAGENT_MACOS_PROFILE || "modern";
try {
  argumentsList = resolveTauriArguments(process.argv.slice(2), process.platform, process.arch, profile);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const result = spawnSync(process.execPath, [tauriCli, ...argumentsList], {
  stdio: "inherit",
  env: {
    ...process.env,
    ...(process.platform === "darwin" && argumentsList[0] === "build" ? {
      MACOSX_DEPLOYMENT_TARGET: profile === "legacy" ? "12.4" : "14.5",
      // 兼容构建独立缓存，防止不同最低系统版本的本地依赖与安装包互相覆盖。
      ...(profile === "legacy" ? {
        CARGO_TARGET_DIR: fileURLToPath(new URL("../src-tauri/target/legacy", import.meta.url)),
      } : {}),
    } : {}),
  },
});
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
