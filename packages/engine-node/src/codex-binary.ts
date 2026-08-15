import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, posix, resolve, win32 } from "node:path";

interface BundledTarget {
  readonly executable: string;
  readonly packageName: string;
  readonly triple: string;
}

const BUNDLED_TARGETS: Readonly<Record<string, BundledTarget>> = {
  "darwin-arm64": {
    executable: "codex",
    packageName: "@openai/codex-darwin-arm64",
    triple: "aarch64-apple-darwin",
  },
  "linux-arm64": {
    executable: "codex",
    packageName: "@openai/codex-linux-arm64",
    triple: "aarch64-unknown-linux-musl",
  },
  "linux-x64": {
    executable: "codex",
    packageName: "@openai/codex-linux-x64",
    triple: "x86_64-unknown-linux-musl",
  },
  "win32-arm64": {
    executable: "codex.exe",
    packageName: "@openai/codex-win32-arm64",
    triple: "aarch64-pc-windows-msvc",
  },
  "win32-x64": {
    executable: "codex.exe",
    packageName: "@openai/codex-win32-x64",
    triple: "x86_64-pc-windows-msvc",
  },
};

export interface LocateCodexBinaryOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly explicitPath?: string;
  readonly platform?: NodeJS.Platform;
}

async function executable(path: string, platform: NodeJS.Platform): Promise<boolean> {
  try {
    await access(path, platform === "win32" ? undefined : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function environmentValue(
  env: NodeJS.ProcessEnv,
  name: string,
  platform: NodeJS.Platform,
): string | undefined {
  const direct = env[name];
  if (direct !== undefined || platform !== "win32") return direct;
  return Object.entries(env).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
}

function bundledBinary(platform: NodeJS.Platform): string | undefined {
  const target = BUNDLED_TARGETS[`${platform}-${process.arch}`];
  if (target === undefined) return undefined;
  try {
    const rootRequire = createRequire(import.meta.url);
    const codexManifest = rootRequire.resolve("@openai/codex/package.json");
    const codexRequire = createRequire(codexManifest);
    const targetManifest = codexRequire.resolve(`${target.packageName}/package.json`);
    return resolve(dirname(targetManifest), "vendor", target.triple, "bin", target.executable);
  } catch {
    return undefined;
  }
}

async function requireExecutable(path: string, platform: NodeJS.Platform): Promise<string> {
  const resolved = resolve(path);
  if (platform === "win32" && !resolved.toLowerCase().endsWith(".exe")) {
    throw new Error("Windows Codex binary must be a native .exe executable");
  }
  if (!(await executable(resolved, platform))) {
    throw new Error(`Codex binary is not executable: ${resolved}`);
  }
  return resolved;
}

export async function locateCodexBinary(options: LocateCodexBinaryOptions = {}): Promise<string> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  if (options.explicitPath !== undefined) {
    return requireExecutable(options.explicitPath, platform);
  }
  const configured = environmentValue(env, "CODE_AGENT_CODEX_BIN", platform);
  if (configured !== undefined) return requireExecutable(configured, platform);

  const bundled = bundledBinary(platform);
  if (bundled !== undefined && (await executable(bundled, platform))) return bundled;

  const pathApi = platform === "win32" ? win32 : posix;
  const names = platform === "win32" ? ["codex.exe"] : ["codex"];
  const directories = (environmentValue(env, "PATH", platform) ?? "")
    .split(pathApi.delimiter)
    .filter(Boolean);
  for (const directory of directories) {
    for (const name of names) {
      const candidate = pathApi.join(directory, name);
      if (await executable(candidate, platform)) return resolve(candidate);
    }
  }
  throw new Error("Codex binary was not found; install @openai/codex or configure --codex-bin");
}
