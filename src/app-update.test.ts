import { describe, expect, it, vi } from "vitest";

import {
  createAppUpdateService,
  isNewerVersion,
  resolveNpmInstallInvocation,
} from "./app-update.js";

describe("app update service", () => {
  it("compares semantic versions without numeric precision loss", () => {
    expect(isNewerVersion("9007199254740993.0.0", "9007199254740992.0.0")).toBe(true);
    expect(isNewerVersion("1.4.0-beta.10", "1.4.0-beta.2")).toBe(true);
    expect(isNewerVersion("1.4.0-beta.01", "1.4.0-beta.1")).toBe(false);
  });

  it("runs npm through node.exe on Windows without a command shell", () => {
    expect(
      resolveNpmInstallInvocation("1.4.0", "win32", String.raw`C:\Program Files\nodejs\node.exe`),
    ).toEqual({
      args: [
        String.raw`C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js`,
        "install",
        "--global",
        "@bryanhu/code-agent@1.4.0",
      ],
      command: String.raw`C:\Program Files\nodejs\node.exe`,
    });
  });

  it("reports a newer validated registry version", async () => {
    const fetchLatestVersion = vi.fn(() => Promise.resolve("1.4.0"));
    const runNpmInstall = vi.fn(() => Promise.resolve());
    const service = createAppUpdateService({
      appVersion: "1.3.0",
      codexVersion: "0.147.0",
      fetchLatestVersion,
      runNpmInstall,
    });

    await expect(service.read()).resolves.toEqual({
      appVersion: "1.3.0",
      codexVersion: "0.147.0",
      latestVersion: "1.4.0",
      status: "available",
      updateAvailable: true,
    });
    expect(runNpmInstall).not.toHaveBeenCalled();
  });

  it("returns version information when the registry check fails", async () => {
    const service = createAppUpdateService({
      appVersion: "1.3.0",
      codexVersion: "0.147.0",
      fetchLatestVersion: vi.fn(() => Promise.reject(new Error("offline"))),
      runNpmInstall: vi.fn(),
    });

    await expect(service.read()).resolves.toEqual({
      appVersion: "1.3.0",
      codexVersion: "0.147.0",
      latestVersion: null,
      status: "check-failed",
      updateAvailable: false,
    });
  });

  it("installs only the current validated latest version", async () => {
    const runNpmInstall = vi.fn(() => Promise.resolve());
    const service = createAppUpdateService({
      appVersion: "1.3.0",
      codexVersion: "0.147.0",
      fetchLatestVersion: vi.fn(() => Promise.resolve("1.4.0")),
      runNpmInstall,
    });

    await expect(service.install("1.4.0")).resolves.toEqual({
      appVersion: "1.3.0",
      codexVersion: "0.147.0",
      latestVersion: "1.4.0",
      status: "restart-required",
      updateAvailable: false,
    });
    expect(runNpmInstall).toHaveBeenCalledWith("1.4.0");

    await expect(service.install("1.5.0")).rejects.toMatchObject({
      code: "UPDATE_NOT_AVAILABLE",
    });
  });
});
