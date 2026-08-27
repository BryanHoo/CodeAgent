use std::path::{Path, PathBuf};

use crate::domain::sidebar::{FilesystemRoot, ProjectDirectoryEntry, ProjectDirectoryListing};

pub async fn list_project_directories(
    default_path: &Path,
    requested_path: Option<&str>,
    include_hidden: bool,
) -> Result<ProjectDirectoryListing, std::io::Error> {
    let requested = requested_path.map_or_else(|| default_path.to_path_buf(), PathBuf::from);
    let path = tokio::fs::canonicalize(requested).await?;
    let metadata = tokio::fs::metadata(&path).await?;
    if !metadata.is_dir() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "path is not a directory",
        ));
    }

    let mut reader = tokio::fs::read_dir(&path).await?;
    let mut entries = Vec::new();
    while let Some(entry) = reader.next_entry().await? {
        let name = entry.file_name().to_string_lossy().into_owned();
        if (!include_hidden && name.starts_with('.')) || !entry.metadata().await?.is_dir() {
            continue;
        }
        let entry_path = tokio::fs::canonicalize(entry.path()).await?;
        entries.push(ProjectDirectoryEntry {
            name,
            path: entry_path.to_string_lossy().into_owned(),
        });
    }
    entries.sort_unstable_by(|left, right| {
        left.name
            .to_lowercase()
            .cmp(&right.name.to_lowercase())
            .then_with(|| left.name.cmp(&right.name))
    });

    let roots = filesystem_roots();
    Ok(ProjectDirectoryListing {
        entries,
        parent_path: path
            .parent()
            .map(|parent| parent.to_string_lossy().into_owned()),
        path: path.to_string_lossy().into_owned(),
        roots,
    })
}

#[cfg(not(target_os = "windows"))]
fn filesystem_roots() -> Vec<FilesystemRoot> {
    vec![FilesystemRoot {
        name: "/".to_owned(),
        path: "/".to_owned(),
    }]
}

#[cfg(target_os = "windows")]
fn filesystem_roots() -> Vec<FilesystemRoot> {
    (b'A'..=b'Z')
        .filter_map(|drive| {
            let path = format!("{}:\\", char::from(drive));
            Path::new(&path).is_dir().then(|| FilesystemRoot {
                name: path.clone(),
                path,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use std::{fs, time::SystemTime};

    use super::list_project_directories;

    #[tokio::test]
    async fn directory_listing_should_filter_hidden_and_non_directories() {
        let unique = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("codeagent-sidebar-{unique}"));
        fs::create_dir_all(root.join("zeta")).unwrap();
        fs::create_dir_all(root.join("alpha")).unwrap();
        fs::create_dir_all(root.join(".hidden")).unwrap();
        fs::write(root.join("file.txt"), b"ignored").unwrap();
        let canonical_root = fs::canonicalize(&root).unwrap();

        let listing = list_project_directories(&root, None, false)
            .await
            .expect("directory should list");

        assert_eq!(
            listing
                .entries
                .iter()
                .map(|entry| entry.name.as_str())
                .collect::<Vec<_>>(),
            ["alpha", "zeta"]
        );
        assert_eq!(listing.path, canonical_root.to_string_lossy());
        assert_eq!(
            listing.parent_path.as_deref(),
            canonical_root
                .parent()
                .map(|path| path.to_string_lossy())
                .as_deref()
        );
        assert!(!listing.roots.is_empty());

        fs::remove_dir_all(root).unwrap();
    }
}
