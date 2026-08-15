import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "tests/fixtures/fake-codex-launcher.rs");
const destination = resolve(
  root,
  ".cache/e2e",
  process.platform === "win32" ? "fake-codex-launcher.exe" : "fake-codex-launcher",
);

// 直接用当前 Rust 工具链生成轻量原生入口，确保三端执行同一套 Fake Codex 协议脚本。
await mkdir(dirname(destination), { recursive: true });
await execFileAsync("rustc", ["--edition=2024", "-D", "warnings", source, "-o", destination], {
  cwd: root,
});
