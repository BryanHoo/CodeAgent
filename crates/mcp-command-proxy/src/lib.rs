use std::path::{Path, PathBuf};

/// 在代理自身目录之后查找 Node.js 与 npm 自带的 `npx-cli.js`。
pub fn locate_npx_runtime(
    proxy_directory: &Path,
    search_paths: &[PathBuf],
) -> Option<(PathBuf, PathBuf)> {
    for directory in search_paths {
        if same_directory(directory, proxy_directory) {
            continue;
        }
        let node = directory.join("node.exe");
        let npx_cli = directory.join("node_modules/npm/bin/npx-cli.js");
        if node.is_file() && npx_cli.is_file() {
            return Some((node, npx_cli));
        }
    }
    None
}

fn same_directory(left: &Path, right: &Path) -> bool {
    left.as_os_str()
        .to_string_lossy()
        .eq_ignore_ascii_case(&right.as_os_str().to_string_lossy())
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;

    use super::locate_npx_runtime;

    #[test]
    fn npx_runtime_skips_proxy_directory_and_finds_node_installation() {
        let root =
            std::env::temp_dir().join(format!("code-agent-mcp-proxy-{}", std::process::id()));
        let proxy_directory = root.join("proxy");
        let node_directory = root.join("node");
        let npx_cli = node_directory.join("node_modules/npm/bin/npx-cli.js");
        fs::create_dir_all(&proxy_directory).expect("create proxy fixture");
        fs::create_dir_all(npx_cli.parent().expect("npx parent")).expect("create npm fixture");
        fs::write(proxy_directory.join("node.exe"), []).expect("write ignored node");
        fs::write(node_directory.join("node.exe"), []).expect("write node");
        fs::write(&npx_cli, []).expect("write npx cli");

        let runtime = locate_npx_runtime(
            &proxy_directory,
            &[proxy_directory.clone(), node_directory.clone()],
        )
        .expect("locate npx runtime");

        assert_eq!(runtime, (node_directory.join("node.exe"), npx_cli));
        fs::remove_dir_all(root).expect("remove proxy fixture");
    }

    #[test]
    fn npx_runtime_returns_none_without_a_complete_node_installation() {
        let directory = PathBuf::from("missing-node-installation");

        assert_eq!(
            locate_npx_runtime(&directory, std::slice::from_ref(&directory)),
            None
        );
    }
}
