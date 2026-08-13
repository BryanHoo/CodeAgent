import { constants } from "node:fs";
import { access, copyFile, cp, mkdir, readFile, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const SUPPORTED_CODEX_VERSION = "0.147.0";
const execFileAsync = promisify(execFile);
const TARGETS = {
  "darwin-arm64": {
    package: "@openai/codex-darwin-arm64",
    triple: "aarch64-apple-darwin",
  },
  "darwin-x64": {
    package: "@openai/codex-darwin-x64",
    triple: "x86_64-apple-darwin",
  },
  "linux-arm64": {
    package: "@openai/codex-linux-arm64",
    triple: "aarch64-unknown-linux-musl",
  },
  "linux-x64": {
    package: "@openai/codex-linux-x64",
    triple: "x86_64-unknown-linux-musl",
  },
  "win32-arm64": {
    package: "@openai/codex-win32-arm64",
    triple: "aarch64-pc-windows-msvc",
  },
  "win32-x64": {
    package: "@openai/codex-win32-x64",
    triple: "x86_64-pc-windows-msvc",
  },
};

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const desktopDirectory = resolve(scriptDirectory, "..");
const repositoryRoot = resolve(desktopDirectory, "../..");
const target = TARGETS[`${process.platform}-${process.arch}`];
if (target === undefined) {
  throw new Error(`Unsupported Codex desktop target: ${process.platform}-${process.arch}`);
}

const rootRequire = createRequire(import.meta.url);
const launcherManifestPath = rootRequire.resolve("@openai/codex/package.json");
const launcherManifest = JSON.parse(await readFile(launcherManifestPath, "utf8"));
if (launcherManifest.version !== SUPPORTED_CODEX_VERSION) {
  throw new Error(
    `Unsupported Codex version ${String(launcherManifest.version)}; expected ${SUPPORTED_CODEX_VERSION}`,
  );
}

const codexRequire = createRequire(launcherManifestPath);
const platformManifestPath = codexRequire.resolve(`${target.package}/package.json`);
const platformManifest = JSON.parse(await readFile(platformManifestPath, "utf8"));
if (platformManifest.version !== `${SUPPORTED_CODEX_VERSION}-${process.platform}-${process.arch}`) {
  throw new Error(`Codex platform package version is invalid: ${String(platformManifest.version)}`);
}
if (
  !platformManifest.os?.includes(process.platform) ||
  !platformManifest.cpu?.includes(process.arch)
) {
  throw new Error("Codex platform package does not match the current architecture");
}

const executableSuffix = process.platform === "win32" ? ".exe" : "";
const vendorDirectory = resolve(dirname(platformManifestPath), "vendor", target.triple);
const runtimeManifest = JSON.parse(
  await readFile(resolve(vendorDirectory, "codex-package.json"), "utf8"),
);
const expectedEntrypoint = `bin/codex${executableSuffix}`;
if (
  runtimeManifest.layoutVersion !== 1 ||
  runtimeManifest.version !== SUPPORTED_CODEX_VERSION ||
  runtimeManifest.target !== target.triple ||
  runtimeManifest.variant !== "codex" ||
  runtimeManifest.entrypoint !== expectedEntrypoint ||
  runtimeManifest.pathDir !== "codex-path" ||
  runtimeManifest.resourcesDir !== "codex-resources"
) {
  throw new Error("Codex runtime package manifest is invalid");
}

const requiredExecutables = [
  runtimeManifest.entrypoint,
  `bin/codex-code-mode-host${executableSuffix}`,
  `${runtimeManifest.pathDir}/rg${executableSuffix}`,
];
await Promise.all(
  requiredExecutables.map((path) =>
    access(
      resolve(vendorDirectory, path),
      process.platform === "win32" ? constants.F_OK : constants.X_OK,
    ),
  ),
);

const runtimeDirectory = resolve(desktopDirectory, "src-tauri", "resources", "codex-runtime");
await rm(runtimeDirectory, { recursive: true, force: true });
await mkdir(dirname(runtimeDirectory), { recursive: true });
// 镜像官方 canonical package，自动包含当前平台的全部沙箱、Shell 和搜索资源。
await cp(vendorDirectory, runtimeDirectory, { recursive: true });
if (process.platform === "win32") {
  await execFileAsync(
    "cargo",
    ["build", "--release", "--locked", "-p", "code-agent-mcp-command-proxy"],
    { cwd: repositoryRoot, windowsHide: true },
  );
  const proxy = resolve(repositoryRoot, "target/release/code-agent-mcp-command-proxy.exe");
  const bundledProxy = resolve(runtimeDirectory, runtimeManifest.pathDir, "npx.exe");
  await access(proxy, constants.F_OK);
  await copyFile(proxy, bundledProxy);
}
await Promise.all(
  requiredExecutables.map((path) =>
    access(
      resolve(runtimeDirectory, path),
      process.platform === "win32" ? constants.F_OK : constants.X_OK,
    ),
  ),
);
console.log(`Prepared complete Codex ${SUPPORTED_CODEX_VERSION} runtime: ${runtimeDirectory}`);
