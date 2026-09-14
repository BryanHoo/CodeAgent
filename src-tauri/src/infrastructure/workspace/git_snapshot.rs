use std::{
    collections::{BTreeSet, HashMap, VecDeque},
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::{LazyLock, Mutex},
    time::SystemTime,
};

use sha2::{Digest, Sha256};
use tokio::sync::Semaphore;
use tokio_util::sync::CancellationToken;

use super::{git_process::run_git, git_read::GitChange, path_guard::WorkspaceError};

const MAX_CACHE_FILES: usize = 16_384;
static CACHE: LazyLock<Mutex<FingerprintCache>> = LazyLock::new(Mutex::default);
static HASH_SLOTS: Semaphore = Semaphore::const_new(2);

#[derive(Default)]
struct FingerprintCache {
    files: HashMap<PathBuf, (FileStamp, [u8; 32])>,
    insertion_order: VecDeque<PathBuf>,
}

impl FingerprintCache {
    fn insert(&mut self, path: PathBuf, stamp: FileStamp, digest: [u8; 32]) {
        if !self.files.contains_key(&path) {
            // FIFO 有界淘汰，不保存文件内容，避免长期切换项目导致缓存无限增长。
            if self.files.len() == MAX_CACHE_FILES
                && let Some(oldest) = self.insertion_order.pop_front()
            {
                self.files.remove(&oldest);
            }
            self.insertion_order.push_back(path.clone());
        }
        self.files.insert(path, (stamp, digest));
    }
}

#[derive(PartialEq, Eq)]
struct FileStamp {
    len: u64,
    modified: SystemTime,
    created: Option<SystemTime>,
    permissions: fs::Permissions,
    #[cfg(unix)]
    identity: (u64, u64, i64, i64),
}

impl FileStamp {
    fn read(metadata: &fs::Metadata) -> Result<Self, WorkspaceError> {
        Ok(Self {
            len: metadata.len(),
            modified: metadata.modified()?,
            created: metadata.created().ok(),
            permissions: metadata.permissions(),
            #[cfg(unix)]
            identity: {
                use std::os::unix::fs::MetadataExt;
                // ctime 和 inode 捕获同尺寸覆盖、恢复 mtime 与原子替换。
                (
                    metadata.dev(),
                    metadata.ino(),
                    metadata.ctime(),
                    metadata.ctime_nsec(),
                )
            },
        })
    }
}

pub(super) async fn content_fingerprint(
    repo: &Path,
    unstaged: &[GitChange],
    strict: bool,
) -> Result<String, WorkspaceError> {
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
        return Err(WorkspaceError::GitCommandFailed(
            "git index metadata output exceeded 2097152 bytes".to_owned(),
        ));
    }
    let paths: BTreeSet<String> = unstaged
        .iter()
        .flat_map(|change| std::iter::once(change.path.clone()).chain(change.original_path.clone()))
        .collect();
    let repo = repo.to_owned();
    let cancellation = CancellationToken::new();
    // 外层 future 被丢弃时通知阻塞线程；abort 本身无法终止已启动的 spawn_blocking。
    let _cancel_on_drop = cancellation.clone().drop_guard();
    // 在异步侧等待配额，避免刷新风暴占满阻塞线程池。
    let permit = HASH_SLOTS
        .acquire()
        .await
        .map_err(|_| WorkspaceError::InvalidPath)?;
    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        let mut hasher = Sha256::new();
        hasher.update(index);
        let mut buffer = [0_u8; 64 * 1024];
        for relative in paths {
            check_cancelled(&cancellation)?;
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
                Err(error) => return Err(error.into()),
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
                hasher.update(file_fingerprint(
                    &path,
                    &metadata,
                    strict,
                    &cancellation,
                    &mut buffer,
                )?);
            } else if metadata.is_dir() {
                hasher.update(b"directory");
            } else {
                return Err(WorkspaceError::InvalidPath);
            }
        }
        check_cancelled(&cancellation)?;
        Ok(crate::encoding::encode_lower_hex(hasher.finalize()))
    })
    .await
    .map_err(|_| WorkspaceError::InvalidPath)?
}

fn file_fingerprint(
    path: &Path,
    metadata: &fs::Metadata,
    strict: bool,
    cancellation: &CancellationToken,
    buffer: &mut [u8],
) -> Result<[u8; 32], WorkspaceError> {
    let stamp = FileStamp::read(metadata)?;
    // 元数据仅用于刷新缓存失效；写入前必须重新读取全部内容，不能信任缓存。
    if !strict
        && let Some((cached_stamp, digest)) = CACHE
            .lock()
            .map_err(|_| WorkspaceError::InvalidPath)?
            .files
            .get(path)
        && *cached_stamp == stamp
    {
        return Ok(*digest);
    }
    let mut file = fs::File::open(path)?;
    let digest = hash_reader(&mut file, cancellation, buffer, path)?;
    // 读取期间发生覆盖或替换时拒绝快照，避免把混合内容存入缓存。
    if stamp != FileStamp::read(&file.metadata()?)?
        || stamp != FileStamp::read(&fs::symlink_metadata(path)?)?
    {
        return Err(WorkspaceError::SnapshotMismatch);
    }
    check_cancelled(cancellation)?;
    CACHE
        .lock()
        .map_err(|_| WorkspaceError::InvalidPath)?
        .insert(path.to_owned(), stamp, digest);
    Ok(digest)
}

fn hash_reader(
    reader: &mut impl Read,
    cancellation: &CancellationToken,
    buffer: &mut [u8],
    _path: &Path,
) -> Result<[u8; 32], WorkspaceError> {
    let mut hasher = Sha256::new();
    loop {
        check_cancelled(cancellation)?;
        let count = reader.read(buffer)?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
        #[cfg(test)]
        tests::record_read(_path, count);
    }
    Ok(hasher.finalize().into())
}

fn check_cancelled(cancellation: &CancellationToken) -> Result<(), WorkspaceError> {
    if cancellation.is_cancelled() {
        return Err(
            std::io::Error::new(std::io::ErrorKind::Interrupted, "Git snapshot cancelled").into(),
        );
    }
    Ok(())
}

#[cfg(test)]
#[path = "git_snapshot_tests.rs"]
mod tests;
