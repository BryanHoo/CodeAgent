import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ensureTemporaryWorkspace, runCli, type CliDependencies } from "./cli-command.js";
import { STARTUP_UPDATE_APPLIED_ENV } from "./cli-startup-update.js";

const temporaryDirectories: string[] = [];

beforeEach(() => {
  // CLI 测试默认模拟首次启动，不能继承调用测试进程时残留的重启标记。
  vi.stubEnv(STARTUP_UPDATE_APPLIED_ENV, "0");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

function createHarness(overrides: Partial<CliDependencies> = {}) {
  const lifecycle: string[] = [];
  let resolveExit!: (exit: { code: number | null; signal: NodeJS.Signals | null }) => void;
  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    resolveExit = resolve;
  });
  const close = vi.fn(() => {
    lifecycle.push("runtime.close");
    resolveExit({ code: 0, signal: null });
    return Promise.resolve();
  });
  const serverClose = vi.fn(() => {
    lifecycle.push("server.close");
    return Promise.resolve();
  });
  const databaseClose = vi.fn(() => {
    lifecycle.push("database.close");
    return Promise.resolve();
  });
  const serverListen = vi.fn(() => {
    lifecycle.push("server.listen");
    return Promise.resolve("http://127.0.0.1:3210");
  });
  const client = {
    notify: vi.fn(),
    onNotification: vi.fn(() => () => undefined),
    onServerRequest: vi.fn(() => () => undefined),
    rejectServerRequest: vi.fn(() => Promise.resolve()),
    request: vi.fn(),
    respondToServerRequest: vi.fn(),
  };
  const provider = {
    archiveTask: vi.fn(),
    compactTask: vi.fn(),
    forkTask: vi.fn(),
    getCapabilities: vi.fn(),
    interruptTurn: vi.fn(),
    listBackgroundTerminals: vi.fn(),
    listMcpServers: vi.fn(),
    listModels: vi.fn(),
    listSkills: vi.fn(),
    listTasks: vi.fn(),
    pinTask: vi.fn(),
    readSandboxMode: vi.fn(() => Promise.resolve("workspace-write" as const)),
    readTask: vi.fn(),
    readTaskAttachment: vi.fn(() => Promise.resolve(undefined)),
    reloadMcpServers: vi.fn(),
    renameTask: vi.fn(),
    resolvePendingRequest: vi.fn(),
    startTask: vi.fn(),
    startReview: vi.fn(),
    startTurn: vi.fn(),
    steerTurn: vi.fn(),
    subscribeEvents: vi.fn(() => () => undefined),
    terminateBackgroundTerminal: vi.fn(),
    unsubscribeTask: vi.fn(),
    uploadFeedback: vi.fn(),
  };
  const runtimeProvider = {
    cancelProviderLogin: vi.fn(() =>
      Promise.resolve({
        status: {
          account: null,
          customBaseUrl: null,
          mode: "official" as const,
          pendingLogin: null,
          state: "disconnected" as const,
        },
      }),
    ),
    configureCustomProvider: vi.fn(() => Promise.reject(new Error("Not configured"))),
    forProject: vi.fn(() => provider),
    getCapabilities: provider.getCapabilities,
    listModels: provider.listModels,
    logoutProvider: vi.fn(() =>
      Promise.resolve({
        status: {
          account: null,
          customBaseUrl: null,
          mode: "official" as const,
          pendingLogin: null,
          state: "disconnected" as const,
        },
      }),
    ),
    readDefaultSettings: vi.fn(() => Promise.resolve({})),
    readProviderConnection: vi.fn(() =>
      Promise.resolve({
        account: null,
        customBaseUrl: null,
        mode: "official" as const,
        pendingLogin: null,
        state: "disconnected" as const,
      }),
    ),
    releaseProject: vi.fn(() => Promise.resolve()),
    startOfficialProviderLogin: vi.fn(() => Promise.reject(new Error("Not configured"))),
  };
  const project = {
    createdAt: "2026-07-23T00:00:00.000Z",
    id: "project",
    name: "project",
    rootPath: "/workspace/project",
  };
  const stateRepository = {
    close: databaseClose,
    diagnose: vi.fn(() =>
      Promise.resolve({
        busyTimeout: 5_000,
        foreignKeys: true,
        integrityCheck: "ok",
        journalMode: "wal",
        migrationVersion: 4,
        synchronous: "normal",
        writable: true,
      }),
    ),
    ensureTemporaryProject: vi.fn(() =>
      Promise.resolve({
        createdAt: "2026-07-23T00:00:00.000Z",
        id: "temporary",
        name: "Temporary",
        rootPath: "/custom/home/code-agent/temporary-workspace",
      }),
    ),
    list: vi.fn(() => Promise.resolve([])),
    readGlobalSettings: vi.fn(() => Promise.resolve(undefined)),
    readProviderConnection: vi.fn(() => Promise.resolve(undefined)),
    readProjectDefaults: vi.fn(() => Promise.resolve(undefined)),
    readTaskSettings: vi.fn(() => Promise.resolve(undefined)),
    read: vi.fn(() => Promise.resolve(undefined)),
    register: vi.fn(),
    remove: vi.fn(() => Promise.resolve(false)),
    rename: vi.fn(() => Promise.resolve(undefined)),
    reorder: vi.fn(() => Promise.resolve([])),
    writeGlobalSettings: vi.fn((settings) => Promise.resolve(settings)),
    writeProviderConnection: vi.fn((record) => Promise.resolve(record)),
    writeProjectDefaults: vi.fn((_projectId, settings) => Promise.resolve(settings)),
    writeTaskSettings: vi.fn((_projectId, _taskId, settings) => Promise.resolve(settings)),
  };
  const dependencies: CliDependencies = {
    appVersion: "1.2.3",
    checkAppUpdate: vi.fn(() =>
      Promise.resolve({ latestVersion: "1.2.3", status: "current" as const }),
    ),
    checkCodexVersion: vi.fn(() =>
      Promise.resolve({ raw: "codex-cli 0.148.0", version: "0.148.0" }),
    ),
    confirmAppUpdate: vi.fn(() => Promise.resolve(false)),
    createStateRepository: vi.fn(() => Promise.resolve(stateRepository)),
    createRuntimeProvider: vi.fn(() => {
      lifecycle.push("provider.create");
      return runtimeProvider;
    }),
    ensureTemporaryWorkspace: vi.fn((path: string) => Promise.resolve(path)),
    generateLanPairingCode: vi.fn(() => "fixed-test-pairing-code"),
    listLanAccessUrls: vi.fn((port: number) => [`http://192.168.1.20:${String(port)}`]),
    createServer: vi.fn(() => Promise.resolve({ close: serverClose, listen: serverListen })),
    locateCodexBinary: vi.fn(() =>
      Promise.resolve({ path: "/fake/codex", source: "explicit" as const }),
    ),
    nodeVersion: "22.13.0",
    openBrowser: vi.fn(() => {
      lifecycle.push("browser.open");
      return Promise.resolve();
    }),
    installAppUpdate: vi.fn(() => Promise.resolve()),
    restartAfterUpdate: vi.fn(() => Promise.resolve(0)),
    startCodexAppServer: vi.fn(() =>
      Promise.resolve({
        client,
        close,
        pid: 4321,
        version: { raw: "codex-cli 0.148.0", version: "0.148.0" },
        waitForExit: () => exit,
      }),
    ),
    webRoot: "/package/dist/web",
    ...overrides,
  };
  const stderr: string[] = [];
  const stdout: string[] = [];

  return {
    close,
    client,
    databaseClose,
    dependencies,
    lifecycle,
    options: {
      dependencies,
      stderr: (message: string) => {
        stderr.push(message);
      },
      stdout: (message: string) => {
        stdout.push(message);
      },
    },
    project,
    stateRepository,
    provider,
    runtimeProvider,
    stderr,
    serverClose,
    serverListen,
    stdout,
  };
}

describe("runCli", () => {
  it("creates a private temporary workspace and rejects a symbolic-link target", async () => {
    const root = await mkdtemp(join(tmpdir(), "code-agent-cli-"));
    temporaryDirectories.push(root);
    const workspace = join(root, "temporary-workspace");

    const createdWorkspace = await ensureTemporaryWorkspace(workspace);
    await expect(realpath(workspace)).resolves.toBe(createdWorkspace);
    await expect(ensureTemporaryWorkspace(workspace)).resolves.toBe(createdWorkspace);

    const target = join(root, "target");
    const alias = join(root, "alias");
    await mkdir(target);
    await symlink(target, alias);
    await expect(ensureTemporaryWorkspace(alias)).rejects.toThrow(/symbolic link/u);
  });

  it("prints the CodeAgent version", async () => {
    const harness = createHarness();

    await expect(runCli(["version"], harness.options)).resolves.toBe(0);
    expect(harness.stdout.join("")).toBe("code-agent 1.2.3\n");
    expect(harness.stderr).toEqual([]);
  });

  it("checks Node.js, Codex, and SQLite diagnostics in doctor", async () => {
    const harness = createHarness();

    await expect(
      runCli(
        ["doctor", "--codex-bin", "/custom/codex", "--codex-home", "/custom/home"],
        harness.options,
      ),
    ).resolves.toBe(0);
    expect(harness.dependencies.locateCodexBinary).toHaveBeenCalledWith({
      explicitPath: "/custom/codex",
    });
    expect(harness.dependencies.checkCodexVersion).toHaveBeenCalledWith("/fake/codex");
    expect(harness.stdout.join("")).toContain("[成功] Node.js 22.13.0");
    expect(harness.stdout.join("")).toContain("[成功] Codex 0.148.0 (/fake/codex)");
    expect(harness.dependencies.createStateRepository).toHaveBeenCalledWith(
      join("/custom/home", "code-agent", "state.sqlite3"),
    );
    expect(harness.stdout.join("")).toContain("[成功] SQLite 可写");
    expect(harness.stdout.join("")).toContain("[成功] SQLite migration 4");
    expect(harness.stdout.join("")).toContain("[成功] SQLite integrity_check ok");
    expect(harness.stdout.join("")).toContain("[成功] SQLite journal_mode wal");
    expect(harness.databaseClose).toHaveBeenCalledOnce();
  });

  it("returns a non-zero code when doctor finds an unsupported Node.js", async () => {
    const harness = createHarness({ nodeVersion: "22.12.0" });

    await expect(runCli(["doctor"], harness.options)).resolves.toBe(1);
    expect(harness.stderr.join("")).toContain("需要 Node.js 22.13.0 或更高版本");
    expect(harness.dependencies.locateCodexBinary).not.toHaveBeenCalled();
  });

  it("closes SQLite when doctor diagnostics fail", async () => {
    const harness = createHarness();
    harness.stateRepository.diagnose.mockRejectedValue(new Error("integrity unavailable"));

    await expect(runCli(["doctor"], harness.options)).resolves.toBe(1);

    expect(harness.databaseClose).toHaveBeenCalledOnce();
    expect(harness.stderr.join("")).toContain("integrity unavailable");
  });

  it("starts Codex, HTTP, and static Web then closes on abort", async () => {
    const harness = createHarness();
    const controller = new AbortController();
    const run = runCli(["start", "--codex-bin", "/custom/codex", "--codex-home", "/custom/home"], {
      ...harness.options,
      signal: controller.signal,
    });

    await vi.waitFor(() => {
      expect(harness.dependencies.createServer).toHaveBeenCalledOnce();
    });
    const [startOptions] = vi.mocked(harness.dependencies.startCodexAppServer).mock.calls[0] ?? [];
    expect(startOptions).toMatchObject({
      appVersion: "1.2.3",
      binaryPath: "/custom/codex",
    });
    expect(startOptions).not.toHaveProperty("cwd");
    expect(startOptions?.env?.["CODEX_HOME"]).toBe("/custom/home");
    expect(harness.dependencies.createRuntimeProvider).toHaveBeenCalledWith({
      client: harness.client,
    });
    const [serverOptions] = vi.mocked(harness.dependencies.createServer).mock.calls[0] ?? [];
    expect(serverOptions).toMatchObject({
      projectRepository: harness.stateRepository,
      providerConnectionRepository: harness.stateRepository,
      provider: harness.runtimeProvider,
      settingsRepository: harness.stateRepository,
      staticRoot: "/package/dist/web",
    });
    expect(typeof serverOptions?.installAppUpdate).toBe("function");
    expect(typeof serverOptions?.readAppInfo).toBe("function");
    expect(harness.dependencies.createStateRepository).toHaveBeenCalledWith(
      join("/custom/home", "code-agent", "state.sqlite3"),
    );
    expect(harness.dependencies.ensureTemporaryWorkspace).toHaveBeenCalledWith(
      join("/custom/home", "code-agent", "temporary-workspace"),
    );
    expect(harness.stateRepository.ensureTemporaryProject).toHaveBeenCalledWith(
      join("/custom/home", "code-agent", "temporary-workspace"),
    );
    expect(harness.serverListen).toHaveBeenCalledWith({ host: "127.0.0.1", port: 3210 });
    expect(harness.dependencies.openBrowser).toHaveBeenCalledWith("http://127.0.0.1:3210");
    expect(harness.stdout.join("")).toContain("[成功] CodeAgent 已启动");
    expect(harness.stdout.join("")).toContain("访问地址: http://127.0.0.1:3210");

    controller.abort();

    await expect(run).resolves.toBe(0);
    expect(harness.close).toHaveBeenCalledOnce();
    expect(harness.serverClose).toHaveBeenCalledOnce();
    expect(harness.lifecycle).toEqual([
      "provider.create",
      "server.listen",
      "browser.open",
      "server.close",
      "database.close",
      "runtime.close",
    ]);
  });

  it("defaults to start when no command is provided", async () => {
    const harness = createHarness();
    const controller = new AbortController();
    const run = runCli([], { ...harness.options, signal: controller.signal });

    await vi.waitFor(() => {
      expect(harness.serverListen).toHaveBeenCalledWith({ host: "127.0.0.1", port: 3210 });
    });
    expect(harness.dependencies.startCodexAppServer).toHaveBeenCalledOnce();
    expect(harness.dependencies.openBrowser).toHaveBeenCalledWith("http://127.0.0.1:3210");

    controller.abort();
    await expect(run).resolves.toBe(0);
  });

  it("asks about an available update and starts normally when the user declines", async () => {
    const confirmAppUpdate = vi.fn(() => Promise.resolve(false));
    const harness = createHarness({
      checkAppUpdate: vi.fn(() =>
        Promise.resolve({ latestVersion: "1.3.0", status: "available" as const }),
      ),
      confirmAppUpdate,
    });
    const controller = new AbortController();
    const run = runCli(["start"], { ...harness.options, signal: controller.signal });

    await vi.waitFor(() => {
      expect(harness.serverListen).toHaveBeenCalledOnce();
    });
    expect(confirmAppUpdate).toHaveBeenCalledWith("1.2.3", "1.3.0");
    expect(harness.dependencies.installAppUpdate).not.toHaveBeenCalled();
    expect(harness.dependencies.restartAfterUpdate).not.toHaveBeenCalled();

    controller.abort();
    await expect(run).resolves.toBe(0);
  });

  it("installs an accepted update and restarts with the original start arguments", async () => {
    const lifecycle: string[] = [];
    const harness = createHarness({
      checkAppUpdate: vi.fn(() =>
        Promise.resolve({ latestVersion: "1.3.0", status: "available" as const }),
      ),
      confirmAppUpdate: vi.fn(() => Promise.resolve(true)),
      installAppUpdate: vi.fn(() => {
        lifecycle.push("update.install");
        return Promise.resolve();
      }),
      restartAfterUpdate: vi.fn((args) => {
        lifecycle.push("cli.restart");
        expect(args).toEqual(["start", "--port", "4567"]);
        return Promise.resolve(0);
      }),
    });

    await expect(runCli(["start", "--port", "4567"], harness.options)).resolves.toBe(0);

    expect(lifecycle).toEqual(["update.install", "cli.restart"]);
    expect(harness.dependencies.installAppUpdate).toHaveBeenCalledWith("1.3.0");
    expect(harness.dependencies.createStateRepository).not.toHaveBeenCalled();
    expect(harness.dependencies.startCodexAppServer).not.toHaveBeenCalled();
    expect(harness.stdout.join("")).toContain("CodeAgent 已更新到 1.3.0");
  });

  it("skips the startup update check in the restarted process", async () => {
    vi.stubEnv(STARTUP_UPDATE_APPLIED_ENV, "1");
    const harness = createHarness();
    const controller = new AbortController();
    const run = runCli(["start"], { ...harness.options, signal: controller.signal });

    await vi.waitFor(() => {
      expect(harness.serverListen).toHaveBeenCalledOnce();
    });
    expect(harness.dependencies.checkAppUpdate).not.toHaveBeenCalled();

    controller.abort();
    await expect(run).resolves.toBe(0);
  });

  it("warns and continues startup when the update check fails", async () => {
    const harness = createHarness({
      checkAppUpdate: vi.fn(() =>
        Promise.resolve({ latestVersion: null, status: "check-failed" as const }),
      ),
    });
    const controller = new AbortController();
    const run = runCli(["start"], { ...harness.options, signal: controller.signal });

    await vi.waitFor(() => {
      expect(harness.serverListen).toHaveBeenCalledOnce();
    });
    expect(harness.stderr.join("")).toContain("无法检查 CodeAgent 更新");
    expect(harness.dependencies.confirmAppUpdate).not.toHaveBeenCalled();

    controller.abort();
    await expect(run).resolves.toBe(0);
  });

  it("starts on a custom port and uses it for the browser URL", async () => {
    const harness = createHarness();
    const controller = new AbortController();
    const run = runCli(["start", "--port", "4567"], {
      ...harness.options,
      signal: controller.signal,
    });

    await vi.waitFor(() => {
      expect(harness.serverListen).toHaveBeenCalledWith({ host: "127.0.0.1", port: 4567 });
    });
    expect(harness.dependencies.openBrowser).toHaveBeenCalledWith("http://127.0.0.1:4567");
    expect(harness.stdout.join("")).toContain("访问地址: http://127.0.0.1:4567");

    controller.abort();
    await expect(run).resolves.toBe(0);
  });

  it("increments the port until the HTTP server can listen", async () => {
    const harness = createHarness();
    const addressInUse = Object.assign(new Error("address already in use"), {
      code: "EADDRINUSE",
    });
    harness.serverListen
      .mockRejectedValueOnce(addressInUse)
      .mockRejectedValueOnce(addressInUse)
      .mockResolvedValueOnce("http://127.0.0.1:4569");
    const controller = new AbortController();
    const run = runCli(["start", "--port", "4567"], {
      ...harness.options,
      signal: controller.signal,
    });

    await vi.waitFor(() => {
      expect(harness.serverListen).toHaveBeenLastCalledWith({
        host: "127.0.0.1",
        port: 4569,
      });
    });
    expect(harness.serverListen.mock.calls).toEqual([
      [{ host: "127.0.0.1", port: 4567 }],
      [{ host: "127.0.0.1", port: 4568 }],
      [{ host: "127.0.0.1", port: 4569 }],
    ]);
    expect(harness.dependencies.openBrowser).toHaveBeenCalledWith("http://127.0.0.1:4569");
    expect(harness.stdout.join("")).toContain("访问地址: http://127.0.0.1:4569");
    expect(harness.stderr.join("")).toContain("端口 4567 已被占用，已自动切换到端口 4569");

    controller.abort();
    await expect(run).resolves.toBe(0);
  });

  it("does not retry unrelated listen errors or increment beyond the TCP port limit", async () => {
    const cases = [
      {
        error: Object.assign(new Error("permission denied"), { code: "EACCES" }),
        port: "4567",
      },
      {
        error: Object.assign(new Error("address already in use"), { code: "EADDRINUSE" }),
        port: "65535",
      },
    ];

    for (const testCase of cases) {
      const harness = createHarness();
      harness.serverListen.mockRejectedValueOnce(testCase.error);

      await expect(runCli(["start", "--port", testCase.port], harness.options)).resolves.toBe(1);
      expect(harness.serverListen).toHaveBeenCalledTimes(1);
      expect(harness.serverListen).toHaveBeenCalledWith({
        host: "127.0.0.1",
        port: Number(testCase.port),
      });
      expect(harness.stderr.join("")).toContain(testCase.error.message);
    }
  });

  it("returns a non-zero code when App Server exits before shutdown", async () => {
    const harness = createHarness({
      startCodexAppServer: vi.fn(() =>
        Promise.resolve({
          close: () => Promise.resolve(),
          client: {
            notify: vi.fn(),
            onNotification: vi.fn(() => () => undefined),
            onServerRequest: vi.fn(() => () => undefined),
            rejectServerRequest: vi.fn(() => Promise.resolve()),
            request: vi.fn(),
            respondToServerRequest: vi.fn(),
          },
          pid: 4321,
          version: { raw: "codex-cli 0.148.0", version: "0.148.0" },
          waitForExit: () => Promise.resolve({ code: 23, signal: null }),
        }),
      ),
    });
    const controller = new AbortController();
    queueMicrotask(() => {
      controller.abort();
    });

    await expect(
      runCli(["start"], { ...harness.options, signal: controller.signal }),
    ).resolves.toBe(1);
    expect(harness.stderr.join("")).toContain(
      "Codex App Server 在 CodeAgent 关闭前意外退出，退出码 23",
    );
  });

  it("opens a new browser page without waiting for an existing page", async () => {
    const harness = createHarness();
    const controller = new AbortController();
    const run = runCli(["start"], { ...harness.options, signal: controller.signal });

    await vi.waitFor(() => {
      expect(harness.dependencies.openBrowser).toHaveBeenCalledOnce();
    });
    controller.abort();
    await expect(run).resolves.toBe(0);
  });

  it("starts explicit LAN access without opening a browser", async () => {
    const harness = createHarness();
    const controller = new AbortController();
    const run = runCli(["start", "--", "--lan", "--port", "4567", "--session-ttl", "12h"], {
      ...harness.options,
      signal: controller.signal,
    });

    await vi.waitFor(() => {
      expect(harness.serverListen).toHaveBeenCalledOnce();
    });
    expect(harness.dependencies.createServer).toHaveBeenCalledWith(
      expect.objectContaining({
        access: { pairingCode: "fixed-test-pairing-code", sessionTtlMs: 43_200_000 },
      }),
    );
    expect(harness.serverListen).toHaveBeenCalledWith({ host: "0.0.0.0", port: 4567 });
    expect(harness.dependencies.openBrowser).not.toHaveBeenCalled();
    expect(harness.dependencies.listLanAccessUrls).toHaveBeenCalledWith(4567);
    expect(harness.stdout.join("\n")).toContain("http://192.168.1.20:4567");
    expect(harness.stdout.join("\n")).toContain("fixed-test-pairing-code");
    expect(harness.stdout.join("\n")).not.toContain("http://0.0.0.0:4567");

    controller.abort();
    await expect(run).resolves.toBe(0);
  });

  it("keeps LAN sessions unexpired by default", async () => {
    const harness = createHarness();
    const controller = new AbortController();
    const run = runCli(["start", "--lan"], {
      ...harness.options,
      signal: controller.signal,
    });

    await vi.waitFor(() => {
      expect(harness.serverListen).toHaveBeenCalledOnce();
    });
    expect(harness.dependencies.createServer).toHaveBeenCalledWith(
      expect.objectContaining({ access: { pairingCode: "fixed-test-pairing-code" } }),
    );
    expect(harness.stdout.join("\n")).toContain("会话有效期: 永不过期");

    controller.abort();
    await expect(run).resolves.toBe(0);
  });

  it("passes repeatable exact reverse proxy domains without enabling LAN", async () => {
    const harness = createHarness();
    const controller = new AbortController();
    const run = runCli(
      ["start", "--allowed-host", "Code.Example.com", "--allowed-host", "admin.example.com"],
      { ...harness.options, signal: controller.signal },
    );

    await vi.waitFor(() => {
      expect(harness.serverListen).toHaveBeenCalledOnce();
    });
    expect(harness.dependencies.createServer).toHaveBeenCalledWith(
      expect.objectContaining({ allowedHosts: ["code.example.com", "admin.example.com"] }),
    );
    expect(harness.serverListen).toHaveBeenCalledWith({ host: "127.0.0.1", port: 3210 });

    controller.abort();
    await expect(run).resolves.toBe(0);
  });

  it("uses a strong custom LAN password without generating or printing a credential", async () => {
    const harness = createHarness();
    const controller = new AbortController();
    const password = "Strong-Lan_Pass9!";
    const run = runCli(["start", "--lan", "--lan-password", password, "--session-ttl", "180d"], {
      ...harness.options,
      signal: controller.signal,
    });

    await vi.waitFor(() => {
      expect(harness.serverListen).toHaveBeenCalledOnce();
    });
    expect(harness.dependencies.createServer).toHaveBeenCalledWith(
      expect.objectContaining({
        access: { pairingCode: password, sessionTtlMs: 15_552_000_000 },
      }),
    );
    expect(harness.dependencies.generateLanPairingCode).not.toHaveBeenCalled();
    expect(harness.stdout.join("\n")).toContain("已使用自定义访问密码");
    expect(harness.stdout.join("\n")).not.toContain(password);

    controller.abort();
    await expect(run).resolves.toBe(0);
  });

  it("rejects invalid LAN options before starting runtime resources", async () => {
    for (const args of [
      ["start", "--session-ttl", "12h"],
      ["start", "--lan-password", "Strong-Lan_Pass9!"],
      ["start", "--lan", "--lan-password", "weak-password"],
      ["start", "--allowed-host", "*.example.com"],
      ["start", "--allowed-host", "https://code.example.com"],
      ["start", "--allowed-host", "code.example.com:443"],
      ["start", "--lan", "--lan"],
      ["start", "--lan", "--codex-bin", "/first", "--codex-bin", "/second"],
    ]) {
      const harness = createHarness();
      await expect(runCli(args, harness.options)).resolves.toBe(1);
      expect(harness.dependencies.createStateRepository).not.toHaveBeenCalled();
      expect(harness.dependencies.startCodexAppServer).not.toHaveBeenCalled();
    }
  });

  it("rejects invalid ports before starting runtime resources", async () => {
    for (const port of ["0", "65536", "1.5", "invalid"]) {
      const harness = createHarness();

      await expect(runCli(["start", "--port", port], harness.options)).resolves.toBe(1);
      expect(harness.dependencies.createStateRepository).not.toHaveBeenCalled();
      expect(harness.dependencies.startCodexAppServer).not.toHaveBeenCalled();
      expect(harness.stderr.join("")).toContain("--port");
    }
  });

  it("keeps the server running when opening the browser fails", async () => {
    const harness = createHarness({
      openBrowser: vi.fn(() => Promise.reject(new Error("browser unavailable"))),
    });
    const controller = new AbortController();
    const run = runCli(["start"], {
      ...harness.options,
      signal: controller.signal,
    });

    await vi.waitFor(() => {
      expect(harness.serverListen).toHaveBeenCalledOnce();
    });
    controller.abort();

    await expect(run).resolves.toBe(0);
    expect(harness.stderr.join("")).toContain("browser unavailable");
    expect(harness.stderr.join("")).toContain("[警告] 无法自动打开浏览器");
  });

  it("uses distinct colors for information, success, warning, and error output", async () => {
    const successHarness = createHarness();
    await expect(runCli(["doctor"], { ...successHarness.options, color: true })).resolves.toBe(0);
    expect(successHarness.stdout.join("")).toContain("\u001B[32m[成功]\u001B[0m");

    const warningHarness = createHarness();
    const controller = new AbortController();
    const run = runCli(["start", "--lan"], {
      ...warningHarness.options,
      color: true,
      signal: controller.signal,
    });
    await vi.waitFor(() => {
      expect(warningHarness.stderr.join("")).toContain("\u001B[33m[警告]\u001B[0m");
      expect(warningHarness.stdout.join("")).toContain("\u001B[36m[信息]\u001B[0m");
    });
    controller.abort();
    await expect(run).resolves.toBe(0);

    const errorHarness = createHarness();
    await expect(runCli(["unknown"], { ...errorHarness.options, color: true })).resolves.toBe(1);
    expect(errorHarness.stderr.join("")).toContain("\u001B[31m[错误]\u001B[0m");
  });

  it("closes SQLite and Codex when HTTP Server creation fails", async () => {
    const harness = createHarness({
      createServer: vi.fn(() => Promise.reject(new Error("server startup failed"))),
    });

    await expect(runCli(["start"], harness.options)).resolves.toBe(1);

    expect(harness.databaseClose).toHaveBeenCalledOnce();
    expect(harness.close).toHaveBeenCalledOnce();
    expect(harness.lifecycle).toEqual(["provider.create", "database.close", "runtime.close"]);
    expect(harness.stderr.join("")).toContain("server startup failed");
  });

  it("closes the runtime when closing the HTTP server fails", async () => {
    const serverClose = vi.fn(() => Promise.reject(new Error("server close failed")));
    const serverListen = vi.fn(() => Promise.resolve("http://127.0.0.1:3210"));
    const harness = createHarness({
      createServer: vi.fn(() =>
        Promise.resolve({
          close: serverClose,
          listen: serverListen,
        }),
      ),
    });
    const controller = new AbortController();
    const run = runCli(["start"], { ...harness.options, signal: controller.signal });

    await vi.waitFor(() => {
      expect(harness.dependencies.openBrowser).toHaveBeenCalledOnce();
    });
    controller.abort();

    await expect(run).resolves.toBe(1);
    expect(serverClose).toHaveBeenCalledOnce();
    expect(harness.databaseClose).toHaveBeenCalledOnce();
    expect(harness.close).toHaveBeenCalledOnce();
    expect(harness.stderr.join("")).toContain("server close failed");
  });

  it("prints complete English help and rejects unknown commands or missing option values", async () => {
    const helpHarness = createHarness();
    const unknownHarness = createHarness();
    const invalidHarness = createHarness();

    await expect(runCli(["--help"], helpHarness.options)).resolves.toBe(0);
    await expect(runCli(["unknown"], unknownHarness.options)).resolves.toBe(1);
    await expect(runCli(["doctor", "--codex-bin"], invalidHarness.options)).resolves.toBe(1);

    const help = helpHarness.stdout.join("");
    expect(help).toContain("Usage: code-agent [command] [options]");
    expect(help).toContain("start    Start the CodeAgent server and open the Web interface.");
    expect(help).toContain("doctor   Check whether the local CodeAgent runtime is ready.");
    expect(help).toContain("version  Print the installed CodeAgent version.");
    expect(help).toContain("--port <port>");
    expect(help).toContain("--lan");
    expect(help).toContain("--lan-password <password>");
    expect(help).toContain("--allowed-host <domain>");
    expect(help).toContain("--session-ttl <duration>");
    expect(help).toContain("--codex-bin <path>");
    expect(help).toContain("--codex-home <path>");
    expect(help).toContain("-h, --help");
    expect(help).toContain("Defaults to 3210.");
    expect(help).toContain("Automatically increases the port when it is occupied.");
    expect(help).toContain("Requires --lan.");
    expect(help).toContain(
      "Running code-agent without a command is equivalent to code-agent start.",
    );
    expect(unknownHarness.stderr.join("")).toContain("未知命令: unknown");
    expect(invalidHarness.stderr.join("")).toContain("选项缺少值: --codex-bin");
  });

  it("rejects the removed --project option", async () => {
    const harness = createHarness();

    await expect(
      runCli(["start", "--project", "/workspace/project"], harness.options),
    ).resolves.toBe(1);
    expect(harness.stderr.join("")).toContain("未知选项: --project");
    expect(harness.dependencies.startCodexAppServer).not.toHaveBeenCalled();
  });
});
