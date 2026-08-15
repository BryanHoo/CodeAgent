import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const require = createRequire(import.meta.url);

export function resolveUpdaterSigningEnvironment({
  environment = process.env,
  fileExists = existsSync,
  homeDirectory = homedir(),
} = {}) {
  const localKeyPath = join(homeDirectory, ".tauri", "code-agent-updater.key");
  const configuredPrivateKey = environment.TAURI_SIGNING_PRIVATE_KEY;
  let privateKey = configuredPrivateKey?.trim().length ? configuredPrivateKey : undefined;
  if (privateKey === undefined && fileExists(localKeyPath)) {
    privateKey = localKeyPath;
  }

  if (privateKey === undefined) {
    throw new Error(
      `Missing updater signing key. Set TAURI_SIGNING_PRIVATE_KEY or create ${localKeyPath}.`,
    );
  }

  return {
    ...environment,
    TAURI_SIGNING_PRIVATE_KEY: privateKey,
    // 无密码密钥也必须显式传递空值，避免 Tauri 在非交互构建中等待输入。
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: environment.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? "",
  };
}

async function runTauriBuild() {
  const cliManifestPath = require.resolve("@tauri-apps/cli/package.json");
  const cliPath = resolve(dirname(cliManifestPath), "tauri.js");
  const environment = resolveUpdaterSigningEnvironment();

  const exitCode = await new Promise((resolveExitCode, reject) => {
    const child = spawn(process.execPath, [cliPath, "build", ...process.argv.slice(2)], {
      env: environment,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) => resolveExitCode(code ?? 1));
  });

  process.exitCode = exitCode;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === scriptPath) {
  runTauriBuild().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
