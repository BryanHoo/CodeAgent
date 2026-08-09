import { DEFAULT_LAN_SESSION_TTL } from "./lan-access.js";

export interface ParsedCommandOptions {
  codexBin?: string;
  codexHome?: string;
  lan?: boolean;
  lanPassword?: string;
  port?: number;
  sessionTtl?: string;
}

export const CLI_HELP = `Usage: code-agent [command] [options]

Commands:
  start    Start the CodeAgent server and open the Web interface.
  doctor   Check whether the local CodeAgent runtime is ready.
  version  Print the installed CodeAgent version.

Start options:
  --port <port>              Listen on the specified TCP port. Defaults to 3210.
  --lan                      Listen on all network interfaces for trusted LAN access.
                             This disables automatic browser opening.
  --lan-password <password>  Use a custom strong LAN access password instead of a random one.
                             Requires 16-128 characters and all character types. Requires --lan.
  --session-ttl <duration>   Set the fixed LAN session lifetime using ms, s, m, h, or d.
                             Defaults to ${DEFAULT_LAN_SESSION_TTL}. Requires --lan.
  --codex-bin <path>         Use the Codex executable at the specified path.
  --codex-home <path>        Use a custom Codex home directory instead of CODEX_HOME
                             or the default ~/.codex directory.

Doctor options:
  --codex-bin <path>         Check the Codex executable at the specified path.
  --codex-home <path>        Check the state database in the specified Codex home.

Global options:
  -h, --help                 Display all commands, options, and usage details.

Examples:
  code-agent
  code-agent start --port 4567
  code-agent start --lan --lan-password 'Strong-Lan_Pass9!'
  code-agent start --lan --session-ttl 12h
  code-agent doctor --codex-bin /path/to/codex
  code-agent version

Running code-agent without a command is equivalent to code-agent start.
`;

export function parseCommandOptions(
  args: readonly string[],
  valueOptions: ReadonlySet<string>,
  flagOptions: ReadonlySet<string> = new Set(),
): ParsedCommandOptions {
  const parsed: ParsedCommandOptions = {};
  const seen = new Set<string>();

  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (!option || (!valueOptions.has(option) && !flagOptions.has(option))) {
      throw new Error(`未知选项: ${option ?? "<empty>"}`);
    }
    if (seen.has(option)) {
      throw new Error(`选项重复: ${option}`);
    }
    seen.add(option);
    if (flagOptions.has(option)) {
      if (option === "--lan") {
        parsed.lan = true;
      }
      continue;
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`选项缺少值: ${option}`);
    }

    if (option === "--codex-bin") {
      parsed.codexBin = value;
    } else if (option === "--codex-home") {
      parsed.codexHome = value;
    } else if (option === "--lan-password") {
      parsed.lanPassword = value;
    } else if (option === "--port") {
      if (!/^\d+$/u.test(value)) {
        throw new Error("--port 必须是 1 到 65535 之间的整数");
      }
      const port = Number(value);
      if (!Number.isInteger(port) || port < 1 || port > 65_535) {
        throw new Error("--port 必须是 1 到 65535 之间的整数");
      }
      parsed.port = port;
    } else if (option === "--session-ttl") {
      parsed.sessionTtl = value;
    }
    index += 1;
  }

  return parsed;
}
