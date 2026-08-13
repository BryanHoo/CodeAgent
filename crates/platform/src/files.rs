use std::path::{Path, PathBuf};

use async_trait::async_trait;
use code_agent_core::{
    AgentMutationErrorCode, CodeAgentError, CodeAgentErrorCode, FilePort, PortRequestContext,
};
use code_agent_protocol::ProjectId;
use rusqlite::OptionalExtension;
use serde_json::{Value, json};
use tokio::io::{AsyncReadExt, AsyncSeekExt};

use crate::project_tree::{read_directory_entries, read_search_entries};
use crate::{CanonicalPathPolicy, PlatformDatabase, PlatformError};

const MAX_SOURCE_BYTES: usize = 256 * 1024;
const MAX_SOURCE_LINES: usize = 4_000;
const MAX_IMAGE_BYTES: u64 = 20 * 1024 * 1024;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SourceFilePage {
    pub content: String,
    pub next_cursor: Option<u64>,
    pub path: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ImageFile {
    pub bytes: Vec<u8>,
    pub media_type: &'static str,
    pub path: String,
}

#[derive(Clone, Debug)]
pub struct PlatformFileService {
    policy: CanonicalPathPolicy,
}

#[derive(Clone)]
pub struct PlatformFilePort {
    database: PlatformDatabase,
}

impl PlatformFilePort {
    #[must_use]
    pub fn new(database: PlatformDatabase) -> Self {
        Self { database }
    }

    async fn service(&self, project_id: &ProjectId) -> Result<PlatformFileService, CodeAgentError> {
        let project_id = project_id.to_string();
        let root = self
            .database
            .call(move |connection| {
                connection
                    .query_row(
                        "SELECT root_path FROM projects WHERE id = ?1",
                        [project_id],
                        |row| row.get::<_, String>(0),
                    )
                    .optional()?
                    .ok_or_else(|| PlatformError::Worker("project not found".to_owned()))
            })
            .map_err(map_error)?;
        PlatformFileService::new(root).await.map_err(map_error)
    }
}

impl PlatformFileService {
    pub async fn new(root: impl AsRef<Path>) -> Result<Self, PlatformError> {
        Ok(Self {
            policy: CanonicalPathPolicy::new(root).await?,
        })
    }

    pub async fn read_source(
        &self,
        path: &str,
        cursor: u64,
    ) -> Result<SourceFilePage, PlatformError> {
        let (resolved, display) = self.resolve_reference(path).await?;
        let start = usize::try_from(cursor)
            .map_err(|_| PlatformError::Worker("cursor is outside the file".to_owned()))?;
        let mut file = tokio::fs::File::open(&resolved).await?;
        let file_len = usize::try_from(file.metadata().await?.len())
            .map_err(|_| PlatformError::Worker("source file is too large".to_owned()))?;
        if start > file_len {
            return Err(PlatformError::Worker("source file is invalid".to_owned()));
        }
        file.seek(std::io::SeekFrom::Start(cursor)).await?;
        let mut bytes = vec![0_u8; MAX_SOURCE_BYTES + 4];
        let read = file.read(&mut bytes).await?;
        bytes.truncate(read);
        if bytes.contains(&0) {
            return Err(PlatformError::Worker("source file is invalid".to_owned()));
        }
        let mut length = read.min(MAX_SOURCE_BYTES);
        if let Some(line_end) = bytes[..length]
            .iter()
            .enumerate()
            .filter(|(_, byte)| **byte == b'\n')
            .nth(MAX_SOURCE_LINES - 1)
            .map(|(index, _)| index + 1)
        {
            length = line_end;
        }
        while length > 0 && std::str::from_utf8(&bytes[..length]).is_err() {
            length -= 1;
            if read.min(MAX_SOURCE_BYTES) - length > 3 {
                return Err(PlatformError::Worker(
                    "source file is not valid UTF-8".to_owned(),
                ));
            }
        }
        let content = std::str::from_utf8(&bytes[..length])
            .map_err(|_| PlatformError::Worker("source file is not valid UTF-8".to_owned()))?
            .to_owned();
        let next = start + length;
        Ok(SourceFilePage {
            content,
            next_cursor: (next < file_len).then_some(next as u64),
            path: display,
        })
    }

    pub async fn read_image(&self, path: &str) -> Result<ImageFile, PlatformError> {
        let (resolved, display) = self.resolve_reference(path).await?;
        let metadata = tokio::fs::metadata(&resolved).await?;
        if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_IMAGE_BYTES {
            return Err(PlatformError::Worker("unsupported image file".to_owned()));
        }
        let bytes = tokio::fs::read(resolved).await?;
        let media_type = detect_image(&bytes)
            .ok_or_else(|| PlatformError::Worker("unsupported image file".to_owned()))?;
        Ok(ImageFile {
            bytes,
            media_type,
            path: display,
        })
    }

    async fn resolve_reference(&self, path: &str) -> Result<(PathBuf, String), PlatformError> {
        let requested = Path::new(path);
        if requested.is_absolute() {
            let resolved = tokio::fs::canonicalize(requested).await?;
            if !tokio::fs::metadata(&resolved).await?.is_file() {
                return Err(PlatformError::Worker(
                    "path must be a regular file".to_owned(),
                ));
            }
            return Ok((resolved.clone(), resolved.to_string_lossy().into_owned()));
        }
        let resolved = self.policy.resolve_relative(path).await?;
        Ok((resolved, path.replace('\\', "/")))
    }
}

#[async_trait]
impl FilePort for PlatformFilePort {
    async fn read(
        &self,
        project_id: &ProjectId,
        path: &str,
        context: &PortRequestContext,
    ) -> Result<Vec<u8>, CodeAgentError> {
        ensure_active(context)?;
        self.service(project_id)
            .await?
            .read_image(path)
            .await
            .map(|image| image.bytes)
            .map_err(map_error)
    }

    async fn source_read(
        &self,
        project_id: &ProjectId,
        path: &str,
        cursor: u64,
        context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        ensure_active(context)?;
        let page = self
            .service(project_id)
            .await?
            .read_source(path, cursor)
            .await
            .map_err(map_error)?;
        Ok(json!({ "content": page.content, "nextCursor": page.next_cursor, "path": page.path }))
    }

    async fn tree(
        &self,
        project_id: &ProjectId,
        path: Option<&str>,
        context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        ensure_active(context)?;
        let service = self.service(project_id).await?;
        let directory = match path {
            Some(path) => service
                .policy
                .resolve_relative(path)
                .await
                .map_err(map_error)?,
            None => service.policy.root().to_owned(),
        };
        // 文件树按目录懒加载；禁止把整个 Project 一次性序列化给 WebView。
        let mut entries = read_directory_entries(service.policy.root(), &directory)
            .await
            .map_err(map_error)?;
        entries.sort_by(|left, right| left["path"].as_str().cmp(&right["path"].as_str()));
        Ok(json!({ "entries": entries, "path": path }))
    }

    async fn search(
        &self,
        project_id: &ProjectId,
        query: &str,
        context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        ensure_active(context)?;
        let service = self.service(project_id).await?;
        let mut entries = read_search_entries(service.policy.root())
            .await
            .map_err(map_error)?;
        let query = query.to_lowercase();
        entries.retain(|entry| {
            entry["type"] == "file"
                && entry["path"]
                    .as_str()
                    .is_some_and(|path| path.to_lowercase().contains(&query))
        });
        entries.truncate(50);
        let data = entries
            .into_iter()
            .map(|entry| {
                let path = entry["path"].clone();
                let name = path
                    .as_str()
                    .and_then(|path| Path::new(path).file_name())
                    .and_then(|name| name.to_str())
                    .unwrap_or_default();
                json!({ "name": name, "path": path })
            })
            .collect::<Vec<_>>();
        Ok(json!({ "data": data }))
    }

    async fn browse_directories(
        &self,
        path: Option<&str>,
        context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        ensure_active(context)?;
        browse_directory(path, None).await.map_err(map_error)
    }

    async fn browse_host_files(
        &self,
        kind: &str,
        path: Option<&str>,
        context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        ensure_active(context)?;
        if !matches!(kind, "file" | "image") {
            return Err(CodeAgentError::new(
                code_agent_protocol::CodeAgentErrorCode::InvalidInput,
                "host file kind is invalid",
                None,
            ));
        }
        browse_directory(path, Some(kind)).await.map_err(map_error)
    }

    async fn open_capabilities(
        &self,
        context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        ensure_active(context)?;
        Ok(open_capabilities())
    }

    async fn open_project_path(
        &self,
        project_id: &ProjectId,
        app_id: &str,
        path: Option<&str>,
        context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        ensure_active(context)?;
        let service = self.service(project_id).await?;
        let target = match path {
            Some(path) if Path::new(path).is_absolute() => tokio::fs::canonicalize(path)
                .await
                .map_err(PlatformError::from)
                .map_err(map_error)?,
            Some(path) => service
                .policy
                .resolve_relative(path)
                .await
                .map_err(map_error)?,
            None => service.policy.root().to_owned(),
        };
        let (program, arguments) = open_command(app_id, &target)?;
        let status = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            tokio::process::Command::new(program)
                .args(arguments)
                .status(),
        )
        .await
        .map_err(|_| {
            CodeAgentError::new(
                code_agent_protocol::CodeAgentErrorCode::Timeout,
                "system open timed out",
                None,
            )
        })?
        .map_err(|error| CodeAgentError::internal(error.to_string()))?;
        if !status.success() {
            return Err(CodeAgentError::internal("system open failed"));
        }
        Ok(json!({ "appId": app_id, "path": path }))
    }
}

async fn browse_directory(path: Option<&str>, kind: Option<&str>) -> Result<Value, PlatformError> {
    let requested = path.map(PathBuf::from).unwrap_or_else(home_directory);
    if !requested.is_absolute()
        || tokio::fs::symlink_metadata(&requested)
            .await?
            .file_type()
            .is_symlink()
    {
        return Err(PlatformError::Worker(
            "directory path is invalid".to_owned(),
        ));
    }
    let resolved = tokio::fs::canonicalize(requested).await?;
    if !tokio::fs::metadata(&resolved).await?.is_dir() {
        return Err(PlatformError::Worker(
            "directory path is invalid".to_owned(),
        ));
    }
    let mut entries = Vec::new();
    let mut children = tokio::fs::read_dir(&resolved).await?;
    while let Some(child) = children.next_entry().await? {
        let file_type = child.file_type().await?;
        if file_type.is_symlink() {
            continue;
        }
        let child_path = child.path();
        if file_type.is_dir() {
            entries.push(json!({ "name": child.file_name().to_string_lossy(), "path": child_path, "type": "directory" }));
        } else if file_type.is_file()
            && kind.is_some_and(|kind| supported_host_file(kind, &child_path))
        {
            entries.push(json!({ "name": child.file_name().to_string_lossy(), "path": child_path, "type": "file" }));
        }
    }
    entries.sort_by(|left, right| left["name"].as_str().cmp(&right["name"].as_str()));
    let parent = resolved
        .parent()
        .filter(|parent| *parent != resolved)
        .map(|parent| parent.to_string_lossy().into_owned());
    Ok(json!({ "entries": entries, "parentPath": parent, "path": resolved }))
}

fn supported_host_file(kind: &str, path: &Path) -> bool {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    match kind {
        "image" => matches!(extension.as_str(), "gif" | "jpeg" | "jpg" | "png" | "webp"),
        "file" => matches!(
            extension.as_str(),
            "csv"
                | "html"
                | "json"
                | "md"
                | "pdf"
                | "txt"
                | "xml"
                | "yaml"
                | "yml"
                | "doc"
                | "docx"
                | "ppt"
                | "pptx"
                | "xls"
                | "xlsx"
        ),
        _ => false,
    }
}

fn home_directory() -> PathBuf {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(std::path::MAIN_SEPARATOR.to_string()))
}

fn open_capabilities() -> Value {
    #[cfg(target_os = "macos")]
    let (platform, apps) = (
        "darwin",
        json!([
            { "id": "system-default", "kind": "system-default", "name": "系统默认应用" },
            { "id": "finder", "kind": "file-manager", "name": "Finder" }
        ]),
    );
    #[cfg(target_os = "windows")]
    let (platform, apps) = (
        "win32",
        json!([{ "id": "explorer", "kind": "file-manager", "name": "Explorer" }]),
    );
    #[cfg(target_os = "linux")]
    let (platform, apps) = (
        "linux",
        json!([{ "id": "file-manager", "kind": "file-manager", "name": "文件管理器" }]),
    );
    json!({ "apps": apps, "platform": platform })
}

fn open_command(
    app_id: &str,
    target: &Path,
) -> Result<(&'static str, Vec<String>), CodeAgentError> {
    let target = target.to_string_lossy().into_owned();
    #[cfg(target_os = "macos")]
    return match app_id {
        "system-default" => Ok(("/usr/bin/open", vec![target])),
        "finder" => Ok(("/usr/bin/open", vec!["-R".to_owned(), target])),
        _ => Err(CodeAgentError::new(
            code_agent_protocol::CodeAgentErrorCode::InvalidInput,
            "open app is unavailable",
            None,
        )),
    };
    #[cfg(target_os = "windows")]
    return match app_id {
        "explorer" => Ok(("explorer.exe", vec![target])),
        _ => Err(CodeAgentError::new(
            code_agent_protocol::CodeAgentErrorCode::InvalidInput,
            "open app is unavailable",
            None,
        )),
    };
    #[cfg(target_os = "linux")]
    return match app_id {
        "file-manager" => Ok(("xdg-open", vec![target])),
        _ => Err(CodeAgentError::new(
            code_agent_protocol::CodeAgentErrorCode::InvalidInput,
            "open app is unavailable",
            None,
        )),
    };
}

fn ensure_active(context: &PortRequestContext) -> Result<(), CodeAgentError> {
    if context.is_cancelled() {
        return Err(CodeAgentError::new(
            code_agent_protocol::CodeAgentErrorCode::Cancelled,
            "operation was cancelled",
            None,
        ));
    }
    Ok(())
}

fn map_error(error: PlatformError) -> CodeAgentError {
    match error {
        PlatformError::Worker(message) if message == "project not found" => {
            CodeAgentError::new(CodeAgentErrorCode::NotFound, "project was not found", None)
                .with_mutation_code(AgentMutationErrorCode::ProjectNotFound)
        }
        PlatformError::InvalidOptions(message) => {
            CodeAgentError::new(CodeAgentErrorCode::InvalidInput, message, None)
        }
        PlatformError::Timeout => CodeAgentError::new(
            CodeAgentErrorCode::Timeout,
            "filesystem request timed out",
            None,
        ),
        PlatformError::Closed => CodeAgentError::new(
            CodeAgentErrorCode::ShuttingDown,
            "filesystem service is closed",
            None,
        ),
        other => CodeAgentError::internal(other.to_string()),
    }
}

fn detect_image(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]) {
        Some("image/png")
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("image/gif")
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        Some("image/webp")
    } else {
        None
    }
}
