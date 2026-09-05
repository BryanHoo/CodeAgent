use std::{collections::BTreeSet, fs, io::Read, path::Path};

use sha2::{Digest, Sha256};

use super::{git_process::run_git, git_read::GitChange, path_guard::WorkspaceError};

pub(super) async fn content_fingerprint(
    repo: &Path,
    unstaged: &[GitChange],
) -> Result<String, WorkspaceError> {
    // 暂存内容使用 Git 对象 ID；工作区只流式读取变更文件，不加载完整 diff 或整仓库内容。
    let (index, truncated) = run_git(
        repo,
        &[
            "diff",
            "--cached",
            "--raw",
            "--no-abbrev",
            "--no-renames",
            "-z",
        ],
        2 * 1024 * 1024,
    )
    .await?;
    if truncated {
        return Err(WorkspaceError::InvalidPath);
    }
    let paths: BTreeSet<String> = unstaged
        .iter()
        .flat_map(|change| std::iter::once(change.path.clone()).chain(change.original_path.clone()))
        .collect();
    let repo = repo.to_owned();
    tokio::task::spawn_blocking(move || {
        let mut hasher = Sha256::new();
        hasher.update(index);
        let mut buffer = [0_u8; 64 * 1024];
        for relative in paths {
            hasher.update([0]);
            hasher.update(relative.as_bytes());
            hasher.update([0]);
            let path = repo.join(relative);
            let metadata = match fs::symlink_metadata(&path) {
                Ok(metadata) => metadata,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    hasher.update(b"missing");
                    continue;
                }
                Err(error) => return Err(WorkspaceError::Io(error)),
            };
            if metadata.is_symlink() {
                // Git 保存链接目标文本，不能跟随链接读取项目外文件。
                hasher.update(b"symlink");
                hasher.update(fs::read_link(path)?.as_os_str().as_encoded_bytes());
            } else if metadata.is_file() {
                if !fs::canonicalize(&path)?.starts_with(&repo) {
                    return Err(WorkspaceError::InvalidPath);
                }
                hasher.update(b"file");
                let mut file = fs::File::open(path)?;
                loop {
                    let count = file.read(&mut buffer)?;
                    if count == 0 {
                        break;
                    }
                    hasher.update(&buffer[..count]);
                }
            } else if metadata.is_dir() {
                hasher.update(b"directory");
            } else {
                return Err(WorkspaceError::InvalidPath);
            }
        }
        Ok(crate::encoding::encode_lower_hex(hasher.finalize()))
    })
    .await
    .map_err(|_| WorkspaceError::InvalidPath)?
}
