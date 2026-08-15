import { chmod, lstat, mkdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  locateCodexBinary,
  openNodeEngine,
  type CodeAgentEngine,
  type LocateCodexBinaryOptions,
  type NodeEngineDiagnostic,
  type NodeEngineOptions,
  type NodeProcessExit,
} from "@code-agent/engine-node";
import {
  createCodeAgentServer,
  normalizeAllowedHost,
  type CodeAgentAccessOptions,
} from "@code-agent/server";

import packageManifest from "../package.json" with { type: "json" };
import { createAppUpdateService } from "./app-update.js";
import { CLI_HELP, parseCommandOptions, type ParsedCommandOptions } from "./cli-command-options.js";
import {
  confirmTerminalAppUpdate,
  createStartupAppUpdateOperations,
  restartCliAfterUpdate,
  STARTUP_UPDATE_APPLIED_ENV,
  type StartupAppUpdateCheck,
} from "./cli-startup-update.js";
import { openSystemBrowser } from "./system-browser.js";
import { createTerminalOutput, type TerminalOutput } from "./terminal-output.js";
import {
  generateLanPairingCode,
  listLanAccessUrls,
  parseSessionTtl,
  validateLanPassword,
} from "./lan-access.js";

interface CliManagedEngine extends CodeAgentEngine {
  close: () => Promise<void>;
  diagnose: () => Promise<NodeEngineDiagnostic>;
  waitForExit: () => Promise<NodeProcessExit>;
}

interface CliManagedServer {
  close: () => Promise<void>;
  listen: (options: { host: string; port: number }) => Promise<string>;
}

const MAX_TCP_PORT = 65_535;

interface CreateServerInput {
  access?: CodeAgentAccessOptions;
  allowedHosts?: readonly string[];
  engine: CodeAgentEngine;
  installAppUpdate: ReturnType<typeof createAppUpdateService>["install"];
  readAppInfo: ReturnType<typeof createAppUpdateService>["read"];
  staticRoot: string;
}

export interface CliDependencies {
  appVersion: string;
  checkAppUpdate: () => Promise<StartupAppUpdateCheck>;
  confirmAppUpdate: (currentVersion: string, latestVersion: string) => Promise<boolean>;
  createEngine: (options: NodeEngineOptions) => Promise<CliManagedEngine>;
  createServer: (input: CreateServerInput) => Promise<CliManagedServer>;
  ensureTemporaryWorkspace: (path: string) => Promise<string>;
  generateLanPairingCode: () => string;
  listLanAccessUrls: (port: number) => readonly string[];
  locateCodexBinary: (options?: LocateCodexBinaryOptions) => Promise<string>;
  nodeVersion: string;
  openBrowser: (url: string) => Promise<void>;
  installAppUpdate: (version: string) => Promise<void>;
  restartAfterUpdate: (args: readonly string[]) => Promise<number>;
  webRoot: string;
}

export interface RunCliOptions {
  color?: boolean;
  dependencies?: CliDependencies;
  signal?: AbortSignal;
  stderr?: (message: string) => void;
  stdout?: (message: string) => void;
}

const startupAppUpdate = createStartupAppUpdateOperations(packageManifest.version);

const defaultDependencies: CliDependencies = {
  appVersion: packageManifest.version,
  checkAppUpdate: startupAppUpdate.check,
  confirmAppUpdate: confirmTerminalAppUpdate,
  createEngine: openNodeEngine,
  createServer: async (input) => {
    const server = await createCodeAgentServer({
      ...input,
    });
    return {
      close: () => server.close(),
      listen: (options) => server.listen(options),
    };
  },
  ensureTemporaryWorkspace,
  generateLanPairingCode,
  listLanAccessUrls,
  locateCodexBinary,
  nodeVersion: process.versions.node,
  openBrowser: openSystemBrowser,
  installAppUpdate: startupAppUpdate.install,
  restartAfterUpdate: restartCliAfterUpdate,
  webRoot: fileURLToPath(new URL("../dist/web", import.meta.url)),
};

export async function ensureTemporaryWorkspace(path: string): Promise<string> {
  await mkdir(path, { mode: 0o700, recursive: true });
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink()) {
    throw new Error("Temporary workspace must not be a symbolic link");
  }
  if (!metadata.isDirectory()) {
    throw new Error("Temporary workspace path must be a directory");
  }
  // 共享隐藏目录只承载只读临时聊天，限制其他本机账号访问其运行时元数据。
  await chmod(path, 0o700);
  return realpath(path);
}

function assertSupportedNodeVersion(version: string): void {
  const major = Number.parseInt(version.split(".")[0] ?? "", 10);
  if (!Number.isInteger(major) || major < 24) {
    throw new Error(`需要 Node.js 24 或更高版本，当前版本为 ${version}`);
  }
}

function isAddressInUseError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "EADDRINUSE"
  );
}

async function listenOnAvailablePort(
  server: CliManagedServer,
  host: string,
  initialPort: number,
): Promise<number> {
  // 直接尝试监听可避免“先探测、后监听”之间被其他进程抢占端口的竞态。
  for (let port = initialPort; port <= MAX_TCP_PORT; port += 1) {
    try {
      await server.listen({ host, port });
      return port;
    } catch (error) {
      if (!isAddressInUseError(error) || port === MAX_TCP_PORT) {
        throw error;
      }
    }
  }

  throw new Error(`端口 ${String(initialPort)} 到 ${String(MAX_TCP_PORT)} 均不可用`);
}

function resolveCodexHome(options: ParsedCommandOptions): string {
  return options.codexHome ?? process.env["CODEX_HOME"] ?? join(homedir(), ".codex");
}

function resolveCodeAgentDataRoot(): string {
  // CodeAgent 数据独立于 Codex 配置，确保 CLI 与 Desktop 始终共享同一持久化目录。
  return join(homedir(), ".code-agent");
}

function assertDatabaseDiagnostics(diagnostics: NodeEngineDiagnostic): void {
  if (diagnostics.migrationVersion < 1) {
    throw new Error("SQLite migrations are not applied");
  }
  if (diagnostics.integrityCheck !== "ok") {
    throw new Error(`SQLite integrity_check failed: ${diagnostics.integrityCheck}`);
  }
  if (diagnostics.journalMode.toLocaleLowerCase() !== "wal") {
    throw new Error(`SQLite journal_mode must be WAL; found ${diagnostics.journalMode}`);
  }
  if (!diagnostics.foreignKeys) {
    throw new Error("SQLite PRAGMA configuration is invalid");
  }
}

function engineOptions(
  dependencies: CliDependencies,
  codexPath: string,
  codexHome: string,
  dataRoot: string,
  temporaryWorkspace: string,
): NodeEngineOptions {
  return {
    appVersion: dependencies.appVersion,
    attachmentRoot: join(dataRoot, "attachments"),
    codexHome,
    codexPath,
    databasePath: join(dataRoot, "state.sqlite3"),
    temporaryWorkspace,
  };
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
  output: TerminalOutput,
): Promise<number> {
  const options = parseCommandOptions(args, new Set(["--codex-bin", "--codex-home"]));
  assertSupportedNodeVersion(dependencies.nodeVersion);
  output.success(`Node.js ${dependencies.nodeVersion}`);

  const codexPath = await dependencies.locateCodexBinary(
    options.codexBin ? { explicitPath: options.codexBin } : {},
  );
  const codexHome = resolveCodexHome(options);
  const dataRoot = resolveCodeAgentDataRoot();
  const temporaryWorkspace = await dependencies.ensureTemporaryWorkspace(
    join(dataRoot, "temporary-workspace"),
  );
  const engine = await dependencies.createEngine(
    engineOptions(dependencies, codexPath, codexHome, dataRoot, temporaryWorkspace),
  );
  try {
    const diagnostics = await engine.diagnose();
    assertDatabaseDiagnostics(diagnostics);
    output.success(`Codex ${diagnostics.codexVersion} (${codexPath})`);
    output.success(`SQLite 可写 (${join(dataRoot, "state.sqlite3")})`);
    output.success(`SQLite migration ${String(diagnostics.migrationVersion)}`);
    output.success(`SQLite integrity_check ${diagnostics.integrityCheck}`);
    output.success(`SQLite journal_mode ${diagnostics.journalMode}`);
    output.success("SQLite PRAGMA foreign_keys=ON synchronous=NORMAL busy_timeout=5000");
  } finally {
    await engine.close();
  }
  return 0;
}

async function runStart(
  args: readonly string[],
  dependencies: CliDependencies,
  signal: AbortSignal | undefined,
  output: TerminalOutput,
): Promise<number> {
  const options = parseCommandOptions(
    args,
    new Set([
      "--allowed-host",
      "--codex-bin",
      "--codex-home",
      "--lan-password",
      "--port",
      "--session-ttl",
    ]),
    new Set(["--lan"]),
  );
  if (options.sessionTtl !== undefined && options.lan !== true) {
    throw new Error("--session-ttl 只能与 --lan 一起使用");
  }
  if (options.lanPassword !== undefined && options.lan !== true) {
    throw new Error("--lan-password 只能与 --lan 一起使用");
  }
  if (options.lanPassword !== undefined) {
    validateLanPassword(options.lanPassword);
  }
  const allowedHosts = options.allowedHosts?.map(normalizeAllowedHost);
  const port = options.port ?? 3210;
  const sessionTtlMs = options.sessionTtl ? parseSessionTtl(options.sessionTtl) : undefined;
  const access =
    options.lan !== true
      ? undefined
      : {
          pairingCode: options.lanPassword ?? dependencies.generateLanPairingCode(),
          ...(sessionTtlMs === undefined ? {} : { sessionTtlMs }),
        };

  if (process.env[STARTUP_UPDATE_APPLIED_ENV] !== "1") {
    const update = await dependencies.checkAppUpdate();
    if (update.status === "check-failed") {
      output.warning(update.error ?? "无法检查 CodeAgent 更新，将继续启动当前版本。");
    } else if (update.status === "available" && update.latestVersion !== null) {
      const shouldUpdate = await dependencies.confirmAppUpdate(
        dependencies.appVersion,
        update.latestVersion,
      );
      if (shouldUpdate) {
        output.info(`正在更新 CodeAgent 到 ${update.latestVersion}...`);
        await dependencies.installAppUpdate(update.latestVersion);
        output.success(`CodeAgent 已更新到 ${update.latestVersion}，正在重新启动。`);
        return dependencies.restartAfterUpdate(["start", ...args]);
      }
      output.info("已跳过更新，继续启动当前版本。");
    }
  }

  const ownedShutdown = signal ? null : createProcessShutdownSignal();
  const shutdownSignal = signal ?? ownedShutdown?.signal;
  if (!shutdownSignal) {
    throw new Error("Shutdown signal is unavailable");
  }

  let engine: CliManagedEngine | undefined;
  let server: CliManagedServer | undefined;

  try {
    const codexHome = resolveCodexHome(options);
    const dataRoot = resolveCodeAgentDataRoot();
    const temporaryWorkspace = await dependencies.ensureTemporaryWorkspace(
      join(dataRoot, "temporary-workspace"),
    );
    const codexPath = await dependencies.locateCodexBinary(
      options.codexBin ? { explicitPath: options.codexBin } : {},
    );
    engine = await dependencies.createEngine(
      engineOptions(dependencies, codexPath, codexHome, dataRoot, temporaryWorkspace),
    );
    const diagnostics = await engine.diagnose();
    const appUpdateService = createAppUpdateService({
      appVersion: dependencies.appVersion,
      codexVersion: diagnostics.codexVersion,
    });
    server = await dependencies.createServer({
      ...(access === undefined ? {} : { access }),
      ...(allowedHosts === undefined ? {} : { allowedHosts }),
      engine,
      installAppUpdate: appUpdateService.install,
      readAppInfo: appUpdateService.read,
      staticRoot: dependencies.webRoot,
    });
    const host = options.lan === true ? "0.0.0.0" : "127.0.0.1";
    const activePort = await listenOnAvailablePort(server, host, port);
    if (activePort !== port) {
      output.warning(`端口 ${String(port)} 已被占用，已自动切换到端口 ${String(activePort)}。`);
    }
    output.success("CodeAgent 已启动");

    if (access !== undefined) {
      const urls = dependencies.listLanAccessUrls(activePort);
      output.warning("局域网模式使用未加密的 HTTP，请仅在可信网络中使用。");
      if (urls.length === 0) {
        output.warning("未找到可用的局域网 IPv4 地址，服务仍在运行。");
      } else {
        output.info(`局域网访问地址:\n${urls.map((url) => `  ${url}`).join("\n")}`);
      }
      if (options.lanPassword === undefined) {
        output.info(`配对码: ${access.pairingCode}`);
      } else {
        output.info("已使用自定义访问密码（不会在终端回显）。");
      }
      output.info(
        options.sessionTtl === undefined
          ? "会话有效期: 永不过期（仅当前进程）"
          : `会话有效期: ${options.sessionTtl}（固定期限，不自动续期）`,
      );
      output.info("重启 CodeAgent 后，当前配对码和所有局域网会话将失效。");
    } else {
      output.info(`访问地址: http://127.0.0.1:${String(activePort)}`);
    }

    if (options.lan !== true) {
      try {
        await dependencies.openBrowser(`http://127.0.0.1:${String(activePort)}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        output.warning(`无法自动打开浏览器，请手动访问上述地址。原因: ${message}`);
      }
    }

    // 同时观察退出信号和子进程，避免 App Server 崩溃后 CLI 继续空等。
    const outcome = await Promise.race([
      engine.waitForExit().then((exit) => ({ exit, type: "process-exit" as const })),
      waitForAbort(shutdownSignal).then(() => ({ type: "shutdown" as const })),
    ]);
    if (outcome.type === "process-exit") {
      const reason =
        outcome.exit.signal === undefined
          ? `退出码 ${String(outcome.exit.code)}`
          : `信号 ${String(outcome.exit.signal)}`;
      throw new Error(`Codex App Server 在 CodeAgent 关闭前意外退出，${reason}`);
    }
    return 0;
  } finally {
    // Server 先断开请求和订阅；Engine close 幂等，兼顾 Server 尚未创建的失败路径。
    try {
      await server?.close();
    } finally {
      try {
        await engine?.close();
      } finally {
        ownedShutdown?.cleanup();
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
  const colorEnabled =
    options.color ?? (process.stdout.isTTY && process.env["NO_COLOR"] === undefined);
  const output = createTerminalOutput(stdout, stderr, colorEnabled);
  const [requestedCommand, ...rawArgs] = argv;
  // 空参数使用主启动流程，使直接执行 `code-agent` 与显式 `code-agent start` 完全一致。
  const command = requestedCommand ?? "start";
  // `pnpm run <script> -- ...` 会把分隔符传给脚本；只剥离命令后的首个分隔符。
  const args = rawArgs[0] === "--" ? rawArgs.slice(1) : rawArgs;

  try {
    if (command === "--help" || command === "-h") {
      output.plain(CLI_HELP);
      return 0;
    }
    if (command === "version") {
      if (args.length > 0) {
        throw new Error(`未知选项: ${args[0] ?? "<empty>"}`);
      }
      output.plain(`code-agent ${dependencies.appVersion}\n`);
      return 0;
    }
    if (command === "doctor") {
      return await runDoctor(args, dependencies, output);
    }
    if (command === "start") {
      return await runStart(args, dependencies, options.signal, output);
    }
    throw new Error(`未知命令: ${command}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    output.error(message);
    return 1;
  }
}
