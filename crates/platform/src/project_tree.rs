use std::path::{Path, PathBuf};

use ignore::gitignore::{Gitignore, GitignoreBuilder};
use serde_json::{Value, json};

use crate::PlatformError;

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

fn is_ignored_directory(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| IGNORED_DIRECTORIES.contains(&name))
}

fn build_ignore_matcher(root: &Path, directory: &Path) -> Result<Gitignore, PlatformError> {
    let mut builder = GitignoreBuilder::new(root);
    let relative_directory = directory
        .strip_prefix(root)
        .map_err(|_| PlatformError::Worker("file tree escaped project root".to_owned()))?;
    let mut scope = PathBuf::from(root);
    // 只加载根目录到当前目录沿途的规则，保持分层读取与 Git 的作用域一致。
    add_ignore_file(&mut builder, &scope)?;
    for component in relative_directory.components() {
        scope.push(component);
        add_ignore_file(&mut builder, &scope)?;
    }
    builder
        .build()
        .map_err(|error| PlatformError::Worker(format!("invalid project ignore rules: {error}")))
}

fn add_ignore_file(builder: &mut GitignoreBuilder, directory: &Path) -> Result<(), PlatformError> {
    let path = directory.join(".gitignore");
    if !path.is_file() {
        return Ok(());
    }
    if let Some(error) = builder.add(path) {
        return Err(PlatformError::Worker(format!(
            "invalid project ignore rules: {error}"
        )));
    }
    Ok(())
}

fn project_relative_path(root: &Path, path: &Path) -> Result<String, PlatformError> {
    path.strip_prefix(root)
        .map_err(|_| PlatformError::Worker("file tree escaped project root".to_owned()))
        .map(|relative| relative.to_string_lossy().replace('\\', "/"))
}

pub(crate) async fn read_directory_entries(
    root: &Path,
    directory: &Path,
) -> Result<Vec<Value>, PlatformError> {
    let mut entries = Vec::new();
    let ignore_matcher = build_ignore_matcher(root, directory)?;
    let mut children = tokio::fs::read_dir(directory).await?;
    while let Some(child) = children.next_entry().await? {
        let file_type = child.file_type().await?;
        let child_path = child.path();
        if file_type.is_symlink()
            || (file_type.is_dir() && is_ignored_directory(&child_path))
            || ignore_matcher
                .matched_path_or_any_parents(&child_path, file_type.is_dir())
                .is_ignore()
        {
            continue;
        }
        let kind = if file_type.is_dir() {
            "directory"
        } else if file_type.is_file() {
            "file"
        } else {
            continue;
        };
        entries.push(json!({
            "path": project_relative_path(root, &child_path)?,
            "type": kind,
        }));
    }
    entries.sort_by(|left, right| left["path"].as_str().cmp(&right["path"].as_str()));
    Ok(entries)
}

pub(crate) async fn read_search_entries(root: &Path) -> Result<Vec<Value>, PlatformError> {
    let mut entries = Vec::new();
    let mut pending_directories = vec![PathBuf::from(root)];
    while let Some(directory) = pending_directories.pop() {
        for entry in read_directory_entries(root, &directory).await? {
            if entry["type"] == "directory" {
                let path = entry["path"]
                    .as_str()
                    .ok_or_else(|| PlatformError::Worker("file tree path is invalid".to_owned()))?;
                pending_directories.push(root.join(path));
            }
            entries.push(entry);
        }
    }
    Ok(entries)
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::{read_directory_entries, read_search_entries};

    fn test_root(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "code-agent-project-tree-{name}-{}",
            std::process::id()
        ))
    }

    #[tokio::test]
    async fn directory_entries_should_return_only_direct_children() {
        let root = test_root("one-level");
        fs::create_dir_all(root.join("src/nested")).expect("nested directory");
        fs::write(root.join("README.md"), "readme").expect("root file");
        fs::write(root.join("src/lib.rs"), "lib").expect("nested file");

        let entries = read_directory_entries(&root, &root)
            .await
            .expect("root entries");

        assert_eq!(
            entries,
            vec![
                serde_json::json!({ "path": "README.md", "type": "file" }),
                serde_json::json!({ "path": "src", "type": "directory" }),
            ]
        );
        fs::remove_dir_all(root).expect("remove root");
    }

    #[tokio::test]
    async fn search_entries_should_skip_generated_directories() {
        let root = test_root("ignored");
        fs::create_dir_all(root.join("src")).expect("source directory");
        fs::create_dir_all(root.join("node_modules/package")).expect("dependency directory");
        fs::create_dir_all(root.join("target/debug")).expect("target directory");
        fs::create_dir_all(root.join("generated/kept")).expect("generated directory");
        fs::write(root.join("src/lib.rs"), "lib").expect("source file");
        fs::write(root.join("node_modules/package/index.js"), "dependency")
            .expect("dependency file");
        fs::write(root.join("target/debug/app"), "binary").expect("target file");
        fs::write(root.join("generated/dropped.txt"), "generated").expect("ignored file");
        fs::write(root.join("generated/kept/source.txt"), "kept").expect("kept file");
        fs::write(root.join(".gitignore"), "generated/*\n!generated/kept/\n")
            .expect("ignore rules");

        let entries = read_search_entries(&root).await.expect("search entries");

        assert_eq!(
            entries,
            vec![
                serde_json::json!({ "path": ".gitignore", "type": "file" }),
                serde_json::json!({ "path": "generated", "type": "directory" }),
                serde_json::json!({ "path": "src", "type": "directory" }),
                serde_json::json!({ "path": "src/lib.rs", "type": "file" }),
                serde_json::json!({ "path": "generated/kept", "type": "directory" }),
                serde_json::json!({ "path": "generated/kept/source.txt", "type": "file" }),
            ]
        );
        fs::remove_dir_all(root).expect("remove root");
    }
}
