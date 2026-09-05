use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    time::SystemTime,
};

use super::{WorkspaceError, commit_changes, get_git_status};

struct Repository(PathBuf);

impl Repository {
    fn new() -> Self {
        let unique = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("codeagent-git-integrity-{unique}"));
        fs::create_dir(&root).unwrap();
        git(&root, &["init", "-b", "main"]);
        git(&root, &["config", "user.name", "CodeAgent Test"]);
        git(&root, &["config", "user.email", "test@example.com"]);
        fs::write(root.join("old.txt"), "baseline\n").unwrap();
        git(&root, &["add", "."]);
        git(&root, &["commit", "-m", "baseline"]);
        Self(fs::canonicalize(root).unwrap())
    }
}

impl Drop for Repository {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

fn git(root: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .args(args)
        .current_dir(root)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).unwrap().trim().to_owned()
}

#[tokio::test]
async fn selected_rename_should_remove_original_and_preserve_other_staged_files() {
    let repo = Repository::new();
    git(&repo.0, &["mv", "old.txt", "new name.txt"]);
    fs::write(repo.0.join("other.txt"), "unselected\n").unwrap();
    git(&repo.0, &["add", "other.txt"]);
    let status = get_git_status(&repo.0, None, false).await.unwrap();
    commit_changes(
        &repo.0,
        None,
        &["new name.txt".to_owned()],
        "fix(test): 提交重命名",
        "commit",
        &status.snapshot,
    )
    .await
    .unwrap();
    assert_eq!(
        git(&repo.0, &["ls-tree", "--name-only", "HEAD"]),
        "new name.txt"
    );
    assert_eq!(
        git(&repo.0, &["diff", "--cached", "--name-only"]),
        "other.txt"
    );
}

#[tokio::test]
async fn snapshot_should_reject_changed_content_with_unchanged_status() {
    for area in ["unstaged", "staged", "untracked"] {
        let repo = Repository::new();
        let path = if area == "untracked" {
            "new.txt"
        } else {
            "old.txt"
        };
        fs::write(repo.0.join(path), "version one\n").unwrap();
        if area == "staged" {
            git(&repo.0, &["add", path]);
        }
        let before = get_git_status(&repo.0, None, false).await.unwrap();
        let porcelain = git(&repo.0, &["status", "--porcelain"]);
        fs::write(repo.0.join(path), "version two\n").unwrap();
        if area == "staged" {
            git(&repo.0, &["add", path]);
        }
        assert_eq!(git(&repo.0, &["status", "--porcelain"]), porcelain);
        let result = commit_changes(
            &repo.0,
            None,
            &[path.to_owned()],
            "fix(test): 拒绝过期内容",
            "commit",
            &before.snapshot,
        )
        .await;
        assert!(
            matches!(result, Err(WorkspaceError::SnapshotMismatch)),
            "{area}: {result:?}"
        );
    }
}
