use std::path::Path;

use super::{
    Arguments, OpenCommand, Platform, add, add_macos_app, app, environment_value, find_executable,
    first_existing, join,
};

pub(super) fn resolve_macos(
    environment: &[(&str, &str)],
    path_exists: &impl Fn(&Path) -> bool,
) -> Vec<OpenCommand> {
    let mut commands = Vec::new();
    let open = first_existing([Some("/usr/bin/open".to_owned())], path_exists);
    let Some(open) = open else { return commands };
    let home = environment_value(environment, "HOME");
    let resolve_app = |name: &str| {
        first_existing(
            [
                Some(format!("/Applications/{name}.app")),
                home.map(|home| format!("{home}/Applications/{name}.app")),
            ],
            path_exists,
        )
    };
    for (id, name, kind, terminal) in [
        ("zed", "Zed", "editor", false),
        ("windsurf", "Windsurf", "editor", false),
        ("visual-studio-code", "Visual Studio Code", "editor", false),
    ] {
        add_macos_app(&mut commands, &open, &resolve_app, id, name, kind, terminal);
    }
    add(
        &mut commands,
        app("system-default", "system-default", "系统默认应用"),
        Some(open.clone()),
        Arguments::Absolute,
    );
    commands.last_mut().expect("system default").file_only = true;
    add(
        &mut commands,
        app("finder", "file-manager", "Finder"),
        Some(open.clone()),
        Arguments::Finder,
    );
    commands.last_mut().expect("finder").observe_early_exit = false;
    let terminal = first_existing(
        [
            Some("/System/Applications/Utilities/Terminal.app".to_owned()),
            Some("/Applications/Utilities/Terminal.app".to_owned()),
        ],
        path_exists,
    );
    add(
        &mut commands,
        app("terminal", "terminal", "Terminal"),
        terminal.map(|_| open.clone()),
        Arguments::MacApp("Terminal", true),
    );
    for (id, name, kind, terminal) in [
        ("ghostty", "Ghostty", "terminal", true),
        ("xcode", "Xcode", "editor", false),
        ("android-studio", "Android Studio", "editor", false),
    ] {
        add_macos_app(&mut commands, &open, &resolve_app, id, name, kind, terminal);
    }
    commands
}

pub(super) fn resolve_linux(
    environment: &[(&str, &str)],
    path_exists: &impl Fn(&Path) -> bool,
) -> Vec<OpenCommand> {
    let mut commands = Vec::new();
    let find = |name| find_executable(name, Platform::Linux, environment, path_exists);
    for (id, kind, name, executable, arguments) in [
        ("zed", "editor", "Zed", find("zed"), Arguments::Absolute),
        (
            "windsurf",
            "editor",
            "Windsurf",
            find("windsurf"),
            Arguments::Absolute,
        ),
        (
            "visual-studio-code",
            "editor",
            "Visual Studio Code",
            find("code"),
            Arguments::Absolute,
        ),
    ] {
        add(&mut commands, app(id, kind, name), executable, arguments);
    }
    let desktop_open = find("xdg-open");
    add(
        &mut commands,
        app("system-default", "system-default", "系统默认应用"),
        desktop_open.clone(),
        Arguments::Absolute,
    );
    if let Some(command) = commands.last_mut() {
        command.file_only = true;
    }
    add(
        &mut commands,
        app("file-manager", "file-manager", "文件管理器"),
        desktop_open,
        Arguments::Directory,
    );
    for (id, name, executable, arguments) in [
        ("ghostty", "Ghostty", find("ghostty"), Arguments::Ghostty),
        (
            "gnome-terminal",
            "GNOME Terminal",
            find("gnome-terminal"),
            Arguments::GnomeTerminal,
        ),
        ("konsole", "Konsole", find("konsole"), Arguments::Konsole),
        (
            "xfce-terminal",
            "Xfce Terminal",
            find("xfce4-terminal"),
            Arguments::XfceTerminal,
        ),
    ] {
        add(
            &mut commands,
            app(id, "terminal", name),
            executable,
            arguments,
        );
    }
    let android_studio = first_existing(
        [
            Some("/opt/android-studio/bin/studio.sh".to_owned()),
            find("android-studio"),
            find("studio.sh"),
        ],
        path_exists,
    );
    add(
        &mut commands,
        app("android-studio", "editor", "Android Studio"),
        android_studio,
        Arguments::Absolute,
    );
    commands
}

pub(super) fn resolve_windows(
    environment: &[(&str, &str)],
    path_exists: &impl Fn(&Path) -> bool,
) -> Vec<OpenCommand> {
    let mut commands = Vec::new();
    let system_root = environment_value(environment, "SystemRoot")
        .or_else(|| environment_value(environment, "WINDIR"));
    let local_app_data = environment_value(environment, "LOCALAPPDATA");
    let program_files = environment_value(environment, "ProgramFiles");
    let program_files_x86 = environment_value(environment, "ProgramFiles(x86)");
    let find = |name| find_executable(name, Platform::Windows, environment, path_exists);
    let local_program = |path| local_app_data.map(|root| join(Platform::Windows, root, path));
    for (id, name, candidates) in [
        (
            "zed",
            "Zed",
            [local_program(r"Programs\Zed\Zed.exe"), find("Zed.exe")],
        ),
        (
            "windsurf",
            "Windsurf",
            [
                local_program(r"Programs\Windsurf\Windsurf.exe"),
                find("Windsurf.exe"),
            ],
        ),
    ] {
        let executable = first_existing(candidates, path_exists);
        add(
            &mut commands,
            app(id, "editor", name),
            executable,
            Arguments::Absolute,
        );
    }
    let vscode = first_existing(
        [
            local_program(r"Programs\Microsoft VS Code\Code.exe"),
            program_files.map(|root| join(Platform::Windows, root, r"Microsoft VS Code\Code.exe")),
            program_files_x86
                .map(|root| join(Platform::Windows, root, r"Microsoft VS Code\Code.exe")),
            find("Code.exe"),
        ],
        path_exists,
    );
    add(
        &mut commands,
        app("visual-studio-code", "editor", "Visual Studio Code"),
        vscode,
        Arguments::Absolute,
    );
    let explorer = first_existing(
        [
            system_root.map(|root| join(Platform::Windows, root, "explorer.exe")),
            find("explorer.exe"),
        ],
        path_exists,
    );
    add(
        &mut commands,
        app("system-default", "system-default", "系统默认应用"),
        explorer.clone(),
        Arguments::Absolute,
    );
    if let Some(command) = commands.last_mut() {
        command.file_only = true;
        command.observe_early_exit = false;
    }
    add(
        &mut commands,
        app("explorer", "file-manager", "文件资源管理器"),
        explorer,
        Arguments::Explorer,
    );
    if let Some(command) = commands.last_mut() {
        command.observe_early_exit = false;
    }
    let terminal = first_existing(
        [
            local_app_data
                .map(|root| join(Platform::Windows, root, r"Microsoft\WindowsApps\wt.exe")),
            find("wt.exe"),
        ],
        path_exists,
    );
    add(
        &mut commands,
        app("windows-terminal", "terminal", "Windows Terminal"),
        terminal,
        Arguments::WindowsTerminal,
    );
    let command_prompt = first_existing(
        [
            environment_value(environment, "COMSPEC").map(str::to_owned),
            system_root.map(|root| join(Platform::Windows, root, r"System32\cmd.exe")),
        ],
        path_exists,
    );
    add(
        &mut commands,
        app("command-prompt", "terminal", "命令提示符"),
        command_prompt,
        Arguments::CommandPrompt,
    );
    let android_studio = first_existing(
        [
            program_files.map(|root| {
                join(
                    Platform::Windows,
                    root,
                    r"Android\Android Studio\bin\studio64.exe",
                )
            }),
            program_files_x86.map(|root| {
                join(
                    Platform::Windows,
                    root,
                    r"Android\Android Studio\bin\studio64.exe",
                )
            }),
            find("studio64.exe"),
        ],
        path_exists,
    );
    add(
        &mut commands,
        app("android-studio", "editor", "Android Studio"),
        android_studio,
        Arguments::Absolute,
    );
    commands
}
