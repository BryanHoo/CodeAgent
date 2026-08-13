use std::path::Path;

use code_agent_core::PortRequestContext;

use crate::PlatformError;

pub(crate) const MAX_PROJECT_FILE_DEPTH: usize = 20;

const IGNORED_DIRECTORIES: &[&str] = &[
    ".git",
    ".next",
    ".turbo",
    "build",
    "coverage",
    "dist",
    "node_modules",
    "target",
];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ProjectTreeEntryKind {
    Directory,
    File,
}

impl ProjectTreeEntryKind {
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Directory => "directory",
            Self::File => "file",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ProjectTreeEntry {
    pub(crate) kind: ProjectTreeEntryKind,
    pub(crate) path: String,
}

pub(crate) fn is_ignored_directory_name(name: &str) -> bool {
    IGNORED_DIRECTORIES.contains(&name)
}

pub(crate) fn validate_directory_path(path: Option<&str>) -> Result<(), PlatformError> {
    let Some(path) = path else {
        return Ok(());
    };
    if path.is_empty()
        || path.starts_with('/')
        || path.ends_with('/')
        || path.contains('\\')
        || path.contains("//")
        || path.as_bytes().get(1) == Some(&b':')
    {
        return Err(invalid_tree_path());
    }
    let mut depth = 0;
    for segment in path.split('/') {
        if matches!(segment, "" | "." | "..") || is_ignored_directory_name(segment) {
            return Err(invalid_tree_path());
        }
        depth += 1;
        if depth > MAX_PROJECT_FILE_DEPTH {
            return Err(invalid_tree_path());
        }
    }
    Ok(())
}

pub(crate) async fn read_directory_entries(
    root: &Path,
    directory: &Path,
    context: &PortRequestContext,
) -> Result<Vec<ProjectTreeEntry>, PlatformError> {
    ensure_active(context)?;
    let mut entries = Vec::new();
    let mut children = tokio::fs::read_dir(directory).await?;
    loop {
        let child = tokio::select! {
            () = context.cancelled() => return Err(PlatformError::Cancelled),
            child = children.next_entry() => child?,
        };
        let Some(child) = child else {
            break;
        };
        let file_type = tokio::select! {
            () = context.cancelled() => return Err(PlatformError::Cancelled),
            file_type = child.file_type() => file_type?,
        };
        let child_path = child.path();
        let name = child.file_name();
        if file_type.is_symlink()
            || (file_type.is_dir() && name.to_str().is_some_and(is_ignored_directory_name))
        {
            continue;
        }
        let kind = if file_type.is_dir() {
            ProjectTreeEntryKind::Directory
        } else if file_type.is_file() {
            ProjectTreeEntryKind::File
        } else {
            continue;
        };
        entries.push(ProjectTreeEntry {
            kind,
            path: project_relative_path(root, &child_path)?,
        });
    }
    entries.sort_unstable_by(|left, right| {
        kind_order(left.kind)
            .cmp(&kind_order(right.kind))
            .then_with(|| left.path.cmp(&right.path))
    });
    Ok(entries)
}

fn kind_order(kind: ProjectTreeEntryKind) -> u8 {
    match kind {
        ProjectTreeEntryKind::Directory => 0,
        ProjectTreeEntryKind::File => 1,
    }
}

fn project_relative_path(root: &Path, path: &Path) -> Result<String, PlatformError> {
    path.strip_prefix(root)
        .map_err(|_| PlatformError::Worker("file tree escaped project root".to_owned()))
        .map(|relative| relative.to_string_lossy().replace('\\', "/"))
}

fn ensure_active(context: &PortRequestContext) -> Result<(), PlatformError> {
    if context.is_cancelled() {
        return Err(PlatformError::Cancelled);
    }
    Ok(())
}

fn invalid_tree_path() -> PlatformError {
    PlatformError::InvalidOptions("project file tree path is invalid".to_owned())
}

#[cfg(test)]
mod tests {
    use std::fs;

    use code_agent_core::PortRequestContext;

    use super::{
        ProjectTreeEntry, ProjectTreeEntryKind, read_directory_entries, validate_directory_path,
    };

    fn test_root(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "code-agent-project-tree-{name}-{}",
            std::process::id()
        ))
    }

    #[tokio::test]
    async fn directory_entries_should_keep_paths_listed_by_gitignore() {
        let root = test_root("gitignore");
        fs::create_dir_all(root.join("generated/nested")).expect("generated directory");
        fs::create_dir_all(root.join("node_modules/package")).expect("dependency directory");
        fs::write(root.join(".gitignore"), "generated/\n").expect("ignore rules");
        fs::write(root.join("generated/kept.txt"), "kept").expect("kept file");
        fs::write(root.join("README.md"), "readme").expect("root file");
        let context = PortRequestContext::new("tree-test");

        let root_entries = read_directory_entries(&root, &root, &context)
            .await
            .expect("root entries");
        let generated_entries = read_directory_entries(&root, &root.join("generated"), &context)
            .await
            .expect("generated entries");

        assert_eq!(
            root_entries,
            vec![
                ProjectTreeEntry {
                    kind: ProjectTreeEntryKind::Directory,
                    path: "generated".to_owned(),
                },
                ProjectTreeEntry {
                    kind: ProjectTreeEntryKind::File,
                    path: ".gitignore".to_owned(),
                },
                ProjectTreeEntry {
                    kind: ProjectTreeEntryKind::File,
                    path: "README.md".to_owned(),
                },
            ]
        );
        assert!(
            generated_entries
                .iter()
                .any(|entry| entry.path == "generated/kept.txt")
        );
        fs::remove_dir_all(root).expect("remove root");
    }

    #[test]
    fn directory_path_should_enforce_depth_and_generated_directory_boundaries() {
        let depth_twenty = std::iter::repeat_n("a", 20).collect::<Vec<_>>().join("/");
        let depth_twenty_one = format!("{depth_twenty}/b");

        assert!(validate_directory_path(Some(&depth_twenty)).is_ok());
        assert!(validate_directory_path(Some(&depth_twenty_one)).is_err());
        assert!(validate_directory_path(Some("src/node_modules/package")).is_err());
        assert!(validate_directory_path(Some("../src")).is_err());
    }

    #[tokio::test]
    async fn directory_entries_should_stop_after_cancellation() {
        let root = test_root("cancelled");
        fs::create_dir_all(&root).expect("root");
        let context = PortRequestContext::new("cancelled-tree-test");
        context.cancel();

        let result = read_directory_entries(&root, &root, &context).await;

        assert!(matches!(result, Err(crate::PlatformError::Cancelled)));
        fs::remove_dir_all(root).expect("remove root");
    }
}
