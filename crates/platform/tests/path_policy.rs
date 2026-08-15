use std::fs;

use code_agent_platform::CanonicalPathPolicy;

#[tokio::test]
async fn policy_should_reject_traversal_and_symlinks() {
    let root = std::env::temp_dir().join(format!("code-agent-policy-{}", std::process::id()));
    let outside = root.with_extension("outside");
    fs::create_dir_all(&root).expect("root");
    fs::write(root.join("inside.txt"), "ok").expect("inside");
    fs::write(&outside, "outside").expect("outside");
    #[cfg(unix)]
    std::os::unix::fs::symlink(&outside, root.join("link.txt")).expect("symlink");
    let policy = CanonicalPathPolicy::new(&root).await.expect("policy");
    assert!(policy.resolve_relative("inside.txt").await.is_ok());
    assert!(policy.resolve_relative("../outside").await.is_err());
    #[cfg(unix)]
    assert!(policy.resolve_relative("link.txt").await.is_err());
    fs::remove_dir_all(root).expect("remove root");
    fs::remove_file(outside).expect("remove outside");
}
