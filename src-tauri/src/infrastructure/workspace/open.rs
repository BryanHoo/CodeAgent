use std::path::Path;

use serde::Serialize;
use tokio::process::Command;

use super::path_guard::WorkspaceError;

#[derive(Clone, Copy, Debug, Serialize)]
pub struct OpenApp {
    pub id: &'static str,
    pub kind: &'static str,
    pub name: &'static str,
}

#[cfg(target_os = "macos")]
#[derive(Clone, Copy)]
struct MacApp {
    app: OpenApp,
    bundle_path: &'static str,
    open_name: &'static str,
}

#[cfg(target_os = "macos")]
const MAC_APPS: [MacApp; 9] = [
    MacApp {
        app: OpenApp {
            id: "finder",
            kind: "file-manager",
            name: "Finder",
        },
        bundle_path: "/System/Library/CoreServices/Finder.app",
        open_name: "Finder",
    },
    MacApp {
        app: OpenApp {
            id: "terminal",
            kind: "terminal",
            name: "Terminal",
        },
        bundle_path: "/System/Applications/Utilities/Terminal.app",
        open_name: "Terminal",
    },
    MacApp {
        app: OpenApp {
            id: "ghostty",
            kind: "terminal",
            name: "Ghostty",
        },
        bundle_path: "/Applications/Ghostty.app",
        open_name: "Ghostty",
    },
    MacApp {
        app: OpenApp {
            id: "iterm2",
            kind: "terminal",
            name: "iTerm2",
        },
        bundle_path: "/Applications/iTerm.app",
        open_name: "iTerm",
    },
    MacApp {
        app: OpenApp {
            id: "visual-studio-code",
            kind: "editor",
            name: "Visual Studio Code",
        },
        bundle_path: "/Applications/Visual Studio Code.app",
        open_name: "Visual Studio Code",
    },
    MacApp {
        app: OpenApp {
            id: "zed",
            kind: "editor",
            name: "Zed",
        },
        bundle_path: "/Applications/Zed.app",
        open_name: "Zed",
    },
    MacApp {
        app: OpenApp {
            id: "windsurf",
            kind: "editor",
            name: "Windsurf",
        },
        bundle_path: "/Applications/Windsurf.app",
        open_name: "Windsurf",
    },
    MacApp {
        app: OpenApp {
            id: "xcode",
            kind: "editor",
            name: "Xcode",
        },
        bundle_path: "/Applications/Xcode.app",
        open_name: "Xcode",
    },
    MacApp {
        app: OpenApp {
            id: "android-studio",
            kind: "editor",
            name: "Android Studio",
        },
        bundle_path: "/Applications/Android Studio.app",
        open_name: "Android Studio",
    },
];

#[cfg(target_os = "macos")]
pub fn platform_apps() -> (&'static str, Vec<OpenApp>) {
    let home = std::env::var_os("HOME").map(std::path::PathBuf::from);
    (
        "darwin",
        macos_apps_for_paths(home.as_deref(), Path::exists),
    )
}

#[cfg(target_os = "linux")]
pub fn platform_apps() -> (&'static str, Vec<OpenApp>) {
    (
        "linux",
        available_path_apps(vec![
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
            OpenApp {
                id: "zed",
                kind: "editor",
                name: "Zed",
            },
            OpenApp {
                id: "windsurf",
                kind: "editor",
                name: "Windsurf",
            },
            OpenApp {
                id: "android-studio",
                kind: "editor",
                name: "Android Studio",
            },
            OpenApp {
                id: "gnome-terminal",
                kind: "terminal",
                name: "GNOME Terminal",
            },
            OpenApp {
                id: "konsole",
                kind: "terminal",
                name: "Konsole",
            },
            OpenApp {
                id: "xfce-terminal",
                kind: "terminal",
                name: "Xfce Terminal",
            },
        ]),
    )
}

#[cfg(target_os = "windows")]
pub fn platform_apps() -> (&'static str, Vec<OpenApp>) {
    (
        "win32",
        available_path_apps(vec![
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
        ]),
    )
}

#[cfg(target_os = "macos")]
fn macos_apps_for_paths(home: Option<&Path>, exists: impl Fn(&Path) -> bool) -> Vec<OpenApp> {
    let mut apps = vec![OpenApp {
        id: "system-default",
        kind: "system-default",
        name: "默认应用",
    }];
    apps.extend(MAC_APPS.into_iter().filter_map(|candidate| {
        let global = exists(Path::new(candidate.bundle_path));
        let user = home.is_some_and(|home| {
            Path::new(candidate.bundle_path)
                .file_name()
                .is_some_and(|name| exists(&home.join("Applications").join(name)))
        });
        (global || user).then_some(candidate.app)
    }));
    apps
}

#[cfg(any(target_os = "linux", target_os = "windows"))]
fn available_path_apps(apps: Vec<OpenApp>) -> Vec<OpenApp> {
    apps.into_iter()
        .filter(|app| executable_in_path(command_name(app.id)))
        .collect()
}

#[cfg(any(target_os = "linux", target_os = "windows"))]
fn executable_in_path(name: &str) -> bool {
    std::env::var_os("PATH").is_some_and(|paths| {
        std::env::split_paths(&paths).any(|directory| {
            let candidate = directory.join(name);
            candidate.is_file()
                || cfg!(target_os = "windows") && candidate.with_extension("exe").is_file()
        })
    })
}

#[cfg(target_os = "linux")]
fn command_name(app_id: &str) -> &str {
    match app_id {
        "system-default" | "file-manager" => "xdg-open",
        "terminal" => "x-terminal-emulator",
        "visual-studio-code" => "code",
        "zed" => "zed",
        "windsurf" => "windsurf",
        "android-studio" => "android-studio",
        "gnome-terminal" => "gnome-terminal",
        "konsole" => "konsole",
        "xfce-terminal" => "xfce4-terminal",
        _ => "",
    }
}

#[cfg(target_os = "windows")]
fn command_name(app_id: &str) -> &str {
    match app_id {
        "system-default" | "explorer" => "explorer",
        "windows-terminal" => "wt",
        "visual-studio-code" => "code",
        _ => "",
    }
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
        _ => {
            let app = MAC_APPS
                .iter()
                .find(|candidate| candidate.app.id == app_id)
                .ok_or(WorkspaceError::InvalidPath)?;
            command.args(["-a", app.open_name]);
        }
    }
    command.arg(path);
    Ok(command)
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use std::collections::HashSet;

    use super::macos_apps_for_paths;

    #[test]
    fn macos_apps_should_only_include_installed_development_tools() {
        let installed = HashSet::from([
            "/Applications/Zed.app",
            "/Applications/Ghostty.app",
            "/Applications/iTerm.app",
        ]);
        let apps = macos_apps_for_paths(None, |path| {
            path.to_str().is_some_and(|path| installed.contains(path))
        });
        let ids: Vec<_> = apps.iter().map(|app| app.id).collect();

        assert!(ids.contains(&"zed"));
        assert!(ids.contains(&"ghostty"));
        assert!(ids.contains(&"iterm2"));
        assert!(!ids.contains(&"visual-studio-code"));
    }
}

#[cfg(target_os = "linux")]
fn platform_command(app_id: &str, path: &Path) -> Result<Command, WorkspaceError> {
    let mut command = match app_id {
        "system-default" | "file-manager" => Command::new("xdg-open"),
        "terminal" => Command::new("x-terminal-emulator"),
        "visual-studio-code" => Command::new("code"),
        "zed" => Command::new("zed"),
        "windsurf" => Command::new("windsurf"),
        "android-studio" => Command::new("android-studio"),
        "gnome-terminal" => Command::new("gnome-terminal"),
        "konsole" => Command::new("konsole"),
        "xfce-terminal" => Command::new("xfce4-terminal"),
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
