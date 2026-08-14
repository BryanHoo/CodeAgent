use std::{fs, process::Command};

use std::time::Duration;

use chrono::{TimeZone, Utc};
use code_agent_core::{GitPort, PortRequestContext, RepositoryPort};
use code_agent_platform::{
    DatabaseOptions, GitCliService, PlatformDatabase, ProcessEnvironment, SqliteRepository,
};
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
    let service = GitCliService::new(database.clone(), current_process_environment());
    let context = PortRequestContext::new("git-test");

    fs::write(repository.join("tracked.txt"), "changed\n").expect("change");
    let status = service.status(&project_id, &context).await.expect("status");
    assert_eq!(status["branch"], "main");
    assert_eq!(status["unstaged"][0]["path"], "tracked.txt");
    let snapshot = status["snapshot"].as_str().expect("snapshot").to_owned();

    let invalid_branch_error = service
        .create_branch(&project_id, "bad..branch", &snapshot, &context)
        .await
        .expect_err("invalid branch must fail");
    assert!(
        invalid_branch_error.message().contains("bad..branch"),
        "message: {}",
        invalid_branch_error.message()
    );

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

    let missing_remote = root.join("missing-remote.git");
    run_git(
        &repository,
        &["remote", "add", "origin", &missing_remote.to_string_lossy()],
    );
    run_git(&repository, &["config", "branch.feature.remote", "origin"]);
    run_git(
        &repository,
        &["config", "branch.feature.merge", "refs/heads/feature"],
    );
    run_git(
        &repository,
        &["update-ref", "refs/remotes/origin/feature", "HEAD"],
    );
    fs::write(repository.join("tracked.txt"), "push failure\n").expect("push failure change");
    let status = service
        .status(&project_id, &context)
        .await
        .expect("push status");
    let result = service
        .commit(
            &project_id,
            &json!({
                "action": "commit_and_push",
                "expectedSnapshot": status["snapshot"],
                "message": "preserve push failure",
                "paths": ["tracked.txt"]
            }),
            &context,
        )
        .await
        .expect("commit with failed push");
    assert_eq!(result["pushStatus"], "failed");
    assert_eq!(result["pushError"]["code"], "provider_failure");
    assert!(
        result["pushError"]["message"]
            .as_str()
            .expect("push error message")
            .contains("missing-remote.git")
    );

    database.close().expect("close database");
    fs::remove_dir_all(root).expect("remove root");
}

#[tokio::test]
async fn git_service_aggregates_and_operates_on_immediate_child_repositories() {
    let root = std::env::temp_dir().join(format!(
        "code-agent-child-git-{}-{}",
        std::process::id(),
        std::thread::current().name().unwrap_or("test")
    ));
    let database_path = root.join("state.sqlite3");
    let project_root = root.join("project");
    let backend = project_root.join("backend");
    let frontend = project_root.join("frontend");
    let nested = project_root.join("workspace").join("nested");
    for repository in [&backend, &frontend, &nested] {
        fs::create_dir_all(repository).expect("repository");
        run_git(repository, &["init", "-b", "main"]);
        run_git(repository, &["config", "user.email", "test@example.com"]);
        run_git(repository, &["config", "user.name", "Test User"]);
        fs::write(repository.join("tracked.txt"), "initial\n").expect("tracked");
        run_git(repository, &["add", "tracked.txt"]);
        run_git(repository, &["commit", "-m", "initial"]);
    }

    let database = PlatformDatabase::open(DatabaseOptions {
        path: database_path,
        queue_capacity: 8,
        request_timeout: Duration::from_secs(2),
    })
    .expect("database");
    let registry = SqliteRepository::new(database.clone());
    let project = registry
        .register_project(
            &project_root.to_string_lossy(),
            "Project",
            Utc.with_ymd_and_hms(2026, 8, 13, 0, 0, 0)
                .single()
                .expect("timestamp"),
            &PortRequestContext::new("register-children"),
        )
        .await
        .expect("project row");
    let service = GitCliService::new(database.clone(), current_process_environment());
    let context = PortRequestContext::new("child-git-test");

    fs::write(backend.join("tracked.txt"), "backend changed\n").expect("backend change");
    fs::write(frontend.join("new.txt"), "frontend new\n").expect("frontend change");
    fs::write(nested.join("tracked.txt"), "nested changed\n").expect("nested change");

    let aggregate = service
        .status(&project.id, &context)
        .await
        .expect("aggregate status");
    assert_eq!(aggregate["repositoryMode"], "children");
    assert_eq!(aggregate["branch"], json!(null));
    assert_eq!(aggregate["branches"], json!([]));
    assert_eq!(aggregate["unstaged"][0]["path"], "backend/tracked.txt");
    assert_eq!(aggregate["unstaged"][1]["path"], "frontend/new.txt");
    assert_eq!(aggregate["unstaged"].as_array().expect("changes").len(), 2);

    let default_history = service
        .history(&project.id, &json!({}), &context)
        .await
        .expect("default child history");
    assert_eq!(default_history["repository"], "backend");
    let history = service
        .history(&project.id, &json!({ "repository": "frontend" }), &context)
        .await
        .expect("frontend history");
    assert_eq!(history["repositoryMode"], "children");
    assert_eq!(history["repositories"], json!(["backend", "frontend"]));
    assert_eq!(history["repository"], "frontend");
    assert_eq!(history["commits"][0]["title"], "initial");
    let initial_sha = history["commits"][0]["sha"].as_str().expect("initial sha");

    let files = service
        .commit_files(
            &project.id,
            &json!({ "repository": "frontend", "sha": initial_sha }),
            &context,
        )
        .await
        .expect("commit files");
    assert_eq!(files["files"][0]["path"], "tracked.txt");
    let diff = service
        .commit_diff(
            &project.id,
            &json!({ "path": "tracked.txt", "repository": "frontend", "sha": initial_sha }),
            &context,
        )
        .await
        .expect("commit diff");
    assert!(diff["diff"].as_str().expect("diff").contains("+initial"));
    assert!(
        service
            .history(
                &project.id,
                &json!({ "repository": "workspace/nested" }),
                &context,
            )
            .await
            .is_err()
    );
    assert!(
        service
            .status_for(&project.id, Some("workspace/nested"), &context)
            .await
            .is_err()
    );

    let selected = service
        .status_for(&project.id, Some("frontend"), &context)
        .await
        .expect("selected status");
    assert_eq!(selected["repositoryMode"], "root");
    service
        .commit(
            &project.id,
            &json!({
                "action": "commit",
                "expectedSnapshot": selected["snapshot"],
                "message": "add frontend file",
                "paths": ["new.txt"],
                "repository": "frontend"
            }),
            &context,
        )
        .await
        .expect("frontend commit");
    assert_eq!(
        run_git_output(&frontend, &["show", "--format=", "--name-only", "HEAD"]),
        "new.txt"
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

fn current_process_environment() -> ProcessEnvironment {
    ProcessEnvironment::capture_with_path(std::env::var_os("PATH").unwrap_or_default())
}
