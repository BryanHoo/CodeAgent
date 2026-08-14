use std::{path::Path, process::Stdio, sync::Arc, time::Duration};

use code_agent_core::{CodeAgentError, CodeAgentErrorCode};
use serde_json::{Value, json};

#[path = "project_open_commands.rs"]
mod commands;

use commands::{resolve_linux, resolve_macos, resolve_windows};

use crate::process::ProcessEnvironment;

const LAUNCH_CONFIRMATION: Duration = Duration::from_millis(500);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum Platform {
    MacOs,
    Linux,
    Windows,
}

impl Platform {
    fn current() -> Self {
        #[cfg(target_os = "macos")]
        return Self::MacOs;
        #[cfg(target_os = "windows")]
        return Self::Windows;
        #[cfg(target_os = "linux")]
        return Self::Linux;
    }

    const fn protocol_name(self) -> &'static str {
        match self {
            Self::MacOs => "darwin",
            Self::Linux => "linux",
            Self::Windows => "win32",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum TargetType {
    Directory,
    File,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct OpenTarget {
    absolute_path: String,
    directory_path: String,
    target_type: TargetType,
}

impl OpenTarget {
    pub(crate) fn new(path: &Path, is_directory: bool) -> Self {
        let absolute_path = path.to_string_lossy().into_owned();
        if is_directory {
            return Self::directory(&absolute_path);
        }
        Self::file(&absolute_path)
    }

    fn directory(path: &str) -> Self {
        Self {
            absolute_path: path.to_owned(),
            directory_path: path.to_owned(),
            target_type: TargetType::Directory,
        }
    }

    fn file(path: &str) -> Self {
        let separator = path.rfind(['/', '\\']).unwrap_or(0);
        let directory_path = match separator {
            0 => "/".to_owned(),
            2 if path.as_bytes().get(1) == Some(&b':') => path[..=separator].to_owned(),
            index => path[..index].to_owned(),
        };
        Self {
            absolute_path: path.to_owned(),
            directory_path,
            target_type: TargetType::File,
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct OpenApp {
    pub(crate) id: &'static str,
    kind: &'static str,
    name: &'static str,
}

#[derive(Clone, Copy, Debug)]
enum Arguments {
    Absolute,
    Directory,
    MacApp(&'static str, bool),
    Finder,
    Ghostty,
    GnomeTerminal,
    Konsole,
    XfceTerminal,
    Explorer,
    WindowsTerminal,
    CommandPrompt,
}

#[derive(Clone, Debug)]
pub(crate) struct OpenCommand {
    pub(crate) app: OpenApp,
    program: String,
    arguments: Arguments,
    pub(crate) observe_early_exit: bool,
    file_only: bool,
}

#[derive(Clone, Debug)]
pub(crate) struct ProjectOpenService {
    commands: Arc<[OpenCommand]>,
    environment: ProcessEnvironment,
    platform: Platform,
}

impl ProjectOpenService {
    pub(crate) fn new(environment: ProcessEnvironment) -> Self {
        let platform = Platform::current();
        let commands =
            resolve_commands_with_environment(platform, &environment, &default_path_exists);
        Self {
            commands: commands.into(),
            environment,
            platform,
        }
    }

    pub(crate) fn capabilities(&self) -> Value {
        let apps = self
            .commands
            .iter()
            .map(|command| {
                json!({ "id": command.app.id, "kind": command.app.kind, "name": command.app.name })
            })
            .collect::<Vec<_>>();
        json!({ "apps": apps, "platform": self.platform.protocol_name() })
    }

    pub(crate) async fn open(
        &self,
        target: &OpenTarget,
        project_root: &Path,
        app_id: &str,
    ) -> Result<(), CodeAgentError> {
        let command = self
            .commands
            .iter()
            .find(|command| command.app.id == app_id)
            .ok_or_else(|| {
                CodeAgentError::new(
                    CodeAgentErrorCode::InvalidInput,
                    "open app is unavailable",
                    None,
                )
            })?;
        if !command.supports(target) {
            return Err(CodeAgentError::new(
                CodeAgentErrorCode::InvalidInput,
                "open target is invalid",
                None,
            ));
        }
        launch(command, target, project_root, Some(&self.environment)).await
    }
}

impl OpenCommand {
    fn arguments(&self, target: &OpenTarget) -> Vec<String> {
        let values: Vec<&str> = match self.arguments {
            Arguments::Absolute => vec![&target.absolute_path],
            Arguments::Directory => vec![&target.directory_path],
            Arguments::MacApp(name, terminal) => vec![
                "-a",
                name,
                if terminal {
                    &target.directory_path
                } else {
                    &target.absolute_path
                },
            ],
            Arguments::Finder if target.target_type == TargetType::File => {
                vec!["-R", &target.absolute_path]
            }
            Arguments::Finder => vec![&target.absolute_path],
            Arguments::Ghostty => {
                return vec![format!("--working-directory={}", target.directory_path)];
            }
            Arguments::GnomeTerminal => {
                return vec![format!("--working-directory={}", target.directory_path)];
            }
            Arguments::Konsole => vec!["--workdir", &target.directory_path],
            Arguments::XfceTerminal => vec!["--working-directory", &target.directory_path],
            Arguments::Explorer if target.target_type == TargetType::File => {
                vec!["/select,", &target.absolute_path]
            }
            Arguments::Explorer => vec![&target.absolute_path],
            Arguments::WindowsTerminal => vec!["-w", "new", "-d", &target.directory_path],
            Arguments::CommandPrompt => vec!["/d", "/k"],
        };
        values.into_iter().map(str::to_owned).collect()
    }

    fn supports(&self, target: &OpenTarget) -> bool {
        !self.file_only || target.target_type == TargetType::File
    }
}

fn environment_value<'a>(environment: &'a [(&str, &str)], name: &str) -> Option<&'a str> {
    environment
        .iter()
        .find(|(key, value)| key.eq_ignore_ascii_case(name) && !value.is_empty())
        .map(|(_, value)| *value)
}

fn join(platform: Platform, base: &str, child: &str) -> String {
    let separator = if platform == Platform::Windows {
        '\\'
    } else {
        '/'
    };
    format!(
        "{}{}{}",
        base.trim_end_matches(['/', '\\']),
        separator,
        child
    )
}

fn first_existing(
    candidates: impl IntoIterator<Item = Option<String>>,
    path_exists: &impl Fn(&Path) -> bool,
) -> Option<String> {
    candidates
        .into_iter()
        .flatten()
        .find(|path| path_exists(Path::new(path)))
}

fn find_executable(
    command: &str,
    platform: Platform,
    environment: &[(&str, &str)],
    path_exists: &impl Fn(&Path) -> bool,
) -> Option<String> {
    let delimiter = if platform == Platform::Windows {
        ';'
    } else {
        ':'
    };
    first_existing(
        environment_value(environment, "PATH")
            .into_iter()
            .flat_map(|path| path.split(delimiter))
            .filter(|directory| !directory.is_empty())
            .map(|directory| Some(join(platform, directory, command))),
        path_exists,
    )
}

fn add(
    commands: &mut Vec<OpenCommand>,
    app: OpenApp,
    program: Option<String>,
    arguments: Arguments,
) {
    if let Some(program) = program {
        commands.push(OpenCommand {
            app,
            program,
            arguments,
            observe_early_exit: true,
            file_only: false,
        });
    }
}

fn app(id: &'static str, kind: &'static str, name: &'static str) -> OpenApp {
    OpenApp { id, kind, name }
}

fn add_macos_app(
    commands: &mut Vec<OpenCommand>,
    open: &str,
    resolve_app: &impl Fn(&str) -> Option<String>,
    id: &'static str,
    name: &'static str,
    kind: &'static str,
    terminal: bool,
) {
    let program = resolve_app(name).map(|_| open.to_owned());
    add(
        commands,
        app(id, kind, name),
        program,
        Arguments::MacApp(name, terminal),
    );
}

fn resolve_commands(
    platform: Platform,
    environment: &[(&str, &str)],
    path_exists: &impl Fn(&Path) -> bool,
) -> Vec<OpenCommand> {
    match platform {
        Platform::MacOs => resolve_macos(environment, path_exists),
        Platform::Linux => resolve_linux(environment, path_exists),
        Platform::Windows => resolve_windows(environment, path_exists),
    }
}

fn resolve_commands_with_environment(
    platform: Platform,
    environment: &ProcessEnvironment,
    path_exists: &impl Fn(&Path) -> bool,
) -> Vec<OpenCommand> {
    let variables = environment.utf8_variables().collect::<Vec<_>>();
    resolve_commands(platform, &variables, path_exists)
}

fn default_path_exists(path: &Path) -> bool {
    let Ok(metadata) = std::fs::metadata(path) else {
        return false;
    };
    if metadata.is_dir() {
        // macOS 应用以 .app 目录存在，能力探测必须保留真实可访问的应用包。
        return true;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        metadata.is_file() && metadata.permissions().mode() & 0o111 != 0
    }
    #[cfg(windows)]
    {
        metadata.is_file()
    }
}

async fn launch(
    command: &OpenCommand,
    target: &OpenTarget,
    project_root: &Path,
    environment: Option<&ProcessEnvironment>,
) -> Result<(), CodeAgentError> {
    let mut process = tokio::process::Command::new(&command.program);
    if let Some(environment) = environment {
        environment.apply(&mut process);
    }
    process
        .args(command.arguments(target))
        .current_dir(if command.app.kind == "terminal" {
            Path::new(&target.directory_path)
        } else {
            project_root
        })
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let mut child = process
        .spawn()
        .map_err(|_| CodeAgentError::internal("system open could not start"))?;
    if !command.observe_early_exit {
        // Finder 和 Explorer 只负责把请求转交给系统，代理退出码不能代表打开结果。
        return Ok(());
    }
    match tokio::time::timeout(LAUNCH_CONFIRMATION, child.wait()).await {
        Err(_) => Ok(()),
        Ok(Ok(status)) if status.success() => Ok(()),
        Ok(_) => Err(CodeAgentError::internal("system open failed")),
    }
}

#[cfg(test)]
#[path = "project_open_tests.rs"]
mod tests;
