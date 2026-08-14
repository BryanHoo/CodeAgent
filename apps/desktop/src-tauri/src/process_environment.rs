use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};

#[cfg(unix)]
use std::os::unix::ffi::OsStringExt;
#[cfg(unix)]
use std::process::Stdio;
#[cfg(unix)]
use std::time::Duration;
#[cfg(unix)]
use tokio::io::AsyncReadExt;

#[cfg(unix)]
const SHELL_PATH_TIMEOUT: Duration = Duration::from_secs(3);
#[cfg(unix)]
const MAX_SHELL_OUTPUT_BYTES: u64 = 64 * 1024;
#[cfg(unix)]
const PATH_MARKER: &[u8] = b"CODE_AGENT_PATH=";

pub async fn resolved_process_path() -> OsString {
    let inherited_path = std::env::var_os("PATH").unwrap_or_default();
    let inherited = std::env::split_paths(&inherited_path).collect::<Vec<_>>();
    let mut discovered = environment_tool_directories();

    #[cfg(unix)]
    if let Some(shell_path) = login_shell_path().await {
        discovered.extend(std::env::split_paths(OsStr::new(&shell_path)));
    }
    discovered.extend(common_tool_directories());

    // 登录 shell 与常见用户工具目录优先，GUI 继承环境只作为最后兜底。
    let paths = merge_search_paths(&[], &discovered, &inherited);
    std::env::join_paths(&paths).unwrap_or_default()
}

pub fn prepend_process_path(managed_directories: &[PathBuf], process_path: &OsStr) -> OsString {
    let inherited = std::env::split_paths(process_path).collect::<Vec<_>>();
    let paths = merge_search_paths(managed_directories, &[], &inherited);
    std::env::join_paths(&paths)
        .or_else(|_| std::env::join_paths(managed_directories))
        .unwrap_or_else(|_| process_path.to_owned())
}

fn merge_search_paths(
    managed: &[PathBuf],
    discovered: &[PathBuf],
    inherited: &[PathBuf],
) -> Vec<PathBuf> {
    let mut merged: Vec<PathBuf> =
        Vec::with_capacity(managed.len() + discovered.len() + inherited.len());
    for path in managed.iter().chain(discovered).chain(inherited) {
        if path.as_os_str().is_empty() || merged.iter().any(|existing| same_path(existing, path)) {
            continue;
        }
        merged.push(path.clone());
    }
    merged
}

fn same_path(left: &Path, right: &Path) -> bool {
    same_path_for_platform(left, right)
}

#[cfg(windows)]
fn same_path_for_platform(left: &Path, right: &Path) -> bool {
    left.as_os_str()
        .to_string_lossy()
        .eq_ignore_ascii_case(&right.as_os_str().to_string_lossy())
}

#[cfg(not(windows))]
fn same_path_for_platform(left: &Path, right: &Path) -> bool {
    left == right
}

fn environment_tool_directories() -> Vec<PathBuf> {
    let mut directories = Vec::with_capacity(12);
    push_environment_directory(&mut directories, "PNPM_HOME", None);
    push_environment_directory(&mut directories, "FNM_MULTISHELL_PATH", None);
    push_environment_directory(&mut directories, "NVM_SYMLINK", None);
    push_environment_directory(&mut directories, "UV_TOOL_BIN_DIR", None);
    push_environment_directory(&mut directories, "PIPX_BIN_DIR", None);
    push_environment_directory(&mut directories, "VOLTA_HOME", Some("bin"));
    push_environment_directory(&mut directories, "BUN_INSTALL", Some("bin"));
    push_environment_directory(&mut directories, "CARGO_HOME", Some("bin"));
    push_environment_directory(&mut directories, "MISE_DATA_DIR", Some("shims"));
    push_environment_directory(&mut directories, "ASDF_DATA_DIR", Some("shims"));
    push_environment_directory(&mut directories, "FNM_DIR", Some("aliases/default/bin"));
    push_environment_directory(&mut directories, "FNM_DIR", Some("aliases/default"));
    directories
}

fn push_environment_directory(
    directories: &mut Vec<PathBuf>,
    variable: &str,
    suffix: Option<&str>,
) {
    let Some(value) = std::env::var_os(variable) else {
        return;
    };
    let directory = suffix.map_or_else(
        || PathBuf::from(&value),
        |suffix| PathBuf::from(&value).join(suffix),
    );
    if directory.is_dir() {
        directories.push(directory);
    }
}

fn common_tool_directories() -> Vec<PathBuf> {
    let mut candidates = Vec::with_capacity(16);
    if let Some(home) = user_home_directory() {
        candidates.extend([
            home.join(".local/bin"),
            home.join(".local/share/fnm/aliases/default/bin"),
            home.join(".local/share/mise/shims"),
            home.join(".volta/bin"),
            home.join(".bun/bin"),
            home.join(".asdf/shims"),
        ]);
        #[cfg(windows)]
        candidates.push(home.join("scoop/shims"));
    }
    #[cfg(windows)]
    {
        if let Some(app_data) = std::env::var_os("APPDATA") {
            let app_data = PathBuf::from(app_data);
            candidates.push(app_data.join("npm"));
            candidates.push(app_data.join("fnm/aliases/default"));
        }
        if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
            let local_app_data = PathBuf::from(local_app_data);
            candidates.push(local_app_data.join("pnpm"));
            candidates.push(local_app_data.join("Microsoft/WinGet/Links"));
        }
        if let Some(program_files) = std::env::var_os("ProgramFiles") {
            candidates.push(PathBuf::from(program_files).join("nodejs"));
        }
    }
    #[cfg(unix)]
    {
        candidates.extend([
            PathBuf::from("/opt/homebrew/bin"),
            PathBuf::from("/usr/local/bin"),
            PathBuf::from("/snap/bin"),
        ]);
    }
    candidates
        .into_iter()
        .filter(|directory| directory.is_dir())
        .collect()
}

fn user_home_directory() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

#[cfg(unix)]
async fn login_shell_path() -> Option<OsString> {
    let shell = std::env::var_os("SHELL").unwrap_or_else(|| OsString::from("/bin/sh"));
    if !Path::new(&shell).is_file() {
        return None;
    }
    let mut child = tokio::process::Command::new(shell)
        .args(["-ilc", "printf '\\nCODE_AGENT_PATH=%s\\n' \"$PATH\""])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .ok()?;
    let stdout = child.stdout.take()?;
    let probe = async {
        let mut output = Vec::with_capacity(4 * 1024);
        let mut bounded_stdout = stdout.take(MAX_SHELL_OUTPUT_BYTES);
        bounded_stdout.read_to_end(&mut output).await.ok()?;
        child.wait().await.ok()?.success().then_some(output)
    };
    let output = match tokio::time::timeout(SHELL_PATH_TIMEOUT, probe).await {
        Ok(output) => output?,
        Err(_) => {
            let _ = child.kill().await;
            return None;
        }
    };
    parse_environment_path(&output)
}

#[cfg(unix)]
fn parse_environment_path(output: &[u8]) -> Option<OsString> {
    output
        .split(|byte| *byte == b'\n')
        .rev()
        .find_map(|line| line.strip_prefix(PATH_MARKER))
        .filter(|path| !path.is_empty())
        .map(|path| OsString::from_vec(path.to_vec()))
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::merge_search_paths;
    #[cfg(unix)]
    use super::parse_environment_path;

    #[test]
    fn managed_directories_precede_discovered_and_inherited_paths() {
        let managed = [PathBuf::from("/managed/codex-path")];
        let discovered = [PathBuf::from("/user/tools"), PathBuf::from("/usr/bin")];
        let inherited = [PathBuf::from("/usr/bin"), PathBuf::from("/bin")];

        let merged = merge_search_paths(&managed, &discovered, &inherited);

        assert_eq!(
            merged,
            vec![
                PathBuf::from("/managed/codex-path"),
                PathBuf::from("/user/tools"),
                PathBuf::from("/usr/bin"),
                PathBuf::from("/bin"),
            ]
        );
    }

    #[cfg(unix)]
    #[test]
    fn environment_output_uses_the_last_path_entry() {
        let output = b"shell startup output\nCODE_AGENT_PATH=/old/bin\nHOME=/home/user\nCODE_AGENT_PATH=/user/bin:/usr/bin\n";

        assert_eq!(
            parse_environment_path(output),
            Some(std::ffi::OsString::from("/user/bin:/usr/bin"))
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn resolved_path_starts_npx_for_gui_launches() {
        let path = super::resolved_process_path().await;
        let directories = std::env::split_paths(&path).collect::<Vec<_>>();
        let npx = directories
            .iter()
            .map(|directory| directory.join("npx"))
            .find(|command| command.is_file())
            .expect("resolved PATH contains npx");
        let output = tokio::process::Command::new(npx)
            .arg("--version")
            .env("PATH", path)
            .output()
            .await
            .expect("start npx");

        assert!(output.status.success());
    }
}
