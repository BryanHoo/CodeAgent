import { constants } from "node:fs";
import { access, chmod, copyFile, mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SUPPORTED_CODEX_VERSION = "0.147.0";
const TARGETS = {
  "darwin-arm64": {
    executable: "codex",
    package: "@openai/codex-darwin-arm64",
    triple: "aarch64-apple-darwin",
  },
  "darwin-x64": {
    executable: "codex",
    package: "@openai/codex-darwin-x64",
    triple: "x86_64-apple-darwin",
  },
  "linux-arm64": {
    executable: "codex",
    package: "@openai/codex-linux-arm64",
    triple: "aarch64-unknown-linux-musl",
  },
  "linux-x64": {
    executable: "codex",
    package: "@openai/codex-linux-x64",
    triple: "x86_64-unknown-linux-musl",
  },
  "win32-arm64": {
    executable: "codex.exe",
    package: "@openai/codex-win32-arm64",
    triple: "aarch64-pc-windows-msvc",
  },
  "win32-x64": {
    executable: "codex.exe",
    package: "@openai/codex-win32-x64",
    triple: "x86_64-pc-windows-msvc",
  },
};

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const desktopDirectory = resolve(scriptDirectory, "..");
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

const source = resolve(
  dirname(platformManifestPath),
  "vendor",
  target.triple,
  "bin",
  target.executable,
);
await access(source, process.platform === "win32" ? constants.F_OK : constants.X_OK);

const binaryDirectory = resolve(desktopDirectory, "src-tauri", "binaries");
const destination = resolve(
  binaryDirectory,
  `codex-${target.triple}${process.platform === "win32" ? ".exe" : ""}`,
);
await mkdir(binaryDirectory, { recursive: true });
await copyFile(source, destination);
if (process.platform !== "win32") {
  await chmod(destination, 0o755);
  await access(destination, constants.X_OK);
}
console.log(`Prepared Codex ${SUPPORTED_CODEX_VERSION}: ${destination}`);
