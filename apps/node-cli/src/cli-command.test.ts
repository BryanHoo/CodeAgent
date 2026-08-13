import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CodeAgentEngine } from "@code-agent/engine-node";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ensureTemporaryWorkspace, runCli, type CliDependencies } from "./cli-command.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

function createHarness(overrides: Partial<CliDependencies> = {}) {
  const lifecycle: string[] = [];
  let resolveExit!: (exit: { code?: number; signal?: number }) => void;
  const exit = new Promise<{ code?: number; signal?: number }>((resolve) => {
    resolveExit = resolve;
  });
  const engineClose = vi.fn(() => {
    lifecycle.push("engine.close");
    return Promise.resolve();
  });
  const engine = {
    close: engineClose,
    diagnose: vi.fn(() =>
      Promise.resolve({
        codexVersion: "0.147.0",
        foreignKeys: true,
        integrityCheck: "ok",
        journalMode: "wal",
        migrationVersion: 4,
      }),
    ),
    waitForExit: () => exit,
  } as unknown as CodeAgentEngine;
  const serverClose = vi.fn(() => {
    lifecycle.push("server.close");
    return engineClose();
  });
  const serverListen = vi.fn(() => {
    lifecycle.push("server.listen");
    return Promise.resolve("http://127.0.0.1:3210");
  });
  const dependencies: CliDependencies = {
    appVersion: "1.2.3",
    checkAppUpdate: vi.fn(() =>
      Promise.resolve({ latestVersion: "1.2.3", status: "current" as const }),
    ),
    confirmAppUpdate: vi.fn(() => Promise.resolve(false)),
    createEngine: vi.fn(() => Promise.resolve(engine)),
    createServer: vi.fn(() => Promise.resolve({ close: serverClose, listen: serverListen })),
    ensureTemporaryWorkspace: vi.fn((path: string) => Promise.resolve(path)),
    generateLanPairingCode: vi.fn(() => "fixed-test-pairing-code"),
    installAppUpdate: vi.fn(() => Promise.resolve()),
    listLanAccessUrls: vi.fn((port: number) => [`http://192.168.1.20:${String(port)}`]),
    locateCodexBinary: vi.fn(() => Promise.resolve("/fake/codex")),
    nodeVersion: "24.1.0",
    openBrowser: vi.fn(() => {
      lifecycle.push("browser.open");
      return Promise.resolve();
    }),
    restartAfterUpdate: vi.fn(() => Promise.resolve(0)),
    webRoot: "/package/dist/web",
    ...overrides,
  };
  const stderr: string[] = [];
  const stdout: string[] = [];
  return {
    dependencies,
    engine,
    engineClose,
    lifecycle,
    options: {
      dependencies,
      stderr: (message: string) => stderr.push(message),
      stdout: (message: string) => stdout.push(message),
    },
    resolveExit,
    serverClose,
    serverListen,
    stderr,
    stdout,
  };
}

describe("runCli", () => {
  it("creates a private temporary workspace and rejects a symbolic-link target", async () => {
    const root = await mkdtemp(join(tmpdir(), "code-agent-cli-"));
    temporaryDirectories.push(root);
    const workspace = join(root, "temporary-workspace");
    const created = await ensureTemporaryWorkspace(workspace);
    await expect(realpath(workspace)).resolves.toBe(created);

    const target = join(root, "target");
    const alias = join(root, "alias");
    await mkdir(target);
    await symlink(target, alias);
    await expect(ensureTemporaryWorkspace(alias)).rejects.toThrow(/symbolic link/u);
  });

  it("prints version and rejects unsupported Node.js", async () => {
    const harness = createHarness();
    await expect(runCli(["version"], harness.options)).resolves.toBe(0);
    expect(harness.stdout.join("")).toBe("code-agent 1.2.3\n");

    const unsupported = createHarness({ nodeVersion: "22.0.0" });
    await expect(runCli(["doctor"], unsupported.options)).resolves.toBe(1);
    expect(unsupported.stderr.join("")).toContain("需要 Node.js 24 或更高版本");
  });

  it("opens the Rust Engine for doctor diagnostics and closes it", async () => {
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
    expect(harness.dependencies.createEngine).toHaveBeenCalledWith({
      appVersion: "1.2.3",
      attachmentRoot: join("/custom/home", "code-agent", "attachments"),
      codexHome: "/custom/home",
      codexPath: "/fake/codex",
      databasePath: join("/custom/home", "code-agent", "state.sqlite3"),
      temporaryWorkspace: join("/custom/home", "code-agent", "temporary-workspace"),
    });
    expect(harness.stdout.join("")).toContain("Codex 0.147.0 (/fake/codex)");
    expect(harness.stdout.join("")).toContain("SQLite migration 4");
    expect(harness.engineClose).toHaveBeenCalledOnce();
  });

  it("starts one Engine, injects it into Server, then closes Server before Engine", async () => {
    const harness = createHarness();
    const controller = new AbortController();
    const run = runCli(["start", "--codex-bin", "/custom/codex", "--codex-home", "/custom/home"], {
      ...harness.options,
      signal: controller.signal,
    });
    await vi.waitFor(() => {
      expect(harness.dependencies.createServer).toHaveBeenCalledOnce();
    });

    expect(harness.dependencies.createServer).toHaveBeenCalledWith(
      expect.objectContaining({ engine: harness.engine, staticRoot: "/package/dist/web" }),
    );
    expect(harness.serverListen).toHaveBeenCalledWith({ host: "127.0.0.1", port: 3210 });
    expect(harness.dependencies.openBrowser).toHaveBeenCalledWith("http://127.0.0.1:3210");
    controller.abort();
    await expect(run).resolves.toBe(0);
    expect(harness.lifecycle).toEqual([
      "server.listen",
      "browser.open",
      "server.close",
      "engine.close",
      "engine.close",
    ]);
  });

  it("increments occupied ports and keeps LAN access browser-free", async () => {
    const harness = createHarness();
    const inUse = Object.assign(new Error("address already in use"), { code: "EADDRINUSE" });
    harness.serverListen.mockRejectedValueOnce(inUse).mockResolvedValueOnce("http://0.0.0.0:4568");
    const controller = new AbortController();
    const run = runCli(["start", "--lan", "--port", "4567", "--session-ttl", "12h"], {
      ...harness.options,
      signal: controller.signal,
    });
    await vi.waitFor(() => {
      expect(harness.serverListen).toHaveBeenCalledTimes(2);
    });
    expect(harness.serverListen).toHaveBeenLastCalledWith({ host: "0.0.0.0", port: 4568 });
    expect(harness.dependencies.openBrowser).not.toHaveBeenCalled();
    expect(harness.dependencies.createServer).toHaveBeenCalledWith(
      expect.objectContaining({
        access: { pairingCode: "fixed-test-pairing-code", sessionTtlMs: 43_200_000 },
      }),
    );
    controller.abort();
    await expect(run).resolves.toBe(0);
  });

  it("reports an Engine-owned Codex process exit", async () => {
    const harness = createHarness();
    const run = runCli(["start"], harness.options);
    await vi.waitFor(() => {
      expect(harness.serverListen).toHaveBeenCalledOnce();
    });
    harness.resolveExit({ code: 23 });
    await expect(run).resolves.toBe(1);
    expect(harness.stderr.join("")).toContain(
      "Codex App Server 在 CodeAgent 关闭前意外退出，退出码 23",
    );
  });

  it("closes Engine when Server creation fails", async () => {
    const harness = createHarness({
      createServer: vi.fn(() => Promise.reject(new Error("server startup failed"))),
    });
    await expect(runCli(["start"], harness.options)).resolves.toBe(1);
    expect(harness.engineClose).toHaveBeenCalledOnce();
    expect(harness.stderr.join("")).toContain("server startup failed");
  });

  it("installs an accepted update before opening Engine", async () => {
    const harness = createHarness({
      checkAppUpdate: vi.fn(() =>
        Promise.resolve({ latestVersion: "1.3.0", status: "available" as const }),
      ),
      confirmAppUpdate: vi.fn(() => Promise.resolve(true)),
    });
    await expect(runCli(["start", "--port", "4567"], harness.options)).resolves.toBe(0);
    expect(harness.dependencies.installAppUpdate).toHaveBeenCalledWith("1.3.0");
    expect(harness.dependencies.restartAfterUpdate).toHaveBeenCalledWith([
      "start",
      "--port",
      "4567",
    ]);
    expect(harness.dependencies.createEngine).not.toHaveBeenCalled();
  });
});
