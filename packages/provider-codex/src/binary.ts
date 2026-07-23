import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { createRequire } from "node:module";
import { delimiter, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const SUPPORTED_CODEX_VERSION = "0.145.0";

interface BundledCodexTarget {
  executableName: string;
  packageName: string;
  targetTriple: string;
}

// 与固定版本 Codex launcher 的平台映射保持一致，直接管理原生进程。
const BUNDLED_CODEX_TARGETS: Readonly<Record<string, BundledCodexTarget>> = {
  "darwin-arm64": {
    executableName: "codex",
    packageName: "@openai/codex-darwin-arm64",
    targetTriple: "aarch64-apple-darwin",
  },
  "darwin-x64": {
    executableName: "codex",
    packageName: "@openai/codex-darwin-x64",
    targetTriple: "x86_64-apple-darwin",
  },
  "linux-arm64": {
    executableName: "codex",
    packageName: "@openai/codex-linux-arm64",
    targetTriple: "aarch64-unknown-linux-musl",
  },
  "linux-x64": {
    executableName: "codex",
    packageName: "@openai/codex-linux-x64",
    targetTriple: "x86_64-unknown-linux-musl",
  },
  "win32-arm64": {
    executableName: "codex.exe",
    packageName: "@openai/codex-win32-arm64",
    targetTriple: "aarch64-pc-windows-msvc",
  },
  "win32-x64": {
    executableName: "codex.exe",
    packageName: "@openai/codex-win32-x64",
    targetTriple: "x86_64-pc-windows-msvc",
  },
};

export type CodexBinarySource = "explicit" | "environment" | "bundled" | "path";

export interface CodexBinary {
  path: string;
  source: CodexBinarySource;
}

export interface CodexVersionInfo {
  raw: string;
  version: string;
}

export interface LocateCodexBinaryOptions {
  explicitPath?: string;
  env?: NodeJS.ProcessEnv;
  bundledBinaryPath?: string | null;
}

function resolveBundledBinary(): string | null {
  const targetKey = `${process.platform}-${process.arch}`;
  const target = BUNDLED_CODEX_TARGETS[targetKey];
  if (!target) {
    return null;
  }

  try {
    const rootRequire = createRequire(import.meta.url);
    const codexPackagePath = rootRequire.resolve("@openai/codex/package.json");
    const codexRequire = createRequire(codexPackagePath);
    const platformPackagePath = codexRequire.resolve(`${target.packageName}/package.json`);
    return resolve(
      dirname(platformPackagePath),
      "vendor",
      target.targetTriple,
      "bin",
      target.executableName,
    );
  } catch {
    return null;
  }
}

async function isExecutable(filePath: string): Promise<boolean> {
  try {
    await access(filePath, process.platform === "win32" ? undefined : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function pathCandidateNames(env: NodeJS.ProcessEnv): readonly string[] {
  if (process.platform !== "win32") {
    return ["codex"];
  }

  const extensions = (env["PATHEXT"] ?? ".EXE;.CMD;.BAT;.COM").split(";");
  return extensions.map((extension) => `codex${extension.toLowerCase()}`);
}

async function findOnPath(env: NodeJS.ProcessEnv): Promise<string | null> {
  const directories = (env["PATH"] ?? "").split(delimiter).filter(Boolean);
  for (const directory of directories) {
    for (const candidateName of pathCandidateNames(env)) {
      const candidate = join(directory, candidateName);
      if (await isExecutable(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

async function requireExecutable(path: string, source: CodexBinarySource): Promise<CodexBinary> {
  const resolvedPath = resolve(path);
  if (!(await isExecutable(resolvedPath))) {
    throw new Error(`Codex binary is not executable: ${resolvedPath}`);
  }
  return { path: resolvedPath, source };
}

export async function locateCodexBinary(
  options: LocateCodexBinaryOptions = {},
): Promise<CodexBinary> {
  const env = options.env ?? process.env;

  if (options.explicitPath) {
    return requireExecutable(options.explicitPath, "explicit");
  }
  const environmentPath = env["CODE_AGENT_CODEX_BIN"];
  if (environmentPath) {
    return requireExecutable(environmentPath, "environment");
  }

  // 包内固定版本优先，避免用户 PATH 中的 Codex 协议发生漂移。
  const bundledPath =
    options.bundledBinaryPath === undefined ? resolveBundledBinary() : options.bundledBinaryPath;
  if (bundledPath && (await isExecutable(bundledPath))) {
    return { path: resolve(bundledPath), source: "bundled" };
  }

  const pathBinary = await findOnPath(env);
  if (pathBinary) {
    return { path: resolve(pathBinary), source: "path" };
  }

  throw new Error("Codex binary was not found; install @openai/codex or configure --codex-bin");
}

export async function checkCodexVersion(binaryPath: string): Promise<CodexVersionInfo> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(binaryPath, ["--version"], {
      encoding: "utf8",
      timeout: 5_000,
      windowsHide: true,
    }));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Codex version check failed: ${reason}`, { cause: error });
  }

  const raw = stdout.trim();
  const match = /^codex-cli (\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(raw);
  const version = match?.[1];
  if (!version) {
    throw new Error(`Invalid Codex version output: ${raw || "<empty>"}`);
  }
  if (version !== SUPPORTED_CODEX_VERSION) {
    throw new Error(`Unsupported Codex version ${version}; expected ${SUPPORTED_CODEX_VERSION}`);
  }

  return { raw, version };
}
