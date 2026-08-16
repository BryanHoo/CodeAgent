import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const usage = "Usage: node tools/release/smoke-cli.mjs --artifacts <directory> --target <target>";
if (process.argv.includes("--help")) {
  process.stdout.write(`${usage}\n`);
  process.exit(0);
}

function readOption(name) {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? undefined : process.argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing required option: ${name}\n${usage}`);
  }
  return value;
}

const supportedTargets = new Map([
  ["darwin-arm64", "darwin-arm64"],
  ["linux-x64", "linux-x64-gnu"],
  ["win32-x64", "win32-x64-msvc"],
]);
const target = readOption("--target");
const currentTarget = supportedTargets.get(`${process.platform}-${process.arch}`);
if (target !== currentTarget) {
  throw new Error(`CLI smoke target ${target} does not match host ${String(currentTarget)}`);
}

const root = resolve(import.meta.dirname, "../..");
const version = JSON.parse(
  await (await import("node:fs/promises")).readFile(resolve(root, "package.json"), "utf8"),
).version;
const artifactsDirectory = resolve(readOption("--artifacts"));
const files = readdirSync(artifactsDirectory);
const cliTarball = join(artifactsDirectory, `bryanhu-code-agent-${version}.tgz`);
const nativeTarball = join(artifactsDirectory, `bryanhu-code-agent-${target}-${version}.tgz`);
for (const tarball of [cliTarball, nativeTarball]) {
  if (!files.includes(tarball.slice(artifactsDirectory.length + 1))) {
    throw new Error(`Required CLI smoke artifact is missing: ${tarball}`);
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: false,
    timeout: 60_000,
    ...options,
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${String(result.status)}`);
  }
  return result.stdout ?? "";
}

const installRoot = mkdtempSync(join(tmpdir(), "code-agent-release-smoke-"));
try {
  // 同一 npm install 事务使用本地 native tarball，避免尚未公开的版本从 registry 解析。
  run("npm", [
    "install",
    "--prefix",
    installRoot,
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--package-lock=false",
    cliTarball,
    nativeTarball,
  ]);
  const executable = join(
    installRoot,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "code-agent.cmd" : "code-agent",
  );
  const help = run(executable, ["--help"]);
  if (!help.includes("Usage: code-agent")) {
    throw new Error("Installed CLI help output is invalid");
  }
  const codexHome = join(installRoot, "codex-home");
  mkdirSync(codexHome, { recursive: true });
  run(executable, ["doctor"], {
    env: { ...process.env, CODEX_HOME: codexHome },
  });
  process.stdout.write(`CLI release smoke passed for ${target}.\n`);
} finally {
  rmSync(installRoot, { force: true, recursive: true });
}
