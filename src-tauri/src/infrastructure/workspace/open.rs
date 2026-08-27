use std::path::Path;

use serde::Serialize;
use tokio::process::Command;

use super::path_guard::WorkspaceError;

#[derive(Debug, Serialize)]
pub struct OpenApp {
    pub id: &'static str,
    pub kind: &'static str,
    pub name: &'static str,
}

#[cfg(target_os = "macos")]
pub fn platform_apps() -> (&'static str, Vec<OpenApp>) {
    (
        "darwin",
        vec![
            OpenApp {
                id: "system-default",
                kind: "system-default",
                name: "默认应用",
            },
            OpenApp {
                id: "finder",
                kind: "file-manager",
                name: "Finder",
            },
            OpenApp {
                id: "terminal",
                kind: "terminal",
                name: "Terminal",
            },
            OpenApp {
                id: "visual-studio-code",
                kind: "editor",
                name: "Visual Studio Code",
            },
            OpenApp {
                id: "xcode",
                kind: "editor",
                name: "Xcode",
            },
        ],
    )
}

#[cfg(target_os = "linux")]
pub fn platform_apps() -> (&'static str, Vec<OpenApp>) {
    (
        "linux",
        vec![
            OpenApp {
                id: "system-default",
                kind: "system-default",
                name: "默认应用",
            },
            OpenApp {
                id: "file-manager",
                kind: "file-manager",
                name: "文件管理器",
            },
            OpenApp {
                id: "terminal",
                kind: "terminal",
                name: "Terminal",
            },
            OpenApp {
                id: "visual-studio-code",
                kind: "editor",
                name: "Visual Studio Code",
            },
        ],
    )
}

#[cfg(target_os = "windows")]
pub fn platform_apps() -> (&'static str, Vec<OpenApp>) {
    (
        "win32",
        vec![
            OpenApp {
                id: "system-default",
                kind: "system-default",
                name: "默认应用",
            },
            OpenApp {
                id: "explorer",
                kind: "file-manager",
                name: "Explorer",
            },
            OpenApp {
                id: "windows-terminal",
                kind: "terminal",
                name: "Windows Terminal",
            },
            OpenApp {
                id: "visual-studio-code",
                kind: "editor",
                name: "Visual Studio Code",
            },
        ],
    )
}

pub async fn open_path(app_id: &str, path: &Path) -> Result<(), WorkspaceError> {
    if !path.exists() {
        return Err(WorkspaceError::InvalidPath);
    }
    let status = platform_command(app_id, path)?.status().await?;
    status
        .success()
        .then_some(())
        .ok_or(WorkspaceError::InvalidPath)
}

#[cfg(target_os = "macos")]
fn platform_command(app_id: &str, path: &Path) -> Result<Command, WorkspaceError> {
    let mut command = Command::new("open");
    match app_id {
        "system-default" => {}
        "finder" => {
            command.arg("-R");
        }
        "terminal" => {
            command.args(["-a", "Terminal"]);
        }
        "visual-studio-code" => {
            command.args(["-a", "Visual Studio Code"]);
        }
        "xcode" => {
            command.args(["-a", "Xcode"]);
        }
        _ => return Err(WorkspaceError::InvalidPath),
    }
    command.arg(path);
    Ok(command)
}

#[cfg(target_os = "linux")]
fn platform_command(app_id: &str, path: &Path) -> Result<Command, WorkspaceError> {
    let mut command = match app_id {
        "system-default" | "file-manager" => Command::new("xdg-open"),
        "terminal" => Command::new("x-terminal-emulator"),
        "visual-studio-code" => Command::new("code"),
        _ => return Err(WorkspaceError::InvalidPath),
    };
    command.arg(path);
    Ok(command)
}

#[cfg(target_os = "windows")]
fn platform_command(app_id: &str, path: &Path) -> Result<Command, WorkspaceError> {
    let mut command = match app_id {
        "system-default" | "explorer" => Command::new("explorer"),
        "windows-terminal" => Command::new("wt"),
        "visual-studio-code" => Command::new("code"),
        _ => return Err(WorkspaceError::InvalidPath),
    };
    command.arg(path);
    Ok(command)
}
