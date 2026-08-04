import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  AgentRuntimeProvider,
  AgentSettingsRepository,
  ProjectRepository,
} from "@code-agent/core";
import {
  checkCodexVersion,
  createCodexRuntimeProvider,
  locateCodexBinary,
  startCodexAppServer,
  type CodexBinary,
  type CodexProcessExit,
  type CodexRpcClient,
  type CodexVersionInfo,
  type LocateCodexBinaryOptions,
  type StartCodexAppServerOptions,
} from "@code-agent/provider-codex";
import {
  createCodeAgentServer,
  SqliteStateRepository,
  type CodeAgentAccessOptions,
  type SqliteDatabaseDiagnostics,
} from "@code-agent/server";

import packageManifest from "../package.json" with { type: "json" };
import { openSystemBrowser } from "./system-browser.js";
import {
  DEFAULT_LAN_SESSION_TTL,
  generateLanPairingCode,
  listLanAccessUrls,
  parseSessionTtl,
} from "./lan-access.js";
import { selectSystemDirectory } from "./system-directory-picker.js";

interface CliManagedRuntime {
  client: CodexRpcClient;
  close: () => Promise<void>;
  waitForExit: () => Promise<CodexProcessExit>;
}

interface CliManagedServer {
  close: () => Promise<void>;
  listen: (options: { host: string; port: number }) => Promise<string>;
}

interface CliManagedStateRepository extends ProjectRepository, AgentSettingsRepository {
  close: () => Promise<void>;
  diagnose: () => Promise<SqliteDatabaseDiagnostics>;
}

interface CreateRuntimeProviderInput {
  client: CodexRpcClient;
}

interface CreateServerInput {
  access?: CodeAgentAccessOptions;
  projectRepository: ProjectRepository;
  provider: AgentRuntimeProvider;
  selectProjectDirectory: () => Promise<string | undefined>;
  settingsRepository: AgentSettingsRepository;
  staticRoot: string;
}

export interface CliDependencies {
  appVersion: string;
  checkCodexVersion: (binaryPath: string) => Promise<CodexVersionInfo>;
  createStateRepository: (databasePath: string) => Promise<CliManagedStateRepository>;
  createRuntimeProvider: (
    input: CreateRuntimeProviderInput,
  ) => AgentRuntimeProvider | Promise<AgentRuntimeProvider>;
  createServer: (input: CreateServerInput) => Promise<CliManagedServer>;
  generateLanPairingCode: () => string;
  listLanAccessUrls: (port: number) => readonly string[];
  locateCodexBinary: (options?: LocateCodexBinaryOptions) => Promise<CodexBinary>;
  nodeVersion: string;
  openBrowser: (url: string) => Promise<void>;
  selectProjectDirectory: () => Promise<string | undefined>;
  startCodexAppServer: (options?: StartCodexAppServerOptions) => Promise<CliManagedRuntime>;
  webRoot: string;
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
  lan?: boolean;
  sessionTtl?: string;
}

const defaultDependencies: CliDependencies = {
  appVersion: packageManifest.version,
  checkCodexVersion,
  createStateRepository: (databasePath) => SqliteStateRepository.open(databasePath),
  createRuntimeProvider: createCodexRuntimeProvider,
  createServer: createCodeAgentServer,
  generateLanPairingCode,
  listLanAccessUrls,
  locateCodexBinary,
  nodeVersion: process.versions.node,
  openBrowser: openSystemBrowser,
  selectProjectDirectory: selectSystemDirectory,
  startCodexAppServer,
  webRoot: fileURLToPath(new URL("../dist/web", import.meta.url)),
};

const HELP = `Usage: code-agent <command> [options]

Commands:
  code-agent start [--lan] [--session-ttl <duration>] [--codex-bin <path>] [--codex-home <path>]
  code-agent doctor [--codex-bin <path>] [--codex-home <path>]
  code-agent version
`;

function parseCommandOptions(
  args: readonly string[],
  valueOptions: ReadonlySet<string>,
  flagOptions: ReadonlySet<string> = new Set(),
): ParsedCommandOptions {
  const parsed: ParsedCommandOptions = {};
  const seen = new Set<string>();

  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (!option || (!valueOptions.has(option) && !flagOptions.has(option))) {
      throw new Error(`Unknown option: ${option ?? "<empty>"}`);
    }
    if (seen.has(option)) {
      throw new Error(`Duplicate option: ${option}`);
    }
    seen.add(option);
    if (flagOptions.has(option)) {
      if (option === "--lan") {
        parsed.lan = true;
      }
      continue;
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${option}`);
    }

    if (option === "--codex-bin") {
      parsed.codexBin = value;
    } else if (option === "--codex-home") {
      parsed.codexHome = value;
    } else if (option === "--session-ttl") {
      parsed.sessionTtl = value;
    }
    index += 1;
  }

  return parsed;
}

function assertSupportedNodeVersion(version: string): void {
  const major = Number.parseInt(version.split(".")[0] ?? "", 10);
  if (!Number.isInteger(major) || major < 24) {
    throw new Error(`Node.js 24 or newer is required; found ${version}`);
  }
}

function resolveCodexHome(options: ParsedCommandOptions): string {
  return options.codexHome ?? process.env["CODEX_HOME"] ?? join(homedir(), ".codex");
}

function assertDatabaseDiagnostics(diagnostics: SqliteDatabaseDiagnostics): void {
  if (!diagnostics.writable) {
    throw new Error("SQLite database is not writable");
  }
  if (diagnostics.migrationVersion < 1) {
    throw new Error("SQLite migrations are not applied");
  }
  if (diagnostics.integrityCheck !== "ok") {
    throw new Error(`SQLite integrity_check failed: ${diagnostics.integrityCheck}`);
  }
  if (diagnostics.journalMode.toLocaleLowerCase() !== "wal") {
    throw new Error(`SQLite journal_mode must be WAL; found ${diagnostics.journalMode}`);
  }
  if (
    !diagnostics.foreignKeys ||
    diagnostics.synchronous !== "normal" ||
    diagnostics.busyTimeout !== 5_000
  ) {
    throw new Error("SQLite PRAGMA configuration is invalid");
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
  const options = parseCommandOptions(args, new Set(["--codex-bin", "--codex-home"]));
  assertSupportedNodeVersion(dependencies.nodeVersion);
  stdout(`[ok] Node.js ${dependencies.nodeVersion}\n`);

  const binary = await dependencies.locateCodexBinary(
    options.codexBin ? { explicitPath: options.codexBin } : {},
  );
  const version = await dependencies.checkCodexVersion(binary.path);
  stdout(`[ok] Codex ${version.version} (${binary.path})\n`);
  const codexHome = resolveCodexHome(options);
  const stateRepository = await dependencies.createStateRepository(
    join(codexHome, "code-agent", "state.sqlite3"),
  );
  try {
    const diagnostics = await stateRepository.diagnose();
    assertDatabaseDiagnostics(diagnostics);
    stdout(`[ok] SQLite writable (${join(codexHome, "code-agent", "state.sqlite3")})\n`);
    stdout(`[ok] SQLite migration ${String(diagnostics.migrationVersion)}\n`);
    stdout(`[ok] SQLite integrity_check ${diagnostics.integrityCheck}\n`);
    stdout(`[ok] SQLite journal_mode ${diagnostics.journalMode}\n`);
    stdout(
      `[ok] SQLite PRAGMA foreign_keys=ON synchronous=NORMAL busy_timeout=${String(diagnostics.busyTimeout)}\n`,
    );
  } finally {
    await stateRepository.close();
  }
  return 0;
}

async function runStart(
  args: readonly string[],
  dependencies: CliDependencies,
  signal: AbortSignal | undefined,
  stderr: (message: string) => void,
  stdout: (message: string) => void,
): Promise<number> {
  const options = parseCommandOptions(
    args,
    new Set(["--codex-bin", "--codex-home", "--session-ttl"]),
    new Set(["--lan"]),
  );
  if (options.sessionTtl !== undefined && options.lan !== true) {
    throw new Error("--session-ttl can only be used with --lan");
  }
  const sessionTtlText = options.sessionTtl ?? DEFAULT_LAN_SESSION_TTL;
  const sessionTtlMs = options.lan === true ? parseSessionTtl(sessionTtlText) : undefined;
  const access =
    sessionTtlMs === undefined
      ? undefined
      : {
          pairingCode: dependencies.generateLanPairingCode(),
          sessionTtlMs,
        };
  const ownedShutdown = signal ? null : createProcessShutdownSignal();
  const shutdownSignal = signal ?? ownedShutdown?.signal;
  if (!shutdownSignal) {
    throw new Error("Shutdown signal is unavailable");
  }

  let runtime: CliManagedRuntime | undefined;
  let server: CliManagedServer | undefined;
  let stateRepository: CliManagedStateRepository | undefined;

  try {
    const codexHome = resolveCodexHome(options);
    const env = {
      ...process.env,
      ...(options.codexHome ? { CODEX_HOME: options.codexHome } : {}),
    };
    stateRepository = await dependencies.createStateRepository(
      join(codexHome, "code-agent", "state.sqlite3"),
    );
    runtime = await dependencies.startCodexAppServer({
      appVersion: dependencies.appVersion,
      env,
      ...(options.codexBin ? { binaryPath: options.codexBin } : {}),
    });
    const provider = await dependencies.createRuntimeProvider({
      client: runtime.client,
    });
    server = await dependencies.createServer({
      ...(access === undefined ? {} : { access }),
      projectRepository: stateRepository,
      provider,
      selectProjectDirectory: dependencies.selectProjectDirectory,
      settingsRepository: stateRepository,
      staticRoot: dependencies.webRoot,
    });
    await server.listen({ host: options.lan === true ? "0.0.0.0" : "127.0.0.1", port: 3210 });

    if (access !== undefined) {
      const urls = dependencies.listLanAccessUrls(3210);
      stdout("[warn] Trusted LAN HTTP access is unencrypted.\n");
      if (urls.length === 0) {
        stderr("[warn] No external IPv4 LAN address was found; the server is still running.\n");
      } else {
        stdout(`LAN URLs:\n${urls.map((url) => `  ${url}`).join("\n")}\n`);
      }
      stdout(`Pairing code: ${access.pairingCode}\n`);
      stdout(`Session lifetime: ${sessionTtlText} (absolute, no renewal)\n`);
      stdout("Restarting CodeAgent invalidates this code and all LAN sessions.\n");
    }

    if (options.lan !== true) {
      try {
        await dependencies.openBrowser("http://127.0.0.1:3210");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        stderr(`[warn] Failed to open browser: ${message}\n`);
      }
    }

    // 同时观察退出信号和子进程，避免 App Server 崩溃后 CLI 继续空等。
    const outcome = await Promise.race([
      runtime.waitForExit().then((exit) => ({ exit, type: "process-exit" as const })),
      waitForAbort(shutdownSignal).then(() => ({ type: "shutdown" as const })),
    ]);
    if (outcome.type === "process-exit") {
      const reason = outcome.exit.signal
        ? `signal ${outcome.exit.signal}`
        : `code ${String(outcome.exit.code)}`;
      throw new Error(`Codex App Server exited before shutdown with ${reason}`);
    }
    return 0;
  } finally {
    // 每层 finally 都保证后续资源被回收，避免单个关闭错误遗留长驻进程。
    try {
      await server?.close();
    } finally {
      try {
        await stateRepository?.close();
      } finally {
        try {
          await runtime?.close();
        } finally {
          ownedShutdown?.cleanup();
        }
      }
    }
  }
}

export async function runCli(
  argv: readonly string[],
  options: RunCliOptions = {},
): Promise<number> {
  const dependencies = options.dependencies ?? defaultDependencies;
  const stdout = options.stdout ?? ((message: string) => process.stdout.write(message));
  const stderr = options.stderr ?? ((message: string) => process.stderr.write(message));
  const [command, ...rawArgs] = argv;
  // `pnpm run <script> -- ...` 会把分隔符传给脚本；只剥离命令后的首个分隔符。
  const args = rawArgs[0] === "--" ? rawArgs.slice(1) : rawArgs;

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
      return await runStart(args, dependencies, options.signal, stderr, stdout);
    }
    throw new Error(`Unknown command: ${command}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr(`[error] ${message}\n`);
    return 1;
  }
}
