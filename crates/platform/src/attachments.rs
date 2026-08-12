use std::{
    collections::HashMap,
    num::NonZeroU64,
    path::{Path, PathBuf},
    str::FromStr,
    sync::Arc,
};

use async_trait::async_trait;
use code_agent_core::{AttachmentPort, CodeAgentError, CodeAgentErrorCode, PortRequestContext};
use code_agent_protocol::{
    AgentAttachment, AgentAttachmentId, AgentAttachmentKind, AgentAttachmentMediaType,
    AgentAttachmentName, ProjectId, TaskId,
};
use tokio::sync::Mutex;
use uuid::Uuid;

const MAX_FILE_BYTES: usize = 50 * 1024 * 1024;
const MAX_IMAGE_BYTES: usize = 10 * 1024 * 1024;
const MAX_TEXT_BYTES: usize = 1024 * 1024;
const MAX_TOTAL_BYTES: usize = 100 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AttachmentKind {
    File,
    Image,
    Text,
}

impl From<AttachmentKind> for AgentAttachmentKind {
    fn from(value: AttachmentKind) -> Self {
        match value {
            AttachmentKind::File => Self::File,
            AttachmentKind::Image => Self::Image,
            AttachmentKind::Text => Self::Text,
        }
    }
}

impl From<AgentAttachmentKind> for AttachmentKind {
    fn from(value: AgentAttachmentKind) -> Self {
        match value {
            AgentAttachmentKind::File => Self::File,
            AgentAttachmentKind::Image => Self::Image,
            AgentAttachmentKind::Text => Self::Text,
        }
    }
}

#[derive(Debug)]
pub struct AttachmentUpload {
    pub bytes: Vec<u8>,
    pub kind: AttachmentKind,
    pub media_type: String,
    pub name: String,
}

#[derive(Debug)]
pub struct AttachmentContent {
    pub attachment: AgentAttachment,
    pub bytes: Vec<u8>,
}

#[derive(Clone, Debug)]
struct StoredAttachment {
    attachment: AgentAttachment,
    path: PathBuf,
    project_id: String,
    task_id: Option<String>,
}

#[derive(Default)]
struct AttachmentState {
    entries: HashMap<String, StoredAttachment>,
    total_bytes: usize,
}

#[derive(Clone)]
pub struct AttachmentStore {
    root: Arc<PathBuf>,
    state: Arc<Mutex<AttachmentState>>,
}

impl AttachmentStore {
    pub async fn new(root: impl AsRef<Path>) -> Result<Self, CodeAgentError> {
        tokio::fs::create_dir_all(root.as_ref())
            .await
            .map_err(|_| internal("attachment root could not be created"))?;
        let root = tokio::fs::canonicalize(root.as_ref())
            .await
            .map_err(|_| internal("attachment root could not be resolved"))?;
        Ok(Self {
            root: Arc::new(root),
            state: Arc::new(Mutex::new(AttachmentState::default())),
        })
    }

    pub async fn add(
        &self,
        project_id: &str,
        upload: AttachmentUpload,
    ) -> Result<AgentAttachment, CodeAgentError> {
        validate_upload(&upload)?;
        let id = Uuid::new_v4().to_string();
        let path = self.root.join(&id);
        let size = upload.bytes.len();
        let mut state = self.state.lock().await;
        if state.total_bytes.saturating_add(size) > MAX_TOTAL_BYTES {
            return Err(capacity("attachment store capacity exceeded"));
        }
        tokio::fs::write(&path, &upload.bytes)
            .await
            .map_err(|_| internal("attachment could not be stored"))?;
        let attachment =
            build_attachment(&id, upload.kind, &upload.media_type, &upload.name, size)?;
        state.entries.insert(
            id,
            StoredAttachment {
                attachment: attachment.clone(),
                path,
                project_id: project_id.to_owned(),
                task_id: None,
            },
        );
        state.total_bytes += size;
        Ok(attachment)
    }

    pub async fn import_host(
        &self,
        project_id: &str,
        kind: AttachmentKind,
        path: impl AsRef<Path>,
    ) -> Result<AgentAttachment, CodeAgentError> {
        let path = path.as_ref();
        let metadata = tokio::fs::symlink_metadata(path)
            .await
            .map_err(|_| not_found())?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(invalid("host attachment must be a regular file"));
        }
        let maximum = match kind {
            AttachmentKind::File => MAX_FILE_BYTES,
            AttachmentKind::Image => MAX_IMAGE_BYTES,
            AttachmentKind::Text => MAX_TEXT_BYTES,
        };
        if metadata.len() == 0 || metadata.len() > maximum as u64 {
            return Err(capacity("attachment exceeds the maximum size"));
        }
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or_else(|| invalid("host attachment name is invalid"))?
            .to_owned();
        let media_type = infer_media_type(kind, path)?;
        let bytes = tokio::fs::read(path).await.map_err(|_| not_found())?;
        self.add(
            project_id,
            AttachmentUpload {
                bytes,
                kind,
                media_type,
                name,
            },
        )
        .await
    }

    pub async fn read(
        &self,
        project_id: &str,
        attachment_id: &str,
    ) -> Result<AttachmentContent, CodeAgentError> {
        self.read_owned(project_id, None, attachment_id).await
    }

    pub async fn read_task(
        &self,
        project_id: &str,
        task_id: &str,
        attachment_id: &str,
    ) -> Result<AttachmentContent, CodeAgentError> {
        self.read_owned(project_id, Some(task_id), attachment_id)
            .await
    }

    async fn read_owned(
        &self,
        project_id: &str,
        task_id: Option<&str>,
        attachment_id: &str,
    ) -> Result<AttachmentContent, CodeAgentError> {
        let entry = {
            let state = self.state.lock().await;
            state
                .entries
                .get(attachment_id)
                .filter(|entry| {
                    entry.project_id == project_id
                        && match task_id {
                            Some(task_id) => entry.task_id.as_deref() == Some(task_id),
                            None => entry.task_id.is_none(),
                        }
                })
                .cloned()
                .ok_or_else(not_found)?
        };
        let bytes = tokio::fs::read(&entry.path)
            .await
            .map_err(|_| not_found())?;
        Ok(AttachmentContent {
            attachment: entry.attachment,
            bytes,
        })
    }

    pub async fn release_project(&self, project_id: &str) -> Result<(), CodeAgentError> {
        let entries = {
            let mut state = self.state.lock().await;
            let ids = state
                .entries
                .iter()
                .filter(|(_, entry)| entry.project_id == project_id)
                .map(|(id, _)| id.clone())
                .collect::<Vec<_>>();
            let mut removed = Vec::with_capacity(ids.len());
            for id in ids {
                if let Some(entry) = state.entries.remove(&id) {
                    state.total_bytes = state
                        .total_bytes
                        .saturating_sub(entry.attachment.size.get() as usize);
                    removed.push(entry);
                }
            }
            removed
        };
        for entry in entries {
            // path 只来自随机 ID，删除前仍验证位于 canonical 受管根内。
            if entry.path.parent() != Some(self.root.as_path()) {
                return Err(internal("attachment cleanup escaped managed root"));
            }
            match tokio::fs::remove_file(entry.path).await {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(_) => return Err(internal("attachment cleanup failed")),
            }
        }
        Ok(())
    }
}

#[async_trait]
impl AttachmentPort for AttachmentStore {
    async fn upload(
        &self,
        project_id: &ProjectId,
        kind: AgentAttachmentKind,
        media_type: &str,
        name: &str,
        bytes: Vec<u8>,
        context: &PortRequestContext,
    ) -> Result<AgentAttachment, CodeAgentError> {
        ensure_active(context)?;
        self.add(
            project_id,
            AttachmentUpload {
                bytes,
                kind: kind.into(),
                media_type: media_type.to_owned(),
                name: name.to_owned(),
            },
        )
        .await
    }

    async fn import_host(
        &self,
        project_id: &ProjectId,
        kind: AgentAttachmentKind,
        path: &str,
        context: &PortRequestContext,
    ) -> Result<AgentAttachment, CodeAgentError> {
        ensure_active(context)?;
        self.import_host(project_id, kind.into(), path).await
    }

    async fn read_pending(
        &self,
        project_id: &ProjectId,
        attachment_id: &str,
        context: &PortRequestContext,
    ) -> Result<Vec<u8>, CodeAgentError> {
        ensure_active(context)?;
        Ok(self.read(project_id, attachment_id).await?.bytes)
    }

    async fn read(
        &self,
        project_id: &ProjectId,
        task_id: &TaskId,
        attachment_id: &str,
        context: &PortRequestContext,
    ) -> Result<Vec<u8>, CodeAgentError> {
        ensure_active(context)?;
        Ok(self
            .read_task(project_id, task_id, attachment_id)
            .await?
            .bytes)
    }

    async fn release_project(
        &self,
        project_id: &ProjectId,
        context: &PortRequestContext,
    ) -> Result<(), CodeAgentError> {
        ensure_active(context)?;
        self.release_project(project_id).await
    }

    async fn open(
        &self,
        project_id: &ProjectId,
        task_id: &TaskId,
        attachment_id: &str,
        context: &PortRequestContext,
    ) -> Result<(), CodeAgentError> {
        ensure_active(context)?;
        let entry = {
            let state = self.state.lock().await;
            state
                .entries
                .get(attachment_id)
                .filter(|entry| {
                    entry.project_id == project_id.as_str()
                        && entry.task_id.as_deref() == Some(task_id.as_str())
                })
                .cloned()
                .ok_or_else(not_found)?
        };
        let mut command = default_open_command(&entry.path)?;
        let status = tokio::time::timeout(std::time::Duration::from_secs(5), command.status())
            .await
            .map_err(|_| {
                CodeAgentError::new(
                    CodeAgentErrorCode::Timeout,
                    "attachment open timed out",
                    None,
                )
            })?
            .map_err(|_| internal("attachment could not be opened"))?;
        if !status.success() {
            return Err(internal("attachment could not be opened"));
        }
        Ok(())
    }
}

fn default_open_command(path: &Path) -> Result<tokio::process::Command, CodeAgentError> {
    #[cfg(target_os = "macos")]
    let mut command = tokio::process::Command::new("open");
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = tokio::process::Command::new("cmd");
        command.args(["/C", "start", ""]);
        command
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = tokio::process::Command::new("xdg-open");
    command.arg(path);
    command.kill_on_drop(true);
    Ok(command)
}

fn validate_upload(upload: &AttachmentUpload) -> Result<(), CodeAgentError> {
    if upload.bytes.is_empty() || upload.name.is_empty() || upload.name.chars().count() > 255 {
        return Err(invalid("attachment metadata or content is invalid"));
    }
    let maximum = match upload.kind {
        AttachmentKind::File => MAX_FILE_BYTES,
        AttachmentKind::Image => MAX_IMAGE_BYTES,
        AttachmentKind::Text => MAX_TEXT_BYTES,
    };
    if upload.bytes.len() > maximum {
        return Err(capacity("attachment exceeds the maximum size"));
    }
    match upload.kind {
        AttachmentKind::Image if !valid_image(&upload.bytes, &upload.media_type) => {
            Err(invalid("attachment image content is invalid"))
        }
        AttachmentKind::Text
            if upload.media_type != "text/plain" || std::str::from_utf8(&upload.bytes).is_err() =>
        {
            Err(invalid("text attachment must contain UTF-8 text/plain"))
        }
        AttachmentKind::File if upload.media_type.is_empty() => {
            Err(invalid("attachment media type is invalid"))
        }
        _ => Ok(()),
    }
}

fn valid_image(bytes: &[u8], media_type: &str) -> bool {
    match media_type {
        "image/png" => bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]),
        "image/jpeg" => bytes.starts_with(&[0xff, 0xd8, 0xff]),
        "image/gif" => bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a"),
        "image/webp" => bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP"),
        _ => false,
    }
}

fn infer_media_type(kind: AttachmentKind, path: &Path) -> Result<String, CodeAgentError> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let media_type = match (kind, extension.as_str()) {
        (AttachmentKind::Image, "png") => "image/png",
        (AttachmentKind::Image, "jpg" | "jpeg") => "image/jpeg",
        (AttachmentKind::Image, "gif") => "image/gif",
        (AttachmentKind::Image, "webp") => "image/webp",
        (AttachmentKind::Text, _) => "text/plain",
        (AttachmentKind::File, _) => "application/octet-stream",
        _ => return Err(invalid("host attachment type is unsupported")),
    };
    Ok(media_type.to_owned())
}

fn build_attachment(
    id: &str,
    kind: AttachmentKind,
    media_type: &str,
    name: &str,
    size: usize,
) -> Result<AgentAttachment, CodeAgentError> {
    Ok(AgentAttachment {
        id: AgentAttachmentId::from_str(id).map_err(|_| internal("attachment id is invalid"))?,
        kind: kind.into(),
        media_type: AgentAttachmentMediaType::from_str(media_type)
            .map_err(|_| invalid("attachment media type is invalid"))?,
        name: AgentAttachmentName::from_str(name)
            .map_err(|_| invalid("attachment name is invalid"))?,
        size: NonZeroU64::new(size as u64)
            .ok_or_else(|| invalid("attachment must not be empty"))?,
    })
}

fn ensure_active(context: &PortRequestContext) -> Result<(), CodeAgentError> {
    if context.is_cancelled() {
        return Err(CodeAgentError::new(
            CodeAgentErrorCode::Cancelled,
            "operation was cancelled",
            None,
        ));
    }
    Ok(())
}

fn invalid(message: &'static str) -> CodeAgentError {
    CodeAgentError::new(CodeAgentErrorCode::InvalidInput, message, None)
}

fn capacity(message: &'static str) -> CodeAgentError {
    CodeAgentError::new(CodeAgentErrorCode::CapacityExceeded, message, None)
}

fn not_found() -> CodeAgentError {
    CodeAgentError::new(
        CodeAgentErrorCode::NotFound,
        "attachment was not found",
        None,
    )
}

fn internal(message: &'static str) -> CodeAgentError {
    CodeAgentError::internal(message)
}
