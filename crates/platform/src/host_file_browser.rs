use std::path::{Path, PathBuf};

use serde_json::{Value, json};

use crate::PlatformError;

pub(crate) async fn browse_directory(
    path: Option<&str>,
    kind: Option<&str>,
) -> Result<Value, PlatformError> {
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
