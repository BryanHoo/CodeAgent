import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cliResult = spawnSync(process.execPath, ["dist/cli.js", "--help"], {
  encoding: "utf8",
  shell: false,
});

if (cliResult.status !== 0 || !cliResult.stdout.includes("Usage: code-agent")) {
  process.stderr.write(cliResult.stderr);
  throw new Error("Built CLI is not executable");
}

const result = spawnSync("pnpm", ["pack", "--dry-run", "--json"], {
  encoding: "utf8",
  shell: false,
});

if (result.status !== 0) {
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}

const output = JSON.parse(result.stdout);
// pnpm 返回单个对象；保留数组分支便于兼容不同打包器的 JSON 形态。
const manifest = Array.isArray(output) ? output[0] : output;

if (!manifest) {
  throw new Error("Package manifest is missing from pack output");
}

const files = new Set(manifest.files.map(({ path }) => path));
const requiredFiles = [
  "CHANGELOG.md",
  "dist/cli.js",
  "dist/server/index.js",
  "dist/sqlite-state-worker.js",
  "dist/web/index.html",
];
const missingFiles = requiredFiles.filter((path) => !files.has(path));
const sourceMapFiles = [...files].filter((path) => path.endsWith(".map"));

if (missingFiles.length > 0) {
  throw new Error(`Package is missing required files: ${missingFiles.join(", ")}`);
}

if (sourceMapFiles.length > 0) {
  throw new Error(`Package must not include source maps: ${sourceMapFiles.join(", ")}`);
}

const stateRoot = mkdtempSync(join(tmpdir(), "code-agent-package-check-"));
try {
  // 发布校验必须真实启动 Worker，单纯检查文件清单无法发现相对路径错误。
  const { SqliteStateRepository } = await import("../dist/server/index.js");
  const repository = await SqliteStateRepository.open(join(stateRoot, "state.sqlite3"));
  await repository.close();
} finally {
  rmSync(stateRoot, { force: true, recursive: true });
}

process.stdout.write(`Package verified: ${manifest.filename} (${manifest.files.length} files)\n`);
