import { execFile } from "node:child_process";
import type { ExecFileException } from "node:child_process";

type ExecuteResult = Readonly<{ stderr: string; stdout: string }>;
type ExecuteFile = (file: string, args: readonly string[]) => Promise<ExecuteResult>;

export interface SelectSystemDirectoryOptions {
  execute?: ExecuteFile;
  platform?: string;
}

function executeFile(file: string, args: readonly string[]): Promise<ExecuteResult> {
  return new Promise((resolve, reject) => {
    execFile(file, [...args], { encoding: "utf8", windowsHide: true }, (error, stdout, stderr) => {
      if (error !== null) {
        reject(Object.assign(new Error(error.message, { cause: error }), { code: error.code }));
        return;
      }
      resolve({ stderr, stdout });
    });
  });
}

function pickerCommand(platform: string): Readonly<{ args: readonly string[]; file: string }> {
  if (platform === "darwin") {
    return {
      args: ["-e", 'POSIX path of (choose folder with prompt "选择项目文件夹")'],
      file: "osascript",
    };
  }
  if (platform === "win32") {
    return {
      args: [
        "-NoProfile",
        "-Command",
        "Add-Type -AssemblyName System.Windows.Forms; $dialog = New-Object System.Windows.Forms.FolderBrowserDialog; if ($dialog.ShowDialog() -eq 'OK') { [Console]::Write($dialog.SelectedPath) } else { exit 1 }",
      ],
      file: "powershell.exe",
    };
  }
  if (platform === "linux") {
    return {
      args: ["--file-selection", "--directory", "--title=选择项目文件夹"],
      file: "zenity",
    };
  }
  throw new Error(`Unsupported directory picker platform: ${platform}`);
}

export async function selectSystemDirectory(
  options: SelectSystemDirectoryOptions = {},
): Promise<string | undefined> {
  const command = pickerCommand(options.platform ?? process.platform);
  try {
    const result = await (options.execute ?? executeFile)(command.file, command.args);
    const path = result.stdout.trim();
    if (path.length === 0) {
      throw new Error("Directory picker returned an empty path");
    }
    return path;
  } catch (error) {
    const code = (error as ExecFileException).code;
    if (code === 1 || code === 130) {
      return undefined;
    }
    throw error;
  }
}
