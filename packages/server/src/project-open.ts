import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, lstat, realpath } from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  posix,
  relative,
  resolve as resolvePath,
  sep,
  win32,
} from "node:path";

import type {
  ProjectOpenApp,
  ProjectOpenAppId,
  ProjectOpenAppKind,
  ProjectOpenCapabilitiesResponse,
  ProjectOpenPlatform,
} from "@code-agent/protocol";

type SpawnDetachedOptions = Readonly<{
  cwd: string;
  observeEarlyExit: boolean;
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
  args: (target: ProjectOpenTarget) => readonly string[];
  file: string;
  observeEarlyExit: boolean;
  targetTypes: readonly ProjectOpenTarget["type"][];
}>;

type ProjectOpenTarget = Readonly<{
  absolutePath: string;
  directoryPath: string;
  projectRoot: string;
  type: "directory" | "file";
}>;

type ProjectOpenCommandMap = Map<ProjectOpenAppId, ProjectOpenCommand>;

type ProjectOpenCommandOptions = Readonly<{
  observeEarlyExit?: boolean;
  targetTypes?: readonly ProjectOpenTarget["type"][];
}>;

const DEFAULT_LAUNCH_CONFIRMATION_MS = 500;

export interface ProjectOpenService {
  getCapabilities: () => Promise<ProjectOpenCapabilitiesResponse>;
  open: (
    projectRoot: string,
    appId: ProjectOpenAppId,
    projectRelativePath?: string,
  ) => Promise<void>;
}

export interface CreateProjectOpenServiceOptions {
  environment?: NodeJS.ProcessEnv;
  launchConfirmationMs?: number;
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

export class ProjectOpenTargetInvalidError extends Error {
  public constructor() {
    super("Project open target is invalid");
    this.name = "ProjectOpenTargetInvalidError";
  }
}

function isOutsideProject(relativePath: string): boolean {
  return relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath);
}

async function resolveProjectOpenTarget(
  projectRoot: string,
  projectPath: string | undefined,
): Promise<ProjectOpenTarget> {
  if (projectPath === undefined) {
    return {
      absolutePath: projectRoot,
      directoryPath: projectRoot,
      projectRoot,
      type: "directory",
    };
  }

  try {
    if (!isAbsolute(projectRoot)) {
      throw new ProjectOpenTargetInvalidError();
    }
    const resolvedProjectRoot = await realpath(projectRoot);
    const relativeTargetPath = isAbsolute(projectPath)
      ? relative(resolvePath(projectRoot), projectPath)
      : projectPath;
    if (
      isOutsideProject(relativeTargetPath) ||
      relativeTargetPath.endsWith("/") ||
      relativeTargetPath.includes("\\") ||
      relativeTargetPath.includes("//") ||
      /^[A-Za-z]:/u.test(relativeTargetPath)
    ) {
      throw new ProjectOpenTargetInvalidError();
    }
    const segments = relativeTargetPath.split("/");
    if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
      throw new ProjectOpenTargetInvalidError();
    }

    let candidatePath = resolvedProjectRoot;
    let targetStats;
    // 逐段拒绝符号链接，避免即使最终 realpath 位于 Project 内也打开树中不可见的别名目标。
    for (const segment of segments) {
      candidatePath = resolvePath(candidatePath, segment);
      targetStats = await lstat(candidatePath);
      if (targetStats.isSymbolicLink()) {
        throw new ProjectOpenTargetInvalidError();
      }
    }
    const resolvedTargetPath = await realpath(candidatePath);
    if (isOutsideProject(relative(resolvedProjectRoot, resolvedTargetPath))) {
      throw new ProjectOpenTargetInvalidError();
    }
    if (targetStats === undefined || (!targetStats.isDirectory() && !targetStats.isFile())) {
      throw new ProjectOpenTargetInvalidError();
    }
    const type = targetStats.isDirectory() ? "directory" : "file";
    return {
      absolutePath: resolvedTargetPath,
      directoryPath: type === "directory" ? resolvedTargetPath : dirname(resolvedTargetPath),
      projectRoot: resolvedProjectRoot,
      type,
    };
  } catch (error) {
    if (error instanceof ProjectOpenTargetInvalidError) {
      throw error;
    }
    throw new ProjectOpenTargetInvalidError();
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
  launchConfirmationMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const { observeEarlyExit, ...spawnOptions } = options;
    const child = spawn(file, [...args], {
      ...spawnOptions,
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
      if (!observeEarlyExit) {
        // Windows 系统代理只负责转交请求，成功转交后的退出码不代表目标窗口启动失败。
        settle(() => {
          child.unref();
          resolve();
        });
        return;
      }
      // GUI 进程可能长驻；短暂观察可捕获启动失败，同时避免等待应用整个生命周期。
      confirmationTimer = setTimeout(() => {
        settle(() => {
          child.unref();
          resolve();
        });
      }, launchConfirmationMs);
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
  args: (target: ProjectOpenTarget) => readonly string[],
  options: ProjectOpenCommandOptions = {},
): void {
  if (file !== undefined) {
    commands.set(app.id, {
      app,
      args,
      file,
      observeEarlyExit: options.observeEarlyExit ?? true,
      targetTypes: options.targetTypes ?? ["directory", "file"],
    });
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
    addCommand(commands, { id, kind, name }, appPath === undefined ? undefined : open, (target) => [
      "-a",
      name,
      kind === "terminal" ? target.directoryPath : target.absolutePath,
    ]);
  };

  // 顺序与官方 App 的打开菜单一致，开发工具优先，系统位置与终端随后。
  await addMacApp("zed", "Zed", "editor");
  await addMacApp("windsurf", "Windsurf", "editor");
  await addMacApp("visual-studio-code", "Visual Studio Code", "editor");
  addCommand(
    commands,
    { id: "system-default", kind: "system-default", name: "系统默认应用" },
    open,
    (target) => [target.absolutePath],
    { targetTypes: ["file"] },
  );
  addCommand(commands, { id: "finder", kind: "file-manager", name: "Finder" }, open, (target) =>
    target.type === "file" ? ["-R", target.absolutePath] : [target.absolutePath],
  );
  const terminalPath = await firstExisting(
    ["/System/Applications/Utilities/Terminal.app", "/Applications/Utilities/Terminal.app"],
    pathExists,
  );
  addCommand(
    commands,
    { id: "terminal", kind: "terminal", name: "Terminal" },
    terminalPath === undefined ? undefined : open,
    (target) => ["-a", "Terminal", target.directoryPath],
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

  addCommand(commands, { id: "zed", kind: "editor", name: "Zed" }, await find("zed"), (target) => [
    target.absolutePath,
  ]);
  addCommand(
    commands,
    { id: "windsurf", kind: "editor", name: "Windsurf" },
    await find("windsurf"),
    (target) => [target.absolutePath],
  );
  addCommand(
    commands,
    { id: "visual-studio-code", kind: "editor", name: "Visual Studio Code" },
    await find("code"),
    (target) => [target.absolutePath],
  );
  const desktopOpen = await find("xdg-open");
  addCommand(
    commands,
    { id: "system-default", kind: "system-default", name: "系统默认应用" },
    desktopOpen,
    (target) => [target.absolutePath],
    { targetTypes: ["file"] },
  );
  addCommand(
    commands,
    { id: "file-manager", kind: "file-manager", name: "文件管理器" },
    desktopOpen,
    (target) => [target.directoryPath],
  );
  addCommand(
    commands,
    { id: "ghostty", kind: "terminal", name: "Ghostty" },
    await find("ghostty"),
    (target) => [`--working-directory=${target.directoryPath}`],
  );
  addCommand(
    commands,
    { id: "gnome-terminal", kind: "terminal", name: "GNOME Terminal" },
    await find("gnome-terminal"),
    (target) => [`--working-directory=${target.directoryPath}`],
  );
  addCommand(
    commands,
    { id: "konsole", kind: "terminal", name: "Konsole" },
    await find("konsole"),
    (target) => ["--workdir", target.directoryPath],
  );
  addCommand(
    commands,
    { id: "xfce-terminal", kind: "terminal", name: "Xfce Terminal" },
    await find("xfce4-terminal"),
    (target) => ["--working-directory", target.directoryPath],
  );
  const androidStudio = await firstExisting(
    ["/opt/android-studio/bin/studio.sh", await find("android-studio"), await find("studio.sh")],
    pathExists,
  );
  addCommand(
    commands,
    { id: "android-studio", kind: "editor", name: "Android Studio" },
    androidStudio,
    (target) => [target.absolutePath],
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
  addCommand(commands, { id: "zed", kind: "editor", name: "Zed" }, zed, (target) => [
    target.absolutePath,
  ]);
  const windsurf = await firstExisting(
    [
      localAppData === undefined
        ? undefined
        : win32.join(localAppData, "Programs", "Windsurf", "Windsurf.exe"),
      await find("Windsurf.exe"),
    ],
    pathExists,
  );
  addCommand(commands, { id: "windsurf", kind: "editor", name: "Windsurf" }, windsurf, (target) => [
    target.absolutePath,
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
    (target) => [target.absolutePath],
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
    { id: "system-default", kind: "system-default", name: "系统默认应用" },
    explorer,
    (target) => [target.absolutePath],
    { observeEarlyExit: false, targetTypes: ["file"] },
  );
  addCommand(
    commands,
    { id: "explorer", kind: "file-manager", name: "文件资源管理器" },
    explorer,
    (target) =>
      target.type === "file" ? ["/select,", target.absolutePath] : [target.absolutePath],
    { observeEarlyExit: false },
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
    (target) => ["-w", "new", "-d", target.directoryPath],
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
    (target) => [target.absolutePath],
  );
  return commands;
}

export function createProjectOpenService(
  options: CreateProjectOpenServiceOptions = {},
): ProjectOpenService {
  const platform = options.platform ?? (process.platform as ProjectOpenPlatform);
  const environment = options.environment ?? process.env;
  const pathExists = options.pathExists ?? defaultPathExists;
  // 生产保持短确认窗；测试和慢速宿主可延长观察时间，避免把迟到的失败退出判为成功。
  const launchConfirmationMs = options.launchConfirmationMs ?? DEFAULT_LAUNCH_CONFIRMATION_MS;
  const spawnDetached =
    options.spawnDetached ??
    ((file, args, spawnOptions) =>
      defaultSpawnDetached(file, args, spawnOptions, launchConfirmationMs));

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
    async open(projectRoot, appId, projectRelativePath) {
      const command = (await resolveCommands()).get(appId);
      if (command === undefined) {
        throw new ProjectOpenAppUnavailableError(appId);
      }
      const target = await resolveProjectOpenTarget(projectRoot, projectRelativePath);
      // 系统默认关联只对文件有明确语义，目录仍交给文件管理器等专用能力。
      if (!command.targetTypes.includes(target.type)) {
        throw new ProjectOpenTargetInvalidError();
      }
      await spawnDetached(command.file, command.args(target), {
        cwd: command.app.kind === "terminal" ? target.directoryPath : target.projectRoot,
        observeEarlyExit: command.observeEarlyExit,
        shell: false,
        windowsHide: false,
      });
    },
  };
}
