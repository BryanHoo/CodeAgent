import { constants, accessSync, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";

const bundleRoot = resolve("target/release/bundle");
if (!existsSync(bundleRoot)) {
  throw new Error("Desktop bundle is missing; run pnpm --filter @code-agent/desktop build first");
}

const forbiddenNames = ["node", "node.exe", "code-agent-node-binding.node"];
const forbiddenContent = ["fastify", "@fastify/websocket", "node:child_process"];
const executableSuffix = process.platform === "win32" ? ".exe" : "";
const requiredCodexRuntime = ["codex", "codex-code-mode-host"].map(
  (name) => `${name}${executableSuffix}`,
);
const bundledFiles = new Set();
const textExtensions = new Set([".html", ".js", ".json", ".txt"]);
const visit = (directory) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (forbiddenNames.includes(entry.name.toLowerCase())) {
      throw new Error(`Desktop bundle contains forbidden runtime: ${path}`);
    }
    if (entry.isDirectory()) {
      visit(path);
    } else {
      bundledFiles.add(entry.name.toLowerCase());
      if (textExtensions.has(extname(entry.name)) && statSync(path).size <= 16 * 1024 * 1024) {
        const content = readFileSync(path, "utf8");
        const marker = forbiddenContent.find((value) => content.includes(value));
        if (marker !== undefined) throw new Error(`Desktop bundle contains ${marker}: ${path}`);
      }
    }
  }
};

visit(bundleRoot);

// 所有发布平台都必须包含完整 Codex 原生运行时，避免平台制品只携带主程序。
for (const executable of requiredCodexRuntime) {
  if (!bundledFiles.has(executable)) {
    throw new Error(`Desktop bundle is missing required Codex runtime: ${executable}`);
  }
}

const macosExecutableDirectory = resolve(bundleRoot, "macos", "CodeAgent.app", "Contents", "MacOS");
if (existsSync(macosExecutableDirectory)) {
  // Codex 与 code-mode host 必须相邻，否则安装后的命令执行宿主无法启动。
  for (const executable of requiredCodexRuntime) {
    const path = join(macosExecutableDirectory, executable);
    if (!existsSync(path) || !statSync(path).isFile()) {
      throw new Error(`Desktop bundle is missing required Codex runtime: ${path}`);
    }
    accessSync(path, constants.X_OK);
  }
}
process.stdout.write("Desktop artifact isolation verified.\n");
