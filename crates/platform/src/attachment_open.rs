use std::path::Path;

use code_agent_core::CodeAgentError;

pub(crate) fn default_open_command(path: &Path) -> Result<tokio::process::Command, CodeAgentError> {
    #[cfg(target_os = "macos")]
    let mut command = tokio::process::Command::new("open");
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = tokio::process::Command::new("cmd");
        command.args(["/C", "start", ""]);
        command
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = tokio::process::Command::new("xdg-open");
    command.arg(path);
    command.kill_on_drop(true);
    Ok(command)
}
