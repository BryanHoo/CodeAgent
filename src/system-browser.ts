import { spawn } from "node:child_process";

type BrowserCommand = Readonly<{ args: readonly string[]; executable: string }>;
type LaunchBrowserCommand = (command: BrowserCommand) => Promise<void>;

export interface OpenSystemBrowserOptions {
  launch?: LaunchBrowserCommand;
  platform?: NodeJS.Platform;
}

function browserCommands(url: string, platform: NodeJS.Platform): readonly BrowserCommand[] {
  if (platform === "darwin") {
    return [{ args: [url], executable: "open" }];
  }
  if (platform === "win32") {
    return [{ args: ["/c", "start", "", url], executable: "cmd.exe" }];
  }
  return [
    { args: [url], executable: "xdg-open" },
    { args: ["open", url], executable: "gio" },
    { args: [url], executable: "sensible-browser" },
  ];
}

function launchBrowserCommand(command: BrowserCommand): Promise<void> {
  return new Promise((resolveOpen, reject) => {
    const child = spawn(command.executable, [...command.args], {
      detached: true,
      shell: false,
      stdio: "ignore",
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolveOpen();
    });
  });
}

export async function openSystemBrowser(
  url: string,
  options: OpenSystemBrowserOptions = {},
): Promise<void> {
  const commands = browserCommands(url, options.platform ?? process.platform);
  const launch = options.launch ?? launchBrowserCommand;
  let lastMissingError: unknown;

  for (const command of commands) {
    try {
      await launch(command);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      lastMissingError = error;
    }
  }

  throw new Error("No supported browser launcher is installed", { cause: lastMissingError });
}
