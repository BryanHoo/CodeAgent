use std::{fs, time::SystemTime};

use super::{git_diff::add_diffs, git_read::GitChange};

#[tokio::test]
async fn add_diffs_should_include_untracked_text_file_additions() {
    let unique = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let root = std::env::temp_dir().join(format!("codeagent-git-diff-{unique}"));
    fs::create_dir_all(&root).unwrap();
    fs::write(root.join("new.txt"), "first\nsecond\nthird\n").unwrap();
    let mut changes = vec![GitChange {
        diff: String::new(),
        kind: "create",
        path: "new.txt".to_owned(),
        original_path: None,
    }];

    add_diffs(&root, &mut changes, false).await.unwrap();
    let addition_count = changes[0]
        .diff
        .lines()
        .filter(|line| line.starts_with('+') && !line.starts_with("+++"))
        .count();
    fs::remove_dir_all(root).unwrap();

    assert_eq!(addition_count, 3);
}
