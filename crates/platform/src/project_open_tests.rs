use std::{collections::HashSet, path::Path};

use crate::process::ProcessEnvironment;

use super::{
    Arguments, OpenApp, OpenCommand, OpenTarget, Platform, launch, resolve_commands,
    resolve_commands_with_environment,
};

fn existing(paths: &[&str]) -> impl Fn(&Path) -> bool {
    let paths = paths
        .iter()
        .map(|path| (*path).to_owned())
        .collect::<HashSet<_>>();
    move |path| paths.contains(&path.to_string_lossy().into_owned())
}

#[test]
fn detects_installed_macos_apps_and_preserves_file_directory_semantics() {
    let commands = resolve_commands(
        Platform::MacOs,
        &[("HOME", "/Users/test")],
        &existing(&[
            "/usr/bin/open",
            "/Applications/Zed.app",
            "/Applications/Windsurf.app",
            "/Applications/Visual Studio Code.app",
            "/System/Applications/Utilities/Terminal.app",
        ]),
    );

    assert_eq!(
        commands
            .iter()
            .map(|command| command.app.id)
            .collect::<Vec<_>>(),
        [
            "zed",
            "windsurf",
            "visual-studio-code",
            "system-default",
            "finder",
            "terminal"
        ]
    );
    let finder = commands
        .iter()
        .find(|command| command.app.id == "finder")
        .expect("finder");
    assert_eq!(
        finder.arguments(&OpenTarget::file("/workspace/src/main.rs")),
        ["-R", "/workspace/src/main.rs"]
    );
    assert_eq!(
        finder.arguments(&OpenTarget::directory("/workspace/src")),
        ["/workspace/src"]
    );
    assert!(!finder.observe_early_exit);
}

#[test]
fn only_exposes_installed_linux_apps_and_builds_terminal_arguments() {
    let commands = resolve_commands(
        Platform::Linux,
        &[("PATH", "/usr/bin:/opt/bin")],
        &existing(&[
            "/usr/bin/xdg-open",
            "/usr/bin/zed",
            "/opt/bin/code",
            "/usr/bin/konsole",
        ]),
    );

    assert_eq!(
        commands
            .iter()
            .map(|command| command.app.id)
            .collect::<Vec<_>>(),
        [
            "zed",
            "visual-studio-code",
            "system-default",
            "file-manager",
            "konsole"
        ]
    );
    assert_eq!(
        commands
            .iter()
            .find(|command| command.app.id == "konsole")
            .expect("konsole")
            .arguments(&OpenTarget::file("/workspace/src/main.rs")),
        ["--workdir", "/workspace/src"]
    );
}

#[test]
fn injected_environment_controls_linux_app_discovery() {
    let environment = ProcessEnvironment::from_variables([("PATH", "/host-tools")]);

    let commands = resolve_commands_with_environment(
        Platform::Linux,
        &environment,
        &existing(&["/host-tools/code"]),
    );

    assert_eq!(
        commands
            .iter()
            .map(|command| command.app.id)
            .collect::<Vec<_>>(),
        ["visual-studio-code"]
    );
}

#[test]
fn detects_windows_apps_and_uses_broker_launch_semantics() {
    let commands = resolve_commands(
        Platform::Windows,
        &[
            ("SystemRoot", r"C:\Windows"),
            ("LOCALAPPDATA", r"C:\Users\test\AppData\Local"),
            ("ProgramFiles", r"C:\Program Files"),
        ],
        &existing(&[
            r"C:\Windows\explorer.exe",
            r"C:\Windows\System32\cmd.exe",
            r"C:\Users\test\AppData\Local\Programs\Microsoft VS Code\Code.exe",
            r"C:\Users\test\AppData\Local\Microsoft\WindowsApps\wt.exe",
            r"C:\Program Files\Android\Android Studio\bin\studio64.exe",
        ]),
    );

    assert_eq!(
        commands
            .iter()
            .map(|command| command.app.id)
            .collect::<Vec<_>>(),
        [
            "visual-studio-code",
            "system-default",
            "explorer",
            "windows-terminal",
            "command-prompt",
            "android-studio"
        ]
    );
    let explorer = commands
        .iter()
        .find(|command| command.app.id == "explorer")
        .expect("explorer");
    assert!(!explorer.observe_early_exit);
    assert_eq!(
        explorer.arguments(&OpenTarget::file(r"C:\workspace\src\main.rs")),
        ["/select,", r"C:\workspace\src\main.rs"]
    );
    assert_eq!(
        commands
            .iter()
            .find(|command| command.app.id == "windows-terminal")
            .expect("windows terminal")
            .arguments(&OpenTarget::directory(r"C:\workspace")),
        ["-w", "new", "-d", r"C:\workspace"]
    );
}

#[cfg(unix)]
#[tokio::test]
async fn broker_launch_does_not_report_a_fast_nonzero_proxy_exit() {
    let command = OpenCommand {
        app: OpenApp {
            id: "finder",
            kind: "file-manager",
            name: "Finder",
        },
        program: "/usr/bin/false".to_owned(),
        arguments: Arguments::Absolute,
        observe_early_exit: false,
        file_only: false,
    };

    assert!(
        launch(
            &command,
            &OpenTarget::directory("/tmp"),
            Path::new("/tmp"),
            None,
        )
        .await
        .is_ok()
    );
}
