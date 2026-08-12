use std::{fs, path::PathBuf, time::Duration};

use chrono::{TimeZone, Utc};
use code_agent_core::{PortRequestContext, RepositoryPort};
use code_agent_platform::{DatabaseOptions, PlatformDatabase, SqliteRepository};

fn temporary_database_path() -> PathBuf {
    let directory = std::env::temp_dir().join(format!(
        "code-agent-projects-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock must follow unix epoch")
            .as_nanos()
    ));
    fs::create_dir_all(&directory).expect("temporary database directory must be created");
    directory.join("state.sqlite3")
}

#[tokio::test(flavor = "current_thread")]
async fn repository_should_preserve_project_order_and_hide_temporary_projects() {
    let path = temporary_database_path();
    let database = PlatformDatabase::open(DatabaseOptions {
        path: path.clone(),
        queue_capacity: 8,
        request_timeout: Duration::from_secs(2),
    })
    .expect("database must open");
    let repository = SqliteRepository::new(database.clone());
    let context = PortRequestContext::new("projects-test");
    let created_at = Utc
        .with_ymd_and_hms(2026, 8, 12, 0, 0, 0)
        .single()
        .expect("timestamp must be valid");

    let alpha = repository
        .register_project("/workspace/alpha", "Alpha", created_at, &context)
        .await
        .expect("alpha must register");
    let beta = repository
        .register_project("/workspace/beta", "Beta", created_at, &context)
        .await
        .expect("beta must register");
    repository
        .ensure_temporary_project("/workspace/temp", created_at, &context)
        .await
        .expect("temporary project must register");

    let initial = repository
        .list_projects(&context)
        .await
        .expect("projects must list");
    assert_eq!(
        initial
            .iter()
            .map(|project| project.name.as_str())
            .collect::<Vec<_>>(),
        ["Alpha", "Beta"]
    );

    let reordered = repository
        .reorder_projects(&[beta.id.clone(), alpha.id.clone()], &context)
        .await
        .expect("complete project order must apply");
    assert_eq!(
        reordered
            .iter()
            .map(|project| project.name.as_str())
            .collect::<Vec<_>>(),
        ["Beta", "Alpha"]
    );
    assert!(
        repository
            .reorder_projects(std::slice::from_ref(&alpha.id), &context)
            .await
            .is_err()
    );

    repository
        .remove_project(&beta.id, &context)
        .await
        .expect("user project must be removed");
    let remaining = repository
        .list_projects(&context)
        .await
        .expect("projects must list");
    assert_eq!(remaining.len(), 1);

    database.close().expect("database must close");
    fs::remove_dir_all(path.parent().expect("database path must have parent"))
        .expect("temporary database directory must be removed");
}
