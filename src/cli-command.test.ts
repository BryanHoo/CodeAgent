import { describe, expect, it, vi } from "vitest";

import { runCli, type CliDependencies } from "./cli-command.js";

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
    listModels: vi.fn(),
    listSkills: vi.fn(),
    listTasks: vi.fn(),
    readSandboxMode: vi.fn(() => Promise.resolve("workspace-write" as const)),
    readTask: vi.fn(),
    renameTask: vi.fn(),
    resolvePendingRequest: vi.fn(),
    rollbackLatestTurn: vi.fn(),
    startTask: vi.fn(),
    startReview: vi.fn(),
    startTurn: vi.fn(),
    subscribeEvents: vi.fn(() => () => undefined),
    terminateBackgroundTerminal: vi.fn(),
    unsubscribeTask: vi.fn(),
    uploadFeedback: vi.fn(),
  };
  const runtimeProvider = {
    forProject: vi.fn(() => provider),
    getCapabilities: provider.getCapabilities,
    listModels: provider.listModels,
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
    list: vi.fn(() => Promise.resolve([])),
    listPinnedTaskIds: vi.fn(() => Promise.resolve([])),
    readProjectDefaults: vi.fn(() => Promise.resolve(undefined)),
    readTaskSettings: vi.fn(() => Promise.resolve(undefined)),
    read: vi.fn(() => Promise.resolve(undefined)),
    register: vi.fn(),
    reorder: vi.fn(() => Promise.resolve([])),
    writeProjectDefaults: vi.fn((_projectId, settings) => Promise.resolve(settings)),
    writeTaskPinned: vi.fn((_projectId, _taskId, pinned) => Promise.resolve(pinned)),
    writeTaskSettings: vi.fn((_projectId, _taskId, settings) => Promise.resolve(settings)),
  };
  const dependencies: CliDependencies = {
    appVersion: "1.2.3",
    checkCodexVersion: vi.fn(() =>
      Promise.resolve({ raw: "codex-cli 0.145.0", version: "0.145.0" }),
    ),
    createStateRepository: vi.fn(() => Promise.resolve(stateRepository)),
    createRuntimeProvider: vi.fn(() => {
      lifecycle.push("provider.create");
      return runtimeProvider;
    }),
    createServer: vi.fn(() => Promise.resolve({ close: serverClose, listen: serverListen })),
    locateCodexBinary: vi.fn(() =>
      Promise.resolve({ path: "/fake/codex", source: "explicit" as const }),
    ),
    nodeVersion: "24.1.0",
    openBrowser: vi.fn(() => {
      lifecycle.push("browser.open");
      return Promise.resolve();
    }),
    selectProjectDirectory: vi.fn(() => Promise.resolve(undefined)),
    startCodexAppServer: vi.fn(() =>
      Promise.resolve({ client, close, pid: 4321, waitForExit: () => exit }),
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
    expect(harness.stdout.join("")).toContain("[ok] Node.js 24.1.0");
    expect(harness.stdout.join("")).toContain("[ok] Codex 0.145.0 (/fake/codex)");
    expect(harness.dependencies.createStateRepository).toHaveBeenCalledWith(
      "/custom/home/code-agent/state.sqlite3",
    );
    expect(harness.stdout.join("")).toContain("[ok] SQLite writable");
    expect(harness.stdout.join("")).toContain("[ok] SQLite migration 4");
    expect(harness.stdout.join("")).toContain("[ok] SQLite integrity_check ok");
    expect(harness.stdout.join("")).toContain("[ok] SQLite journal_mode wal");
    expect(harness.databaseClose).toHaveBeenCalledOnce();
  });

  it("returns a non-zero code when doctor finds an unsupported Node.js", async () => {
    const harness = createHarness({ nodeVersion: "22.0.0" });

    await expect(runCli(["doctor"], harness.options)).resolves.toBe(1);
    expect(harness.stderr.join("")).toContain("Node.js 24 or newer is required");
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
    expect(harness.dependencies.createServer).toHaveBeenCalledWith({
      projectRepository: harness.stateRepository,
      provider: harness.runtimeProvider,
      selectProjectDirectory: harness.dependencies.selectProjectDirectory,
      settingsRepository: harness.stateRepository,
      staticRoot: "/package/dist/web",
      taskMetadataRepository: harness.stateRepository,
    });
    expect(harness.dependencies.createStateRepository).toHaveBeenCalledWith(
      "/custom/home/code-agent/state.sqlite3",
    );
    expect(harness.serverListen).toHaveBeenCalledWith({ host: "127.0.0.1", port: 3210 });
    expect(harness.dependencies.openBrowser).toHaveBeenCalledWith("http://127.0.0.1:3210");
    expect(harness.stdout.join("")).toContain("CodeAgent started at http://127.0.0.1:3210");

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
      "Codex App Server exited before shutdown with code 23",
    );
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
      createServer: vi.fn(() => Promise.resolve({ close: serverClose, listen: serverListen })),
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

  it("prints help and rejects unknown commands or missing option values", async () => {
    const helpHarness = createHarness();
    const unknownHarness = createHarness();
    const invalidHarness = createHarness();

    await expect(runCli(["--help"], helpHarness.options)).resolves.toBe(0);
    await expect(runCli(["unknown"], unknownHarness.options)).resolves.toBe(1);
    await expect(runCli(["doctor", "--codex-bin"], invalidHarness.options)).resolves.toBe(1);

    expect(helpHarness.stdout.join("")).toContain("code-agent start");
    expect(unknownHarness.stderr.join("")).toContain("Unknown command: unknown");
    expect(invalidHarness.stderr.join("")).toContain("Missing value for --codex-bin");
  });

  it("rejects the removed --project option", async () => {
    const harness = createHarness();

    await expect(
      runCli(["start", "--project", "/workspace/project"], harness.options),
    ).resolves.toBe(1);
    expect(harness.stderr.join("")).toContain("Unknown option: --project");
    expect(harness.dependencies.startCodexAppServer).not.toHaveBeenCalled();
  });
});
