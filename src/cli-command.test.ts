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
    getCapabilities: vi.fn(),
    interruptTurn: vi.fn(),
    listModels: vi.fn(),
    listTasks: vi.fn(),
    readTask: vi.fn(),
    resolvePendingRequest: vi.fn(),
    rollbackLatestTurn: vi.fn(),
    startTask: vi.fn(),
    startTurn: vi.fn(),
    subscribeEvents: vi.fn(() => () => undefined),
  };
  const project = {
    createdAt: "2026-07-23T00:00:00.000Z",
    id: "project",
    name: "project",
    rootPath: "/workspace/project",
  };
  const dependencies: CliDependencies = {
    appVersion: "1.2.3",
    checkCodexVersion: vi.fn(() =>
      Promise.resolve({ raw: "codex-cli 0.145.0", version: "0.145.0" }),
    ),
    createAgentProvider: vi.fn(() => {
      lifecycle.push("provider.create");
      return provider;
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
    resolveProject: vi.fn(() => {
      lifecycle.push("project.resolve");
      return Promise.resolve(project);
    }),
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
    provider,
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

  it("checks Node.js and the configured Codex binary in doctor", async () => {
    const harness = createHarness();

    await expect(runCli(["doctor", "--codex-bin", "/custom/codex"], harness.options)).resolves.toBe(
      0,
    );
    expect(harness.dependencies.locateCodexBinary).toHaveBeenCalledWith({
      explicitPath: "/custom/codex",
    });
    expect(harness.dependencies.checkCodexVersion).toHaveBeenCalledWith("/fake/codex");
    expect(harness.stdout.join("")).toContain("[ok] Node.js 24.1.0");
    expect(harness.stdout.join("")).toContain("[ok] Codex 0.145.0 (/fake/codex)");
  });

  it("returns a non-zero code when doctor finds an unsupported Node.js", async () => {
    const harness = createHarness({ nodeVersion: "22.0.0" });

    await expect(runCli(["doctor"], harness.options)).resolves.toBe(1);
    expect(harness.stderr.join("")).toContain("Node.js 24 or newer is required");
    expect(harness.dependencies.locateCodexBinary).not.toHaveBeenCalled();
  });

  it("starts Codex, HTTP, and static Web then closes on abort", async () => {
    const harness = createHarness();
    const controller = new AbortController();
    const run = runCli(
      [
        "start",
        "--codex-bin",
        "/custom/codex",
        "--codex-home",
        "/custom/home",
        "--project",
        "/workspace/project",
      ],
      { ...harness.options, signal: controller.signal },
    );

    await vi.waitFor(() => {
      expect(harness.dependencies.startCodexAppServer).toHaveBeenCalledOnce();
    });
    const [startOptions] = vi.mocked(harness.dependencies.startCodexAppServer).mock.calls[0] ?? [];
    expect(startOptions).toMatchObject({
      appVersion: "1.2.3",
      binaryPath: "/custom/codex",
      cwd: "/workspace/project",
    });
    expect(startOptions?.env?.["CODEX_HOME"]).toBe("/custom/home");
    expect(harness.dependencies.createAgentProvider).toHaveBeenCalledWith({
      client: harness.client,
      project: harness.project,
    });
    expect(harness.dependencies.createServer).toHaveBeenCalledWith({
      project: harness.project,
      provider: harness.provider,
      staticRoot: "/package/dist/web",
    });
    expect(harness.serverListen).toHaveBeenCalledWith({ host: "127.0.0.1", port: 3210 });
    expect(harness.dependencies.openBrowser).toHaveBeenCalledWith("http://127.0.0.1:3210");
    expect(harness.stdout.join("")).toContain("CodeAgent started at http://127.0.0.1:3210");

    controller.abort();

    await expect(run).resolves.toBe(0);
    expect(harness.close).toHaveBeenCalledOnce();
    expect(harness.serverClose).toHaveBeenCalledOnce();
    expect(harness.lifecycle).toEqual([
      "project.resolve",
      "provider.create",
      "server.listen",
      "browser.open",
      "server.close",
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
    const run = runCli(["start", "--project", "/workspace/project"], {
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
});
