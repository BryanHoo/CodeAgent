use std::{fs, process::Command};

use std::time::Duration;

use chrono::{TimeZone, Utc};
use code_agent_core::{GitPort, PortRequestContext, RepositoryPort};
use code_agent_platform::{DatabaseOptions, GitCliService, PlatformDatabase, SqliteRepository};
use serde_json::json;

#[tokio::test]
async fn git_service_reads_and_mutates_only_registered_repository() {
    let root = std::env::temp_dir().join(format!("code-agent-git-{}", std::process::id()));
    let database_path = root.join("state.sqlite3");
    let repository = root.join("repository");
    fs::create_dir_all(&repository).expect("repository");
    run_git(&repository, &["init", "-b", "main"]);
    run_git(&repository, &["config", "user.email", "test@example.com"]);
    run_git(&repository, &["config", "user.name", "Test User"]);
    fs::write(repository.join("tracked.txt"), "initial\n").expect("tracked");
    run_git(&repository, &["add", "tracked.txt"]);
    run_git(&repository, &["commit", "-m", "initial"]);

    let database = PlatformDatabase::open(DatabaseOptions {
        path: database_path,
        queue_capacity: 8,
        request_timeout: Duration::from_secs(2),
    })
    .expect("database");
    let registry = SqliteRepository::new(database.clone());
    let project = registry
        .register_project(
            &repository.to_string_lossy(),
            "Project",
            Utc.with_ymd_and_hms(2026, 8, 12, 0, 0, 0)
                .single()
                .expect("timestamp"),
            &PortRequestContext::new("register"),
        )
        .await
        .expect("project row");
    let project_id = project.id;
    let service = GitCliService::new(database.clone());
    let context = PortRequestContext::new("git-test");

    fs::write(repository.join("tracked.txt"), "changed\n").expect("change");
    let status = service.status(&project_id, &context).await.expect("status");
    assert_eq!(status["branch"], "main");
    assert_eq!(status["unstaged"][0]["path"], "tracked.txt");
    let snapshot = status["snapshot"].as_str().expect("snapshot").to_owned();

    service
        .create_branch(&project_id, "feature", &snapshot, &context)
        .await
        .expect("branch");
    let status = service
        .commit(
            &project_id,
            &json!({
                "action": "commit",
                "expectedSnapshot": service.status(&project_id, &context).await.expect("branch status")["snapshot"],
                "message": "update tracked file",
                "paths": ["tracked.txt"]
            }),
            &context,
        )
        .await
        .expect("commit");
    assert_eq!(status["message"], "update tracked file");
    let history = service
        .history(&project_id, &json!({}), &context)
        .await
        .expect("history");
    assert_eq!(history["commits"][0]["title"], "update tracked file");

    fs::write(repository.join("untracked.txt"), "new file\n").expect("untracked file");
    let status = service.status(&project_id, &context).await.expect("status");
    service
        .commit(
            &project_id,
            &json!({
                "action": "commit",
                "expectedSnapshot": status["snapshot"],
                "message": "add untracked file",
                "paths": ["untracked.txt"]
            }),
            &context,
        )
        .await
        .expect("commit untracked file");
    assert_eq!(
        run_git_output(&repository, &["show", "--format=", "--name-only", "HEAD"]),
        "untracked.txt"
    );

    database.close().expect("close database");
    fs::remove_dir_all(root).expect("remove root");
}

fn run_git_output(root: &std::path::Path, arguments: &[&str]) -> String {
    let output = Command::new("git")
        .current_dir(root)
        .args(arguments)
        .output()
        .expect("git command");
    assert!(output.status.success(), "git command failed: {arguments:?}");
    String::from_utf8(output.stdout)
        .expect("git output")
        .trim()
        .to_owned()
}

fn run_git(root: &std::path::Path, arguments: &[&str]) {
    let status = Command::new("git")
        .current_dir(root)
        .args(arguments)
        .status()
        .expect("git command");
    assert!(status.success(), "git command failed: {arguments:?}");
}
