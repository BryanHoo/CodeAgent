import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { posix, win32 } from "node:path";

import type {
  ProjectOpenApp,
  ProjectOpenAppId,
  ProjectOpenAppKind,
  ProjectOpenCapabilitiesResponse,
  ProjectOpenPlatform,
} from "@code-agent/protocol";

type SpawnDetachedOptions = Readonly<{
  cwd: string;
  shell: false;
  windowsHide: boolean;
}>;

type SpawnDetached = (
  file: string,
  args: readonly string[],
  options: SpawnDetachedOptions,
) => Promise<void>;

type ProjectOpenCommand = Readonly<{
  app: ProjectOpenApp;
  args: (projectRoot: string) => readonly string[];
  file: string;
}>;

type ProjectOpenCommandMap = Map<ProjectOpenAppId, ProjectOpenCommand>;

const LAUNCH_CONFIRMATION_MS = 500;

export interface ProjectOpenService {
  getCapabilities: () => Promise<ProjectOpenCapabilitiesResponse>;
  open: (projectRoot: string, appId: ProjectOpenAppId) => Promise<void>;
}

export interface CreateProjectOpenServiceOptions {
  environment?: NodeJS.ProcessEnv;
  pathExists?: (path: string) => Promise<boolean>;
  platform?: ProjectOpenPlatform;
  spawnDetached?: SpawnDetached;
}

export class ProjectOpenAppUnavailableError extends Error {
  public constructor(appId: ProjectOpenAppId) {
    super(`Project open app is unavailable: ${appId}`);
    this.name = "ProjectOpenAppUnavailableError";
  }
}

async function defaultPathExists(path: string): Promise<boolean> {
  try {
    // 能力菜单只暴露当前进程实际可执行的宿主程序或可访问的应用包。
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function defaultSpawnDetached(
  file: string,
  args: readonly string[],
  options: SpawnDetachedOptions,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, [...args], {
      ...options,
      detached: true,
      stdio: "ignore",
    });
    let settled = false;
    let confirmationTimer: ReturnType<typeof setTimeout> | undefined;
    const settle = (action: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (confirmationTimer !== undefined) {
        clearTimeout(confirmationTimer);
      }
      action();
    };
    child.once("error", (error) => {
      settle(() => {
        reject(error);
      });
    });
    child.once("spawn", () => {
      // GUI 进程可能长驻；短暂观察可捕获启动失败，同时避免等待应用整个生命周期。
      confirmationTimer = setTimeout(() => {
        settle(() => {
          child.unref();
          resolve();
        });
      }, LAUNCH_CONFIRMATION_MS);
    });
    child.once("exit", (exitCode, signal) => {
      if (exitCode === 0) {
        settle(resolve);
        return;
      }
      const reason = signal ? `signal ${signal}` : `code ${String(exitCode)}`;
      settle(() => {
        reject(new Error(`${file} exited with ${reason}`));
      });
    });
  });
}

function readEnvironmentValue(environment: NodeJS.ProcessEnv, names: readonly string[]) {
  for (const name of names) {
    const direct = environment[name];
    if (direct !== undefined && direct.length > 0) {
      return direct;
    }
    const matched = Object.entries(environment).find(
      ([key, value]) => key.toLowerCase() === name.toLowerCase() && value !== undefined,
    )?.[1];
    if (matched !== undefined && matched.length > 0) {
      return matched;
    }
  }
  return undefined;
}

async function firstExisting(
  candidates: readonly (string | undefined)[],
  pathExists: (path: string) => Promise<boolean>,
): Promise<string | undefined> {
  for (const candidate of candidates) {
    if (candidate !== undefined && (await pathExists(candidate))) {
      return candidate;
    }
  }
  return undefined;
}

async function findPathExecutable(
  command: string,
  platform: ProjectOpenPlatform,
  environment: NodeJS.ProcessEnv,
  pathExists: (path: string) => Promise<boolean>,
): Promise<string | undefined> {
  const pathValue = readEnvironmentValue(environment, ["PATH"]);
  if (pathValue === undefined) {
    return undefined;
  }
  const pathApi = platform === "win32" ? win32 : posix;
  const delimiter = platform === "win32" ? ";" : ":";
  return firstExisting(
    pathValue
      .split(delimiter)
      .filter(Boolean)
      .map((directory) => pathApi.join(directory, command)),
    pathExists,
  );
}

function addCommand(
  commands: ProjectOpenCommandMap,
  app: Readonly<{ id: ProjectOpenAppId; kind: ProjectOpenAppKind; name: string }>,
  file: string | undefined,
  args: (projectRoot: string) => readonly string[],
): void {
  if (file !== undefined) {
    commands.set(app.id, { app, args, file });
  }
}

function macAppCandidates(home: string | undefined, appName: string): readonly string[] {
  return [
    posix.join("/Applications", `${appName}.app`),
    ...(home === undefined ? [] : [posix.join(home, "Applications", `${appName}.app`)]),
  ];
}

async function resolveMacCommands(
  environment: NodeJS.ProcessEnv,
  pathExists: (path: string) => Promise<boolean>,
): Promise<ProjectOpenCommandMap> {
  const commands: ProjectOpenCommandMap = new Map();
  const open = await firstExisting(["/usr/bin/open"], pathExists);
  if (open === undefined) {
    return commands;
  }
  const home = readEnvironmentValue(environment, ["HOME"]);
  const resolveApp = (name: string) => firstExisting(macAppCandidates(home, name), pathExists);
  const addMacApp = async (id: ProjectOpenAppId, name: string, kind: ProjectOpenAppKind) => {
    const appPath = await resolveApp(name);
    addCommand(commands, { id, kind, name }, appPath === undefined ? undefined : open, (root) => [
      "-a",
      name,
      root,
    ]);
  };

  // 顺序与官方 App 的打开菜单一致，开发工具优先，系统位置与终端随后。
  await addMacApp("zed", "Zed", "editor");
  await addMacApp("windsurf", "Windsurf", "editor");
  await addMacApp("visual-studio-code", "Visual Studio Code", "editor");
  addCommand(commands, { id: "finder", kind: "file-manager", name: "Finder" }, open, (root) => [
    root,
  ]);
  const terminalPath = await firstExisting(
    ["/System/Applications/Utilities/Terminal.app", "/Applications/Utilities/Terminal.app"],
    pathExists,
  );
  addCommand(
    commands,
    { id: "terminal", kind: "terminal", name: "Terminal" },
    terminalPath === undefined ? undefined : open,
    (root) => ["-a", "Terminal", root],
  );
  await addMacApp("ghostty", "Ghostty", "terminal");
  await addMacApp("xcode", "Xcode", "editor");
  await addMacApp("android-studio", "Android Studio", "editor");
  return commands;
}

async function resolveLinuxCommands(
  environment: NodeJS.ProcessEnv,
  pathExists: (path: string) => Promise<boolean>,
): Promise<ProjectOpenCommandMap> {
  const commands: ProjectOpenCommandMap = new Map();
  const find = (command: string) => findPathExecutable(command, "linux", environment, pathExists);

  addCommand(commands, { id: "zed", kind: "editor", name: "Zed" }, await find("zed"), (root) => [
    root,
  ]);
  addCommand(
    commands,
    { id: "windsurf", kind: "editor", name: "Windsurf" },
    await find("windsurf"),
    (root) => [root],
  );
  addCommand(
    commands,
    { id: "visual-studio-code", kind: "editor", name: "Visual Studio Code" },
    await find("code"),
    (root) => [root],
  );
  addCommand(
    commands,
    { id: "file-manager", kind: "file-manager", name: "文件管理器" },
    await find("xdg-open"),
    (root) => [root],
  );
  addCommand(
    commands,
    { id: "ghostty", kind: "terminal", name: "Ghostty" },
    await find("ghostty"),
    (root) => [`--working-directory=${root}`],
  );
  addCommand(
    commands,
    { id: "gnome-terminal", kind: "terminal", name: "GNOME Terminal" },
    await find("gnome-terminal"),
    (root) => [`--working-directory=${root}`],
  );
  addCommand(
    commands,
    { id: "konsole", kind: "terminal", name: "Konsole" },
    await find("konsole"),
    (root) => ["--workdir", root],
  );
  addCommand(
    commands,
    { id: "xfce-terminal", kind: "terminal", name: "Xfce Terminal" },
    await find("xfce4-terminal"),
    (root) => ["--working-directory", root],
  );
  const androidStudio = await firstExisting(
    ["/opt/android-studio/bin/studio.sh", await find("android-studio"), await find("studio.sh")],
    pathExists,
  );
  addCommand(
    commands,
    { id: "android-studio", kind: "editor", name: "Android Studio" },
    androidStudio,
    (root) => [root],
  );
  return commands;
}

async function resolveWindowsCommands(
  environment: NodeJS.ProcessEnv,
  pathExists: (path: string) => Promise<boolean>,
): Promise<ProjectOpenCommandMap> {
  const commands: ProjectOpenCommandMap = new Map();
  const systemRoot = readEnvironmentValue(environment, ["SystemRoot", "WINDIR"]);
  const localAppData = readEnvironmentValue(environment, ["LOCALAPPDATA"]);
  const programFiles = readEnvironmentValue(environment, ["ProgramFiles"]);
  const programFilesX86 = readEnvironmentValue(environment, ["ProgramFiles(x86)"]);
  const find = (command: string) => findPathExecutable(command, "win32", environment, pathExists);

  const zed = await firstExisting(
    [
      localAppData === undefined
        ? undefined
        : win32.join(localAppData, "Programs", "Zed", "Zed.exe"),
      await find("Zed.exe"),
    ],
    pathExists,
  );
  addCommand(commands, { id: "zed", kind: "editor", name: "Zed" }, zed, (root) => [root]);
  const windsurf = await firstExisting(
    [
      localAppData === undefined
        ? undefined
        : win32.join(localAppData, "Programs", "Windsurf", "Windsurf.exe"),
      await find("Windsurf.exe"),
    ],
    pathExists,
  );
  addCommand(commands, { id: "windsurf", kind: "editor", name: "Windsurf" }, windsurf, (root) => [
    root,
  ]);
  const vscode = await firstExisting(
    [
      localAppData === undefined
        ? undefined
        : win32.join(localAppData, "Programs", "Microsoft VS Code", "Code.exe"),
      programFiles === undefined
        ? undefined
        : win32.join(programFiles, "Microsoft VS Code", "Code.exe"),
      programFilesX86 === undefined
        ? undefined
        : win32.join(programFilesX86, "Microsoft VS Code", "Code.exe"),
      await find("Code.exe"),
    ],
    pathExists,
  );
  addCommand(
    commands,
    { id: "visual-studio-code", kind: "editor", name: "Visual Studio Code" },
    vscode,
    (root) => [root],
  );
  const explorer = await firstExisting(
    [
      systemRoot === undefined ? undefined : win32.join(systemRoot, "explorer.exe"),
      await find("explorer.exe"),
    ],
    pathExists,
  );
  addCommand(
    commands,
    { id: "explorer", kind: "file-manager", name: "文件资源管理器" },
    explorer,
    (root) => [root],
  );
  const windowsTerminal = await firstExisting(
    [
      localAppData === undefined
        ? undefined
        : win32.join(localAppData, "Microsoft", "WindowsApps", "wt.exe"),
      await find("wt.exe"),
    ],
    pathExists,
  );
  addCommand(
    commands,
    { id: "windows-terminal", kind: "terminal", name: "Windows Terminal" },
    windowsTerminal,
    (root) => ["-d", root],
  );
  const commandPrompt = await firstExisting(
    [
      readEnvironmentValue(environment, ["COMSPEC"]),
      systemRoot === undefined ? undefined : win32.join(systemRoot, "System32", "cmd.exe"),
    ],
    pathExists,
  );
  addCommand(
    commands,
    { id: "command-prompt", kind: "terminal", name: "命令提示符" },
    commandPrompt,
    () => ["/d", "/k"],
  );
  const androidStudio = await firstExisting(
    [
      programFiles === undefined
        ? undefined
        : win32.join(programFiles, "Android", "Android Studio", "bin", "studio64.exe"),
      programFilesX86 === undefined
        ? undefined
        : win32.join(programFilesX86, "Android", "Android Studio", "bin", "studio64.exe"),
      await find("studio64.exe"),
    ],
    pathExists,
  );
  addCommand(
    commands,
    { id: "android-studio", kind: "editor", name: "Android Studio" },
    androidStudio,
    (root) => [root],
  );
  return commands;
}

export function createProjectOpenService(
  options: CreateProjectOpenServiceOptions = {},
): ProjectOpenService {
  const platform = options.platform ?? (process.platform as ProjectOpenPlatform);
  const environment = options.environment ?? process.env;
  const pathExists = options.pathExists ?? defaultPathExists;
  const spawnDetached = options.spawnDetached ?? defaultSpawnDetached;

  const resolveCommands = () => {
    switch (platform) {
      case "darwin":
        return resolveMacCommands(environment, pathExists);
      case "linux":
        return resolveLinuxCommands(environment, pathExists);
      case "win32":
        return resolveWindowsCommands(environment, pathExists);
    }
  };

  return {
    async getCapabilities() {
      const commands = await resolveCommands();
      return { apps: [...commands.values()].map((command) => command.app), platform };
    },
    async open(projectRoot, appId) {
      const command = (await resolveCommands()).get(appId);
      if (command === undefined) {
        throw new ProjectOpenAppUnavailableError(appId);
      }
      await spawnDetached(command.file, command.args(projectRoot), {
        cwd: projectRoot,
        shell: false,
        windowsHide: false,
      });
    },
  };
}
