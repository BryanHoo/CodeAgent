use std::path::{Path, PathBuf};

use async_trait::async_trait;
use code_agent_core::{
    AgentMutationErrorCode, CodeAgentError, CodeAgentErrorCode, FilePort, PortRequestContext,
};
use code_agent_protocol::ProjectId;
use rusqlite::OptionalExtension;
use serde_json::{Value, json};
use tokio::io::{AsyncReadExt, AsyncSeekExt};

use crate::host_file_browser::browse_directory;
use crate::project_file_index_cache::ProjectFileIndexCache;
use crate::project_open::{OpenTarget, ProjectOpenService};
use crate::project_tree::{read_directory_entries, validate_directory_path};
use crate::{CanonicalPathPolicy, PlatformDatabase, PlatformError, ProcessEnvironment};

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
    file_indexes: ProjectFileIndexCache,
    project_open: ProjectOpenService,
}

impl PlatformFilePort {
    #[must_use]
    pub fn new(database: PlatformDatabase, environment: ProcessEnvironment) -> Self {
        Self {
            database,
            file_indexes: ProjectFileIndexCache::new(),
            project_open: ProjectOpenService::new(environment),
        }
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
            .await
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
        validate_directory_path(path).map_err(map_error)?;
        let directory = match path {
            Some(path) => service
                .policy
                .resolve_relative(path)
                .await
                .map_err(map_error)?,
            None => service.policy.root().to_owned(),
        };
        // 文件树按目录懒加载；禁止把整个 Project 一次性序列化给 WebView。
        let entries = read_directory_entries(service.policy.root(), &directory, context)
            .await
            .map_err(map_error)?
            .into_iter()
            .map(|entry| json!({ "path": entry.path, "type": entry.kind.as_str() }))
            .collect::<Vec<_>>();
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
        let index = self
            .file_indexes
            .get_or_build(project_id.as_str(), service.policy.root(), context)
            .await
            .map_err(map_error)?;
        let data = index
            .search(query)
            .into_iter()
            .map(|entry| json!({ "name": entry.name, "path": entry.path }))
            .collect::<Vec<_>>();
        Ok(json!({ "data": data }))
    }

    async fn release_project(
        &self,
        project_id: &ProjectId,
        _context: &PortRequestContext,
    ) -> Result<(), CodeAgentError> {
        self.file_indexes
            .release_project(project_id.as_str())
            .await
            .map_err(map_error)?;
        Ok(())
    }

    async fn close(&self) -> Result<(), CodeAgentError> {
        self.file_indexes.close().await.map_err(map_error)?;
        Ok(())
    }

    async fn browse_directories(
        &self,
        path: Option<&str>,
        show_hidden: bool,
        context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        ensure_active(context)?;
        browse_directory(path, None, show_hidden)
            .await
            .map_err(map_error)
    }

    async fn browse_host_files(
        &self,
        kind: &str,
        path: Option<&str>,
        show_hidden: bool,
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
        browse_directory(path, Some(kind), show_hidden)
            .await
            .map_err(map_error)
    }

    async fn open_capabilities(
        &self,
        context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        ensure_active(context)?;
        Ok(self.project_open.capabilities())
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
        let metadata = tokio::fs::metadata(&target)
            .await
            .map_err(PlatformError::from)
            .map_err(map_error)?;
        let target = OpenTarget::new(&target, metadata.is_dir());
        self.project_open
            .open(&target, service.policy.root(), app_id)
            .await?;
        Ok(json!({ "appId": app_id, "path": path }))
    }
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
        PlatformError::Cancelled => CodeAgentError::new(
            code_agent_protocol::CodeAgentErrorCode::Cancelled,
            "operation was cancelled",
            None,
        ),
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
