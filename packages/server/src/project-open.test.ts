import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createProjectOpenService } from "./project-open.js";

describe("createProjectOpenService", () => {
  it("detects installed macOS apps in the official app menu order", async () => {
    const existingPaths = new Set([
      "/usr/bin/open",
      "/Applications/Visual Studio Code.app",
      "/Applications/Zed.app",
      "/Applications/Windsurf.app",
      "/System/Applications/Utilities/Terminal.app",
      "/Applications/Ghostty.app",
      "/Applications/Xcode.app",
      "/Applications/Android Studio.app",
    ]);
    const spawnDetached = vi.fn(() => Promise.resolve());
    const service = createProjectOpenService({
      environment: { HOME: "/Users/test" },
      pathExists: (path) => Promise.resolve(existingPaths.has(path)),
      platform: "darwin",
      spawnDetached,
    });

    await expect(service.getCapabilities()).resolves.toEqual({
      apps: [
        { id: "zed", kind: "editor", name: "Zed" },
        { id: "windsurf", kind: "editor", name: "Windsurf" },
        { id: "visual-studio-code", kind: "editor", name: "Visual Studio Code" },
        { id: "finder", kind: "file-manager", name: "Finder" },
        { id: "terminal", kind: "terminal", name: "Terminal" },
        { id: "ghostty", kind: "terminal", name: "Ghostty" },
        { id: "xcode", kind: "editor", name: "Xcode" },
        { id: "android-studio", kind: "editor", name: "Android Studio" },
      ],
      platform: "darwin",
    });
    await service.open("/workspace/CodeAgent", "zed");

    expect(spawnDetached).toHaveBeenCalledWith(
      "/usr/bin/open",
      ["-a", "Zed", "/workspace/CodeAgent"],
      expect.objectContaining({ cwd: "/workspace/CodeAgent", shell: false }),
    );
  });

  it("keeps each installed Linux app and terminal as an independent choice", async () => {
    const existingPaths = new Set([
      "/usr/bin/xdg-open",
      "/opt/bin/code",
      "/usr/bin/zed",
      "/usr/bin/windsurf",
      "/usr/bin/ghostty",
      "/usr/bin/gnome-terminal",
      "/usr/bin/konsole",
      "/usr/bin/xfce4-terminal",
      "/opt/android-studio/bin/studio.sh",
    ]);
    const spawnDetached = vi.fn(() => Promise.resolve());
    const service = createProjectOpenService({
      environment: { PATH: "/usr/bin:/opt/bin" },
      pathExists: (path) => Promise.resolve(existingPaths.has(path)),
      platform: "linux",
      spawnDetached,
    });

    await expect(service.getCapabilities()).resolves.toEqual({
      apps: [
        { id: "zed", kind: "editor", name: "Zed" },
        { id: "windsurf", kind: "editor", name: "Windsurf" },
        { id: "visual-studio-code", kind: "editor", name: "Visual Studio Code" },
        { id: "file-manager", kind: "file-manager", name: "文件管理器" },
        { id: "ghostty", kind: "terminal", name: "Ghostty" },
        { id: "gnome-terminal", kind: "terminal", name: "GNOME Terminal" },
        { id: "konsole", kind: "terminal", name: "Konsole" },
        { id: "xfce-terminal", kind: "terminal", name: "Xfce Terminal" },
        { id: "android-studio", kind: "editor", name: "Android Studio" },
      ],
      platform: "linux",
    });
    await service.open("/workspace/CodeAgent", "konsole");

    expect(spawnDetached).toHaveBeenCalledWith(
      "/usr/bin/konsole",
      ["--workdir", "/workspace/CodeAgent"],
      expect.objectContaining({ cwd: "/workspace/CodeAgent", shell: false }),
    );
  });

  it("detects installed Windows editors, Explorer, and terminals", async () => {
    const existingPaths = new Set([
      "C:\\Windows\\explorer.exe",
      "C:\\Windows\\System32\\cmd.exe",
      "C:\\Users\\test\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe",
      "C:\\Users\\test\\AppData\\Local\\Programs\\Zed\\Zed.exe",
      "C:\\Users\\test\\AppData\\Local\\Programs\\Windsurf\\Windsurf.exe",
      "C:\\Users\\test\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe",
      "C:\\Program Files\\Android\\Android Studio\\bin\\studio64.exe",
    ]);
    const spawnDetached = vi.fn(() => Promise.resolve());
    const service = createProjectOpenService({
      environment: {
        LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local",
        PATH: "C:\\Users\\test\\AppData\\Local\\Microsoft\\WindowsApps",
        ProgramFiles: "C:\\Program Files",
        SystemRoot: "C:\\Windows",
      },
      pathExists: (path) => Promise.resolve(existingPaths.has(path)),
      platform: "win32",
      spawnDetached,
    });

    await expect(service.getCapabilities()).resolves.toEqual({
      apps: [
        { id: "zed", kind: "editor", name: "Zed" },
        { id: "windsurf", kind: "editor", name: "Windsurf" },
        { id: "visual-studio-code", kind: "editor", name: "Visual Studio Code" },
        { id: "explorer", kind: "file-manager", name: "文件资源管理器" },
        { id: "windows-terminal", kind: "terminal", name: "Windows Terminal" },
        { id: "command-prompt", kind: "terminal", name: "命令提示符" },
        { id: "android-studio", kind: "editor", name: "Android Studio" },
      ],
      platform: "win32",
    });
    await service.open("C:\\workspace\\CodeAgent", "windsurf");

    expect(spawnDetached).toHaveBeenCalledWith(
      "C:\\Users\\test\\AppData\\Local\\Programs\\Windsurf\\Windsurf.exe",
      ["C:\\workspace\\CodeAgent"],
      expect.objectContaining({ cwd: "C:\\workspace\\CodeAgent", shell: false }),
    );
  });

  it("uses Windows broker launch semantics for Explorer and opens Terminal in a new window", async () => {
    const existingPaths = new Set([
      "C:\\Windows\\explorer.exe",
      "C:\\Users\\test\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe",
    ]);
    const spawnDetached = vi.fn(() => Promise.resolve());
    const service = createProjectOpenService({
      environment: {
        LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local",
        SystemRoot: "C:\\Windows",
      },
      pathExists: (path) => Promise.resolve(existingPaths.has(path)),
      platform: "win32",
      spawnDetached,
    });
    const projectRoot = "C:\\workspace\\CodeAgent";

    await service.open(projectRoot, "explorer");
    await service.open(projectRoot, "windows-terminal");

    expect(spawnDetached).toHaveBeenNthCalledWith(
      1,
      "C:\\Windows\\explorer.exe",
      [projectRoot],
      expect.objectContaining({ observeEarlyExit: false }),
    );
    expect(spawnDetached).toHaveBeenNthCalledWith(
      2,
      "C:\\Users\\test\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe",
      ["-w", "new", "-d", projectRoot],
      expect.objectContaining({ observeEarlyExit: true }),
    );
  });

  it("rejects apps that are not available on the current host", async () => {
    const service = createProjectOpenService({
      environment: { PATH: "/usr/bin" },
      pathExists: () => Promise.resolve(false),
      platform: "linux",
      spawnDetached: vi.fn(() => Promise.resolve()),
    });

    await expect(service.getCapabilities()).resolves.toEqual({ apps: [], platform: "linux" });
    await expect(service.open("/workspace/CodeAgent", "zed")).rejects.toMatchObject({
      name: "ProjectOpenAppUnavailableError",
    });
  });

  it.runIf(process.platform !== "win32")(
    "rejects a host app that exits unsuccessfully during launch",
    async () => {
      const commandRoot = await mkdtemp(join(tmpdir(), "code-agent-project-open-"));
      const projectRoot = await mkdtemp(join(tmpdir(), "code-agent-project-root-"));
      const launcher = join(commandRoot, "xdg-open");
      try {
        await writeFile(launcher, "#!/bin/sh\nexit 23\n");
        await chmod(launcher, 0o755);
        const service = createProjectOpenService({
          environment: { PATH: commandRoot },
          // CI Worker 启动临时脚本可能超过生产默认观察窗，退出事件仍应决定结果。
          launchConfirmationMs: 5_000,
          platform: "linux",
        });

        await expect(service.open(projectRoot, "file-manager")).rejects.toThrow(
          "exited with code 23",
        );
      } finally {
        await Promise.all([
          rm(commandRoot, { force: true, recursive: true }),
          rm(projectRoot, { force: true, recursive: true }),
        ]);
      }
    },
  );
});
