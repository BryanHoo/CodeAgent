use std::path::{Path, PathBuf};

use serde_json::{Value, json};

use crate::PlatformError;

pub async fn filesystem_roots() -> Vec<PathBuf> {
    #[cfg(windows)]
    {
        let mut probes = tokio::task::JoinSet::new();
        for letter in b'A'..=b'Z' {
            probes.spawn(async move {
                let path = PathBuf::from(format!("{}:\\", char::from(letter)));
                tokio::fs::try_exists(&path)
                    .await
                    .unwrap_or(false)
                    .then_some(path)
            });
        }

        let mut roots = Vec::with_capacity(26);
        while let Some(result) = probes.join_next().await {
            if let Ok(Some(path)) = result {
                roots.push(path);
            }
        }
        roots.sort_unstable();
        roots
    }
    #[cfg(not(windows))]
    {
        vec![PathBuf::from(std::path::MAIN_SEPARATOR.to_string())]
    }
}

pub(crate) async fn browse_directory(
    path: Option<&str>,
    kind: Option<&str>,
    show_hidden: bool,
) -> Result<Value, PlatformError> {
    let (resolved, roots) = tokio::join!(resolve_directory(path), filesystem_roots());
    let resolved = resolved?;
    let roots = roots
        .into_iter()
        .map(|path| {
            let display = path.to_string_lossy();
            let trimmed = display.trim_end_matches(['/', '\\']);
            let name = if trimmed.is_empty() {
                display.as_ref()
            } else {
                trimmed
            };
            json!({ "name": name, "path": path })
        })
        .collect::<Vec<_>>();
    let mut entries = Vec::new();
    let mut children = tokio::fs::read_dir(&resolved).await?;
    while let Some(child) = children.next_entry().await? {
        if !show_hidden && is_hidden_entry(&child).await? {
            continue;
        }
        let file_type = child.file_type().await?;
        if file_type.is_symlink() {
            continue;
        }
        let child_path = child.path();
        if file_type.is_dir() {
            let entry = match kind {
                // ProjectDirectoryListing 保持严格的 name + path 条目契约。
                None => json!({ "name": child.file_name().to_string_lossy(), "path": child_path }),
                Some(_) => {
                    json!({ "name": child.file_name().to_string_lossy(), "path": child_path, "type": "directory" })
                }
            };
            entries.push(entry);
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
    Ok(json!({ "entries": entries, "parentPath": parent, "path": resolved, "roots": roots }))
}

async fn is_hidden_entry(entry: &tokio::fs::DirEntry) -> Result<bool, std::io::Error> {
    if entry.file_name().to_string_lossy().starts_with('.') {
        return Ok(true);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;

        const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
        return Ok(entry.metadata().await?.file_attributes() & FILE_ATTRIBUTE_HIDDEN != 0);
    }
    #[cfg(not(windows))]
    Ok(false)
}

async fn resolve_directory(path: Option<&str>) -> Result<PathBuf, PlatformError> {
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
    Ok(resolved)
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

#[cfg(test)]
mod tests {
    use std::fs;

    use super::browse_directory;

    #[tokio::test]
    async fn browse_directory_should_include_roots_for_both_listing_kinds() {
        let root =
            std::env::temp_dir().join(format!("code-agent-host-browser-{}", std::process::id()));
        fs::create_dir_all(&root).expect("fixture directory must be created");
        fs::create_dir_all(root.join("source")).expect("fixture child directory must be created");
        fs::write(root.join("notes.txt"), b"notes").expect("fixture file must be created");
        let root_path = root.to_string_lossy();

        let directories = browse_directory(Some(&root_path), None, false)
            .await
            .expect("directory listing must succeed");
        let host_files = browse_directory(Some(&root_path), Some("file"), false)
            .await
            .expect("host file listing must succeed");

        assert!(
            directories["roots"]
                .as_array()
                .is_some_and(|roots| !roots.is_empty())
        );
        assert!(
            host_files["roots"]
                .as_array()
                .is_some_and(|roots| !roots.is_empty())
        );
        let directory_entry = directories["entries"]
            .as_array()
            .and_then(|entries| entries.iter().find(|entry| entry["name"] == "source"))
            .expect("project directory entry must exist");
        let host_directory_entry = host_files["entries"]
            .as_array()
            .and_then(|entries| entries.iter().find(|entry| entry["name"] == "source"))
            .expect("host directory entry must exist");
        assert_eq!(directory_entry.get("type"), None);
        assert_eq!(host_directory_entry["type"], "directory");
        fs::remove_dir_all(root).expect("fixture directory must be removed");
    }

    #[tokio::test]
    async fn browse_directory_should_hide_dot_entries_by_default() {
        let root =
            std::env::temp_dir().join(format!("code-agent-hidden-browser-{}", std::process::id()));
        fs::create_dir_all(root.join(".private")).expect("hidden directory must be created");
        fs::write(root.join(".secret.txt"), b"secret").expect("hidden file must be created");
        fs::write(root.join("notes.txt"), b"notes").expect("visible file must be created");
        let root_path = root.to_string_lossy();

        let hidden = browse_directory(Some(&root_path), Some("file"), false)
            .await
            .expect("default listing must succeed");
        let visible = browse_directory(Some(&root_path), Some("file"), true)
            .await
            .expect("hidden listing must succeed");

        let hidden_names = hidden["entries"]
            .as_array()
            .expect("entries")
            .iter()
            .filter_map(|entry| entry["name"].as_str())
            .collect::<Vec<_>>();
        let visible_names = visible["entries"]
            .as_array()
            .expect("entries")
            .iter()
            .filter_map(|entry| entry["name"].as_str())
            .collect::<Vec<_>>();
        assert_eq!(hidden_names, vec!["notes.txt"]);
        assert_eq!(visible_names, vec![".private", ".secret.txt", "notes.txt"]);
        fs::remove_dir_all(root).expect("fixture directory must be removed");
    }
}
