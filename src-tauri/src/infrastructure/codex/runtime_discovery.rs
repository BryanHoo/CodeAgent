use std::{
    collections::HashSet,
    env,
    ffi::OsStr,
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};

use futures_util::{StreamExt, stream};
use tokio::{io::AsyncReadExt, time::timeout};

use super::process::{SUPPORTED_CODEX_VERSION, background_process_command, executable_path};

const CODEX_BINARY_ENV: &str = "CODEAGENT_CODEX_BIN";
const MANAGER_QUERY_TIMEOUT: Duration = Duration::from_secs(2);
const MANAGER_OUTPUT_LIMIT: usize = 4 * 1024;
const MAX_VERSION_DIRECTORIES: usize = 128;

pub(super) struct CandidatePaths {
    pub(super) paths: Vec<PathBuf>,
    pub(super) had_invalid_explicit_path: bool,
}

#[derive(Clone, Copy)]
enum QueryResult {
    Directory,
    PrefixBin,
    NpmPrefix,
}

#[derive(Clone, Copy)]
struct ManagerQuery {
    program: &'static str,
    args: &'static [&'static str],
    result: QueryResult,
}

pub(super) fn initial_candidate_paths(
    app_data: &Path,
    runtime_path: Option<&OsStr>,
) -> CandidatePaths {
    let mut raw_paths = Vec::new();
    let mut had_invalid_explicit_path = false;

    if let Some(explicit) = env::var_os(CODEX_BINARY_ENV) {
        let path = PathBuf::from(explicit);
        if path.is_absolute() {
            raw_paths.push(path);
        } else {
            had_invalid_explicit_path = true;
        }
    }
    raw_paths.push(private_codex_binary_path(app_data));
    for path in [env::var_os("PATH").as_deref(), runtime_path]
        .into_iter()
        .flatten()
    {
        raw_paths.extend(candidates_in_path(path, env::consts::OS));
    }
    raw_paths.extend(candidates_in_directories(
        known_binary_directories(env::consts::OS),
        env::consts::OS,
    ));

    CandidatePaths {
        paths: existing_unique_paths(raw_paths),
        had_invalid_explicit_path,
    }
}

pub(super) async fn expanded_candidate_paths(runtime_path: Option<&OsStr>) -> Vec<PathBuf> {
    let manager_directories = stream::iter(manager_queries(env::consts::OS))
        .map(|query| query_manager_directory(query, runtime_path))
        .buffer_unordered(5)
        .filter_map(|directory| async move { directory })
        .collect::<Vec<_>>();
    let version_directories = discover_version_manager_directories(env::consts::OS);
    let (mut manager_directories, version_directories) =
        tokio::join!(manager_directories, version_directories);
    manager_directories.extend(version_directories);
    existing_unique_paths(candidates_in_directories(
        manager_directories,
        env::consts::OS,
    ))
}

pub(super) fn codex_executable_names(os: &str) -> &'static [&'static str] {
    if os == "windows" {
        // npm 在 Windows 全局安装时生成 codex.cmd shim，独立版则使用 codex.exe。
        &["codex.exe", "codex.cmd"]
    } else {
        &["codex"]
    }
}

pub(super) fn private_codex_binary_path(app_data: &Path) -> PathBuf {
    app_data
        .join("providers/codex/bin")
        .join(SUPPORTED_CODEX_VERSION)
        .join("bin")
        .join(format!("codex{}", env::consts::EXE_SUFFIX))
}

pub(super) fn official_binary_directories(
    os: &str,
    home: Option<&Path>,
    codex_home: Option<&Path>,
    install_dir: Option<&Path>,
    local_app_data: Option<&Path>,
) -> Vec<PathBuf> {
    let mut directories = Vec::new();
    if let Some(install_dir) = install_dir.filter(|path| path.is_absolute()) {
        directories.push(install_dir.to_owned());
    }
    let managed_home = codex_home
        .filter(|path| path.is_absolute())
        .map(Path::to_owned)
        .or_else(|| home.map(|path| path.join(".codex")));
    if let Some(managed_home) = managed_home {
        let current = managed_home.join("packages/standalone/current");
        directories.push(current.join("bin"));
        // 兼容 standalone 安装器曾使用的 current/codex 旧布局。
        directories.push(current);
    }
    match os {
        "windows" => {
            if let Some(local_app_data) = local_app_data {
                directories.push(local_app_data.join("Programs/OpenAI/Codex/bin"));
            }
        }
        _ => {
            if let Some(home) = home {
                directories.push(home.join(".local/bin"));
            }
        }
    }
    directories
}

fn known_binary_directories(os: &str) -> Vec<PathBuf> {
    let home = home_directory(os);
    let local_app_data = env::var_os("LOCALAPPDATA").map(PathBuf::from);
    let mut directories = official_binary_directories(
        os,
        home.as_deref(),
        env_path("CODEX_HOME").as_deref(),
        env_path("CODEX_INSTALL_DIR").as_deref(),
        local_app_data.as_deref(),
    );

    for variable in ["NVM_BIN", "PNPM_HOME"] {
        if let Some(path) = env_path(variable) {
            directories.push(path);
        }
    }
    for variable in ["VOLTA_HOME", "BUN_INSTALL"] {
        if let Some(path) = env_path(variable) {
            directories.push(path.join("bin"));
        }
    }
    if let Some(prefix) = env_path("NPM_CONFIG_PREFIX") {
        directories.push(if os == "windows" {
            prefix
        } else {
            prefix.join("bin")
        });
    }

    if os == "windows" {
        add_windows_directories(&mut directories, home.as_deref(), local_app_data.as_deref());
    } else {
        add_unix_directories(&mut directories, home.as_deref());
    }
    directories
}

fn add_unix_directories(directories: &mut Vec<PathBuf>, home: Option<&Path>) {
    directories.extend([
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/home/linuxbrew/.linuxbrew/bin"),
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/usr/bin"),
        PathBuf::from("/opt/local/bin"),
        PathBuf::from("/snap/bin"),
        PathBuf::from("/run/current-system/sw/bin"),
        PathBuf::from("/nix/var/nix/profiles/default/bin"),
    ]);
    if let Some(home) = home {
        for suffix in [
            ".npm-global/bin",
            ".bun/bin",
            ".volta/bin",
            ".asdf/shims",
            ".local/share/mise/shims",
            ".local/share/pnpm",
            ".nix-profile/bin",
        ] {
            directories.push(home.join(suffix));
        }
    }
}

fn add_windows_directories(
    directories: &mut Vec<PathBuf>,
    home: Option<&Path>,
    local_app_data: Option<&Path>,
) {
    if let Some(app_data) = env_path("APPDATA") {
        directories.push(app_data.join("npm"));
    }
    if let Some(local_app_data) = local_app_data {
        for suffix in [
            "pnpm",
            "Volta/bin",
            "Microsoft/WinGet/Links",
            "Microsoft/WindowsApps",
        ] {
            directories.push(local_app_data.join(suffix));
        }
    }
    if let Some(home) = home {
        directories.push(home.join(".bun/bin"));
        directories.push(home.join("scoop/shims"));
    }
    if let Some(chocolatey) = env_path("ChocolateyInstall") {
        directories.push(chocolatey.join("bin"));
    }
}

fn candidates_in_path(path: &OsStr, os: &str) -> Vec<PathBuf> {
    candidates_in_directories(env::split_paths(path), os)
}

fn candidates_in_directories(
    directories: impl IntoIterator<Item = PathBuf>,
    os: &str,
) -> Vec<PathBuf> {
    directories
        .into_iter()
        .filter(|directory| directory.is_absolute())
        .flat_map(|directory| {
            codex_executable_names(os)
                .iter()
                .map(move |executable| directory.join(executable))
        })
        .collect()
}

fn existing_unique_paths(paths: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    paths
        .into_iter()
        .filter_map(|path| executable_path(&path))
        .filter(|path| seen.insert(path.clone()))
        .collect()
}

fn env_path(variable: &str) -> Option<PathBuf> {
    env::var_os(variable)
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
}

fn home_directory(os: &str) -> Option<PathBuf> {
    env_path(if os == "windows" {
        "USERPROFILE"
    } else {
        "HOME"
    })
}

fn manager_queries(os: &str) -> Vec<ManagerQuery> {
    let executable = |name, windows_name| if os == "windows" { windows_name } else { name };
    let mut queries = vec![
        ManagerQuery {
            program: executable("npm", "npm.cmd"),
            args: &["prefix", "-g"],
            result: QueryResult::NpmPrefix,
        },
        ManagerQuery {
            program: executable("pnpm", "pnpm.cmd"),
            args: &["bin", "--global"],
            result: QueryResult::Directory,
        },
        ManagerQuery {
            program: executable("bun", "bun.exe"),
            args: &["pm", "bin", "-g"],
            result: QueryResult::Directory,
        },
        ManagerQuery {
            program: executable("yarn", "yarn.cmd"),
            args: &["global", "bin"],
            result: QueryResult::Directory,
        },
    ];
    if os != "windows" {
        queries.push(ManagerQuery {
            program: "brew",
            args: &["--prefix"],
            result: QueryResult::PrefixBin,
        });
    }
    queries
}

async fn query_manager_directory(
    query: ManagerQuery,
    runtime_path: Option<&OsStr>,
) -> Option<PathBuf> {
    let mut command = background_process_command(OsStr::new(query.program));
    command
        .args(query.args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    if let Some(runtime_path) = runtime_path {
        command.env("PATH", runtime_path);
    }
    let mut child = command.spawn().ok()?;
    let stdout = child.stdout.take()?;
    let result = timeout(MANAGER_QUERY_TIMEOUT, async {
        let mut output = Vec::new();
        let mut stdout = stdout.take(MANAGER_OUTPUT_LIMIT as u64 + 1);
        let (status, read) = tokio::join!(child.wait(), stdout.read_to_end(&mut output));
        Some((status.ok()?, read.ok()?, output))
    })
    .await;
    let (status, _, output) = match result {
        Ok(Some(result)) => result,
        Ok(None) => return None,
        Err(_) => {
            let _ = child.kill().await;
            return None;
        }
    };
    if !status.success() || output.len() > MANAGER_OUTPUT_LIMIT {
        return None;
    }
    let output = std::str::from_utf8(&output).ok()?;
    let path = output
        .lines()
        .rev()
        .map(str::trim)
        .find(|line| Path::new(line).is_absolute())?;
    let path = PathBuf::from(path);
    Some(match query.result {
        QueryResult::Directory => path,
        QueryResult::PrefixBin => path.join("bin"),
        QueryResult::NpmPrefix if env::consts::OS == "windows" => path,
        QueryResult::NpmPrefix => path.join("bin"),
    })
}

async fn discover_version_manager_directories(os: &str) -> Vec<PathBuf> {
    let Some(home) = home_directory(os) else {
        return Vec::new();
    };
    let mut specifications = if os == "windows" {
        vec![(home.join("AppData/Roaming/nvm"), PathBuf::new())]
    } else {
        vec![
            (home.join(".nvm/versions/node"), PathBuf::from("bin")),
            (home.join(".asdf/installs/nodejs"), PathBuf::from("bin")),
        ]
    };
    let fnm_root = env_path("FNM_DIR").unwrap_or_else(|| {
        if os == "windows" {
            home.join("AppData/Roaming/fnm")
        } else {
            home.join(".local/share/fnm")
        }
    });
    specifications.push((
        fnm_root.join("node-versions"),
        if os == "windows" {
            PathBuf::from("installation")
        } else {
            PathBuf::from("installation/bin")
        },
    ));
    if let Some(nvm_home) = env_path("NVM_HOME") {
        specifications.push((nvm_home, PathBuf::new()));
    }

    stream::iter(specifications)
        .map(|(root, suffix)| child_directories(root, suffix))
        .buffer_unordered(4)
        .collect::<Vec<_>>()
        .await
        .into_iter()
        .flatten()
        .collect()
}

async fn child_directories(root: PathBuf, suffix: PathBuf) -> Vec<PathBuf> {
    let Ok(mut entries) = tokio::fs::read_dir(root).await else {
        return Vec::new();
    };
    let mut directories = Vec::new();
    while directories.len() < MAX_VERSION_DIRECTORIES {
        let Ok(Some(entry)) = entries.next_entry().await else {
            break;
        };
        let path = entry.path();
        if entry.file_type().await.is_ok_and(|kind| kind.is_dir()) {
            directories.push(path.join(&suffix));
        }
    }
    directories
}
