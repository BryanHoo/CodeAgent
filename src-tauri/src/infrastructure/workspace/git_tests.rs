use std::{fs, process::Command, time::SystemTime};

use super::{
    commit_changes, create_branch, get_commit_diff, get_commit_files, get_git_history,
    get_git_status, switch_branch,
};

#[tokio::test]
async fn git_reads_should_map_repository_state_and_history() {
    let unique = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let root = std::env::temp_dir().join(format!("codeagent-git-{unique}"));
    fs::create_dir_all(&root).unwrap();
    run(&root, &["init", "-b", "main"]);
    run(&root, &["config", "user.name", "CodeAgent Test"]);
    run(&root, &["config", "user.email", "test@example.com"]);
    fs::write(root.join("tracked.txt"), "first\n").unwrap();
    run(&root, &["add", "tracked.txt"]);
    run(&root, &["commit", "-m", "initial commit"]);
    let sha = output(&root, &["rev-parse", "HEAD"]);
    fs::write(root.join("tracked.txt"), "second\n").unwrap();
    fs::write(root.join("new.txt"), "new\n").unwrap();
    run(&root, &["add", "new.txt"]);
    let root = fs::canonicalize(root).unwrap();

    let status = get_git_status(&root, None, true).await.unwrap();
    assert_eq!(status.repository_mode, "root");
    assert_eq!(status.branch.as_deref(), Some("main"));
    assert_eq!(status.snapshot.len(), 64);
    assert_eq!(status.staged[0].path, "new.txt");
    assert_eq!(status.unstaged[0].path, "tracked.txt");

    let history = get_git_history(&root, None, None).await.unwrap();
    assert_eq!(history.commits[0].title, "initial commit");
    let files = get_commit_files(&root, None, &sha, None).await.unwrap();
    assert_eq!(files.files[0].path, "tracked.txt");
    let diff = get_commit_diff(&root, None, &sha, "tracked.txt")
        .await
        .unwrap();
    assert!(diff.diff.contains("first"));

    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn git_mutations_should_reject_stale_snapshots_and_commit_selected_paths() {
    let unique = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let root = std::env::temp_dir().join(format!("codeagent-git-write-{unique}"));
    fs::create_dir_all(&root).unwrap();
    run(&root, &["init", "-b", "main"]);
    run(&root, &["config", "user.name", "CodeAgent Test"]);
    run(&root, &["config", "user.email", "test@example.com"]);
    fs::write(root.join("tracked.txt"), "first\n").unwrap();
    run(&root, &["add", "tracked.txt"]);
    run(&root, &["commit", "-m", "initial commit"]);
    let root = fs::canonicalize(root).unwrap();

    let clean = get_git_status(&root, None, false).await.unwrap();
    create_branch(&root, None, "feature/test", &clean.snapshot)
        .await
        .unwrap();
    let feature = get_git_status(&root, None, false).await.unwrap();
    assert_eq!(feature.branch.as_deref(), Some("feature/test"));
    assert!(
        switch_branch(&root, None, "main", &clean.snapshot)
            .await
            .is_err()
    );

    fs::write(root.join("tracked.txt"), "second\n").unwrap();
    let changed = get_git_status(&root, None, false).await.unwrap();
    let committed = commit_changes(
        &root,
        None,
        &["tracked.txt".to_owned()],
        "fix(workspace): 更新测试文件",
        "commit",
        &changed.snapshot,
    )
    .await
    .unwrap();
    assert_eq!(committed.push_status, "not_requested");
    assert_eq!(committed.message, "fix(workspace): 更新测试文件");

    fs::remove_dir_all(root).unwrap();
}

fn run(root: &std::path::Path, args: &[&str]) {
    assert!(
        Command::new("git")
            .args(args)
            .current_dir(root)
            .status()
            .unwrap()
            .success()
    );
}

fn output(root: &std::path::Path, args: &[&str]) -> String {
    String::from_utf8(
        Command::new("git")
            .args(args)
            .current_dir(root)
            .output()
            .unwrap()
            .stdout,
    )
    .unwrap()
    .trim()
    .to_owned()
}
