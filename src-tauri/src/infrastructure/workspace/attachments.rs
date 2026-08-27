use std::path::{Path, PathBuf};

use serde::Serialize;
use sha2::{Digest, Sha256};

use super::path_guard::WorkspaceError;

const MAX_FILE_BYTES: usize = 50 * 1024 * 1024;
const MAX_IMAGE_BYTES: usize = 10 * 1024 * 1024;

#[derive(Debug, Serialize)]
pub struct AttachmentResponse {
    pub attachment: Attachment,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub id: String,
    pub kind: &'static str,
    pub media_type: String,
    pub name: String,
    pub size: usize,
}

pub async fn store_attachment(
    app_data: &Path,
    project_id: &str,
    kind: &str,
    name: &str,
    bytes: &[u8],
) -> Result<AttachmentResponse, WorkspaceError> {
    validate_project_id(project_id)?;
    validate_name(name)?;
    let kind = validate_content(kind, name, bytes)?;
    let directory = attachment_directory(app_data, project_id);
    tokio::fs::create_dir_all(&directory).await?;
    let mut hasher = Sha256::new();
    hasher.update(project_id.as_bytes());
    hasher.update([0]);
    hasher.update(name.as_bytes());
    hasher.update([0]);
    hasher.update(bytes);
    let hash: String = hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    let extension = Path::new(name)
        .extension()
        .and_then(|value| value.to_str())
        .filter(|value| value.len() <= 16)
        .map(|value| format!(".{value}"))
        .unwrap_or_default();
    let path = directory.join(format!("{hash}{extension}"));
    if !tokio::fs::try_exists(&path).await? {
        tokio::fs::write(&path, bytes).await?;
    }
    Ok(AttachmentResponse {
        attachment: Attachment {
            id: path.to_string_lossy().into_owned(),
            kind,
            media_type: media_type(name).to_owned(),
            name: name.to_owned(),
            size: bytes.len(),
        },
    })
}

pub async fn import_attachment(
    app_data: &Path,
    project_id: &str,
    kind: &str,
    source: &str,
) -> Result<AttachmentResponse, WorkspaceError> {
    let source = tokio::fs::canonicalize(source).await?;
    let metadata = tokio::fs::metadata(&source).await?;
    if !metadata.is_file()
        || usize::try_from(metadata.len()).map_err(|_| WorkspaceError::InvalidPath)?
            > MAX_FILE_BYTES
    {
        return Err(WorkspaceError::InvalidPath);
    }
    let name = source
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or(WorkspaceError::InvalidPath)?;
    let bytes = tokio::fs::read(&source).await?;
    store_attachment(app_data, project_id, kind, name, &bytes).await
}

pub async fn validate_attachment(
    app_data: &Path,
    project_id: &str,
    attachment_id: &str,
) -> Result<PathBuf, WorkspaceError> {
    validate_project_id(project_id)?;
    let directory = attachment_directory(app_data, project_id);
    let directory = tokio::fs::canonicalize(directory).await?;
    let path = tokio::fs::canonicalize(attachment_id).await?;
    if !path.starts_with(directory) || !tokio::fs::metadata(&path).await?.is_file() {
        return Err(WorkspaceError::InvalidPath);
    }
    Ok(path)
}

fn attachment_directory(app_data: &Path, project_id: &str) -> PathBuf {
    app_data.join("attachments").join(project_id)
}

fn validate_project_id(project_id: &str) -> Result<(), WorkspaceError> {
    if project_id.is_empty()
        || !project_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(WorkspaceError::InvalidPath);
    }
    Ok(())
}

fn validate_name(name: &str) -> Result<(), WorkspaceError> {
    if name.is_empty()
        || name.len() > 255
        || name.contains(['/', '\\', '\0', '\r', '\n'])
        || matches!(name, "." | "..")
    {
        return Err(WorkspaceError::InvalidPath);
    }
    Ok(())
}

fn validate_content(kind: &str, name: &str, bytes: &[u8]) -> Result<&'static str, WorkspaceError> {
    if bytes.is_empty() {
        return Err(WorkspaceError::InvalidPath);
    }
    match kind {
        "file" if bytes.len() <= MAX_FILE_BYTES => Ok("file"),
        "image" if bytes.len() <= MAX_IMAGE_BYTES && is_supported_image(name, bytes) => Ok("image"),
        _ => Err(WorkspaceError::InvalidPath),
    }
}

fn is_supported_image(name: &str, bytes: &[u8]) -> bool {
    match Path::new(name)
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("png") => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        Some("jpg" | "jpeg") => bytes.starts_with(&[0xff, 0xd8, 0xff]),
        Some("gif") => bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a"),
        Some("webp") => bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP"),
        _ => false,
    }
}

fn media_type(name: &str) -> &'static str {
    match Path::new(name)
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("md") => "text/markdown",
        Some("json") => "application/json",
        Some("rs") => "text/x-rust",
        Some("ts" | "tsx") => "text/x-typescript",
        Some("txt") => "text/plain",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use std::{fs, time::SystemTime};

    use super::*;

    #[tokio::test]
    async fn attachment_cache_should_validate_project_scope_and_image_content() {
        let unique = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("codeagent-attachments-{unique}"));
        let png = b"\x89PNG\r\n\x1a\ncontent";
        let response = store_attachment(&root, "project-a", "image", "test.png", png)
            .await
            .unwrap();
        assert_eq!(response.attachment.media_type, "image/png");
        assert!(
            validate_attachment(&root, "project-a", &response.attachment.id)
                .await
                .is_ok()
        );
        assert!(
            validate_attachment(&root, "project-b", &response.attachment.id)
                .await
                .is_err()
        );
        fs::remove_dir_all(root).unwrap();
    }
}
