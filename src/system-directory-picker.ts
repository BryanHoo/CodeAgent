import { execFile } from "node:child_process";
import type { ExecFileException } from "node:child_process";
import { isAbsolute } from "node:path";
import { createInterface } from "node:readline/promises";

type ExecuteResult = Readonly<{ stderr: string; stdout: string }>;
type ExecuteFile = (file: string, args: readonly string[]) => Promise<ExecuteResult>;
type PickerCommand = Readonly<{ args: readonly string[]; file: string }>;
type PromptDirectory = () => Promise<string | undefined>;

export interface SelectSystemDirectoryOptions {
  execute?: ExecuteFile;
  platform?: string;
  prompt?: PromptDirectory;
}

async function promptDirectory(): Promise<string | undefined> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return undefined;
  }
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const path = (await terminal.question("请输入项目绝对路径: ")).trim();
    return path || undefined;
  } finally {
    terminal.close();
  }
}

function executeFile(file: string, args: readonly string[]): Promise<ExecuteResult> {
  return new Promise((resolve, reject) => {
    execFile(file, [...args], { encoding: "utf8", windowsHide: true }, (error, stdout, stderr) => {
      if (error !== null) {
        reject(
          Object.assign(new Error(error.message, { cause: error }), {
            code: error.code,
            stderr,
          }),
        );
        return;
      }
      resolve({ stderr, stdout });
    });
  });
}

function pickerCommands(platform: string): readonly PickerCommand[] {
  if (platform === "darwin") {
    return [
      {
        args: ["-e", 'POSIX path of (choose folder with prompt "选择项目文件夹")'],
        file: "osascript",
      },
    ];
  }
  if (platform === "win32") {
    return [
      {
        args: [
          "-NoProfile",
          "-NonInteractive",
          "-STA",
          "-Command",
          "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); Add-Type -AssemblyName System.Windows.Forms; $dialog = New-Object System.Windows.Forms.FolderBrowserDialog; if ($dialog.ShowDialog() -eq 'OK') { [Console]::Write($dialog.SelectedPath) } else { exit 2 }",
        ],
        file: "powershell.exe",
      },
    ];
  }
  if (platform === "linux") {
    return [
      {
        args: ["--file-selection", "--directory", "--title=选择项目文件夹"],
        file: "zenity",
      },
      {
        args: ["--getexistingdirectory", ".", "--title", "选择项目文件夹"],
        file: "kdialog",
      },
    ];
  }
  throw new Error(`Unsupported directory picker platform: ${platform}`);
}

function isMissingExecutable(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

function isLinuxPickerStartupFailure(stderr: string): boolean {
  return [
    /cannot open display/iu,
    /could not connect to display/iu,
    /failed to open display/iu,
    /no display name.*\$DISPLAY/iu,
    /unable to init server/iu,
  ].some((pattern) => pattern.test(stderr));
}

function isPickerCancellation(error: unknown, platform: string): boolean {
  const code = (error as ExecFileException).code;
  const errorStderr = (error as { stderr?: unknown }).stderr;
  const stderr = typeof errorStderr === "string" ? errorStderr.trim() : "";
  if (platform === "darwin") {
    return code === 1 && (stderr.includes("User canceled") || stderr.includes("(-128)"));
  }
  if (platform === "win32") {
    return code === 2;
  }
  // Zenity 与 KDialog 都使用退出码 1 表示取消；非致命 GTK 警告不能触发终端回退。
  return code === 130 || (code === 1 && !isLinuxPickerStartupFailure(stderr));
}

export async function selectSystemDirectory(
  options: SelectSystemDirectoryOptions = {},
): Promise<string | undefined> {
  const platform = options.platform ?? process.platform;
  const commands = pickerCommands(platform);
  const execute = options.execute ?? executeFile;
  let lastPickerError: unknown;

  for (const command of commands) {
    try {
      const result = await execute(command.file, command.args);
      const path = result.stdout.trim();
      if (path.length === 0) {
        throw new Error("Directory picker returned an empty path");
      }
      return path;
    } catch (error) {
      if (isPickerCancellation(error, platform)) {
        return undefined;
      }
      if (isMissingExecutable(error)) {
        lastPickerError = error;
        continue;
      }
      if (platform === "linux") {
        // 桌面会话不可用时继续尝试其他选择器，最终仍可回退到 CLI 绝对路径输入。
        lastPickerError = error;
        continue;
      }
      throw error;
    }
  }

  if (platform === "linux") {
    const terminalPath = await (options.prompt ?? promptDirectory)();
    if (terminalPath !== undefined) {
      if (!isAbsolute(terminalPath)) {
        throw new Error("Terminal directory path must be absolute");
      }
      return terminalPath;
    }
  }

  const commandNames = commands.map((command) => command.file).join(" or ");
  throw new Error(`No supported directory picker is installed; expected ${commandNames}`, {
    cause: lastPickerError,
  });
}
