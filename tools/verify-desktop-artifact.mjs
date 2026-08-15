import { constants, accessSync, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

const bundleRoot = resolve("target/release/bundle");
if (!existsSync(bundleRoot)) {
  throw new Error("Desktop bundle is missing; run pnpm --filter @code-agent/desktop build first");
}

const forbiddenNames = ["node", "node.exe", "code-agent-node-binding.node"];
const forbiddenContent = ["fastify", "@fastify/websocket", "node:child_process"];
const executableSuffix = process.platform === "win32" ? ".exe" : "";
const bundledRuntimeDirectories = [];
const textExtensions = new Set([".html", ".js", ".json", ".txt"]);
const visit = (directory) => {
  if (directory.endsWith("codex-runtime") && existsSync(join(directory, "codex-package.json"))) {
    bundledRuntimeDirectories.push(directory);
  }
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (forbiddenNames.includes(entry.name.toLowerCase())) {
      throw new Error(`Desktop bundle contains forbidden runtime: ${path}`);
    }
    if (entry.isDirectory()) {
      visit(path);
    } else {
      if (textExtensions.has(extname(entry.name)) && statSync(path).size <= 16 * 1024 * 1024) {
        const content = readFileSync(path, "utf8");
        const marker = forbiddenContent.find((value) => content.includes(value));
        if (marker !== undefined) throw new Error(`Desktop bundle contains ${marker}: ${path}`);
      }
    }
  }
};

visit(bundleRoot);

const preparedRuntime = resolve("apps/desktop/src-tauri/resources/codex-runtime");
if (!existsSync(preparedRuntime)) {
  throw new Error("Prepared Codex runtime is missing");
}
const runtimeManifest = JSON.parse(
  readFileSync(join(preparedRuntime, "codex-package.json"), "utf8"),
);
if (
  runtimeManifest.entrypoint !== `bin/codex${executableSuffix}` ||
  runtimeManifest.pathDir !== "codex-path" ||
  runtimeManifest.resourcesDir !== "codex-resources"
) {
  throw new Error("Prepared Codex runtime manifest is invalid");
}

const runtimeFiles = [];
const collectRuntimeFiles = (directory) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) collectRuntimeFiles(path);
    else runtimeFiles.push(relative(preparedRuntime, path));
  }
};
collectRuntimeFiles(preparedRuntime);
if (bundledRuntimeDirectories.length === 0) {
  throw new Error("Desktop bundle is missing the canonical Codex runtime package");
}

for (const runtimeDirectory of bundledRuntimeDirectories) {
  // 逐项校验官方 package，平台新增沙箱或 Shell 资源时不能静默漏包。
  for (const relativePath of runtimeFiles) {
    const source = join(preparedRuntime, relativePath);
    const path = join(runtimeDirectory, relativePath);
    if (!existsSync(path) || !statSync(path).isFile()) {
      throw new Error(`Desktop bundle is missing required Codex runtime: ${path}`);
    }
    if (process.platform !== "win32" && (statSync(source).mode & 0o111) !== 0) {
      accessSync(path, constants.X_OK);
    }
  }
  const requiredExecutables = [
    runtimeManifest.entrypoint,
    `bin/codex-code-mode-host${executableSuffix}`,
    `${runtimeManifest.pathDir}/rg${executableSuffix}`,
    ...(process.platform === "win32" ? [`${runtimeManifest.pathDir}/npx.exe`] : []),
  ];
  for (const relativePath of requiredExecutables) {
    const path = join(runtimeDirectory, relativePath);
    accessSync(path, constants.X_OK);
  }
}
process.stdout.write("Desktop artifact isolation verified.\n");
