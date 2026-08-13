use std::process::{Command, ExitCode, Stdio};

use code_agent_mcp_command_proxy::locate_npx_runtime;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn main() -> ExitCode {
    match run() {
        Ok(code) => code,
        Err(error) => {
            eprintln!("{error}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<ExitCode, String> {
    let executable = std::env::current_exe()
        .map_err(|error| format!("Failed to resolve MCP command proxy: {error}"))?;
    let proxy_directory = executable
        .parent()
        .ok_or_else(|| "MCP command proxy directory is unavailable".to_owned())?;
    let search_paths = std::env::var_os("PATH")
        .map(|path| std::env::split_paths(&path).collect::<Vec<_>>())
        .unwrap_or_default();
    let (node, npx_cli) = locate_npx_runtime(proxy_directory, &search_paths)
        .ok_or_else(|| "Node.js with npm was not found in the desktop process PATH".to_owned())?;

    // 直接交给 `node.exe`，避免 `.cmd` 参数被 Shell 二次解析。
    let mut command = Command::new(node);
    command
        .arg(npx_cli)
        .args(std::env::args_os().skip(1))
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    let status = command
        .status()
        .map_err(|error| format!("Failed to start npx through Node.js: {error}"))?;
    Ok(status
        .code()
        .and_then(|code| u8::try_from(code).ok())
        .map_or(ExitCode::FAILURE, ExitCode::from))
}
