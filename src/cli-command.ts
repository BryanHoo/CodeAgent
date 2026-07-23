import {
  checkCodexVersion,
  locateCodexBinary,
  startCodexAppServer,
  type CodexBinary,
  type CodexProcessExit,
  type CodexVersionInfo,
  type LocateCodexBinaryOptions,
  type StartCodexAppServerOptions,
} from "@code-agent/provider-codex";

import packageManifest from "../package.json" with { type: "json" };

interface CliManagedRuntime {
  close: () => Promise<void>;
  pid: number | undefined;
  waitForExit: () => Promise<CodexProcessExit>;
}

export interface CliDependencies {
  appVersion: string;
  checkCodexVersion: (binaryPath: string) => Promise<CodexVersionInfo>;
  locateCodexBinary: (options?: LocateCodexBinaryOptions) => Promise<CodexBinary>;
  nodeVersion: string;
  startCodexAppServer: (options?: StartCodexAppServerOptions) => Promise<CliManagedRuntime>;
}

export interface RunCliOptions {
  dependencies?: CliDependencies;
  signal?: AbortSignal;
  stderr?: (message: string) => void;
  stdout?: (message: string) => void;
}

interface ParsedCommandOptions {
  codexBin?: string;
  codexHome?: string;
  project?: string;
}

const defaultDependencies: CliDependencies = {
  appVersion: packageManifest.version,
  checkCodexVersion,
  locateCodexBinary,
  nodeVersion: process.versions.node,
  startCodexAppServer,
};

const HELP = `Usage: code-agent <command> [options]

Commands:
  code-agent start [--codex-bin <path>] [--codex-home <path>] [--project <path>]
  code-agent doctor [--codex-bin <path>]
  code-agent version
`;

function parseCommandOptions(
  args: readonly string[],
  allowedOptions: ReadonlySet<string>,
): ParsedCommandOptions {
  const parsed: ParsedCommandOptions = {};

  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    if (!option || !allowedOptions.has(option)) {
      throw new Error(`Unknown option: ${option ?? "<empty>"}`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${option}`);
    }

    if (option === "--codex-bin") {
      parsed.codexBin = value;
    } else if (option === "--codex-home") {
      parsed.codexHome = value;
    } else if (option === "--project") {
      parsed.project = value;
    }
  }

  return parsed;
}

function assertSupportedNodeVersion(version: string): void {
  const major = Number.parseInt(version.split(".")[0] ?? "", 10);
  if (!Number.isInteger(major) || major < 24) {
    throw new Error(`Node.js 24 or newer is required; found ${version}`);
  }
}

function createProcessShutdownSignal(): { cleanup: () => void; signal: AbortSignal } {
  const controller = new AbortController();
  const abort = (): void => {
    controller.abort();
  };
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);

  return {
    cleanup: () => {
      process.off("SIGINT", abort);
      process.off("SIGTERM", abort);
    },
    signal: controller.signal,
  };
}

async function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return;
  }
  await new Promise<void>((resolve) => {
    signal.addEventListener(
      "abort",
      () => {
        resolve();
      },
      { once: true },
    );
  });
}

async function runDoctor(
  args: readonly string[],
  dependencies: CliDependencies,
  stdout: (message: string) => void,
): Promise<number> {
  const options = parseCommandOptions(args, new Set(["--codex-bin"]));
  assertSupportedNodeVersion(dependencies.nodeVersion);
  stdout(`[ok] Node.js ${dependencies.nodeVersion}\n`);

  const binary = await dependencies.locateCodexBinary(
    options.codexBin ? { explicitPath: options.codexBin } : {},
  );
  const version = await dependencies.checkCodexVersion(binary.path);
  stdout(`[ok] Codex ${version.version} (${binary.path})\n`);
  return 0;
}

async function runStart(
  args: readonly string[],
  dependencies: CliDependencies,
  signal: AbortSignal | undefined,
  stdout: (message: string) => void,
): Promise<number> {
  const options = parseCommandOptions(args, new Set(["--codex-bin", "--codex-home", "--project"]));
  const ownedShutdown = signal ? null : createProcessShutdownSignal();
  const shutdownSignal = signal ?? ownedShutdown?.signal;
  if (!shutdownSignal) {
    throw new Error("Shutdown signal is unavailable");
  }

  try {
    const env = {
      ...process.env,
      ...(options.codexHome ? { CODEX_HOME: options.codexHome } : {}),
    };
    const runtime = await dependencies.startCodexAppServer({
      appVersion: dependencies.appVersion,
      env,
      ...(options.codexBin ? { binaryPath: options.codexBin } : {}),
      ...(options.project ? { cwd: options.project } : {}),
    });
    stdout(`CodeAgent App Server started (pid ${String(runtime.pid ?? "unknown")})\n`);

    // 同时观察退出信号和子进程，避免 App Server 崩溃后 CLI 继续空等。
    const outcome = await Promise.race([
      runtime.waitForExit().then((exit) => ({ exit, type: "process-exit" as const })),
      waitForAbort(shutdownSignal).then(() => ({ type: "shutdown" as const })),
    ]);
    if (outcome.type === "process-exit") {
      await runtime.close();
      const reason = outcome.exit.signal
        ? `signal ${outcome.exit.signal}`
        : `code ${String(outcome.exit.code)}`;
      throw new Error(`Codex App Server exited before shutdown with ${reason}`);
    }
    await runtime.close();
    return 0;
  } finally {
    ownedShutdown?.cleanup();
  }
}

export async function runCli(
  argv: readonly string[],
  options: RunCliOptions = {},
): Promise<number> {
  const dependencies = options.dependencies ?? defaultDependencies;
  const stdout = options.stdout ?? ((message: string) => process.stdout.write(message));
  const stderr = options.stderr ?? ((message: string) => process.stderr.write(message));
  const [command, ...args] = argv;

  try {
    if (!command || command === "--help" || command === "-h") {
      stdout(HELP);
      return 0;
    }
    if (command === "version") {
      if (args.length > 0) {
        throw new Error(`Unknown option: ${args[0] ?? "<empty>"}`);
      }
      stdout(`code-agent ${dependencies.appVersion}\n`);
      return 0;
    }
    if (command === "doctor") {
      return await runDoctor(args, dependencies, stdout);
    }
    if (command === "start") {
      return await runStart(args, dependencies, options.signal, stdout);
    }
    throw new Error(`Unknown command: ${command}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr(`[error] ${message}\n`);
    return 1;
  }
}
