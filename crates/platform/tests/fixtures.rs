use std::{fs, path::PathBuf, time::Duration};

use code_agent_platform::{DatabaseOptions, PlatformDatabase};
use rusqlite::{Connection, params};

const MIGRATIONS: &[(&str, &str)] = &[
    (
        "create_local_state",
        include_str!("../migrations/001_create_local_state.sql"),
    ),
    (
        "create_task_metadata",
        include_str!("../migrations/002_create_task_metadata.sql"),
    ),
    (
        "add_sandbox_mode_settings",
        include_str!("../migrations/003_add_sandbox_mode_settings.sql"),
    ),
    (
        "add_project_sort_order",
        include_str!("../migrations/004_add_project_sort_order.sql"),
    ),
    (
        "add_approvals_reviewer_setting",
        include_str!("../migrations/005_add_approvals_reviewer_setting.sql"),
    ),
    (
        "create_global_settings",
        include_str!("../migrations/006_create_global_settings.sql"),
    ),
    (
        "add_commit_message_settings",
        include_str!("../migrations/007_add_commit_message_settings.sql"),
    ),
    (
        "add_follow_up_behavior_setting",
        include_str!("../migrations/008_add_follow_up_behavior_setting.sql"),
    ),
    (
        "drop_task_metadata",
        include_str!("../migrations/009_drop_task_metadata.sql"),
    ),
    (
        "add_project_kind",
        include_str!("../migrations/010_add_project_kind.sql"),
    ),
    (
        "create_provider_connection",
        include_str!("../migrations/011_create_provider_connection.sql"),
    ),
];

fn fixture_path(version: usize) -> PathBuf {
    let directory = std::env::temp_dir().join(format!(
        "code-agent-platform-fixture-v{version}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock must follow unix epoch")
            .as_nanos()
    ));
    fs::create_dir_all(&directory).expect("fixture directory must be created");
    directory.join("state.sqlite3")
}

fn create_fixture(path: &PathBuf, version: usize) {
    let connection = Connection::open(path).expect("fixture database must open");
    connection
        .execute_batch(
            "PRAGMA foreign_keys = ON;
             CREATE TABLE schema_migrations (
               version INTEGER PRIMARY KEY,
               name TEXT NOT NULL,
               applied_at TEXT NOT NULL
             ) STRICT;",
        )
        .expect("migration table must be created");
    for (index, (name, sql)) in MIGRATIONS.iter().take(version).enumerate() {
        connection
            .execute_batch(sql)
            .expect("historical migration must apply");
        connection
            .execute(
                "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?1, ?2, ?3)",
                params![index + 1, name, "2026-01-01T00:00:00.000Z"],
            )
            .expect("historical migration version must be recorded");
        if index == 0 {
            connection
                .execute(
                    "INSERT INTO projects (id, name, root_path, created_at) VALUES (?1, ?2, ?3, ?4)",
                    params!["project-fixture", "Fixture", "/fixture", "2026-01-01T00:00:00.000Z"],
                )
                .expect("fixture project must be inserted");
        }
    }
}

#[test]
fn every_historical_database_should_upgrade_without_losing_rows() {
    for version in 1..=MIGRATIONS.len() {
        let path = fixture_path(version);
        create_fixture(&path, version);

        let database = PlatformDatabase::open(DatabaseOptions {
            path: path.clone(),
            queue_capacity: 4,
            request_timeout: Duration::from_secs(2),
        })
        .expect("historical fixture must upgrade");
        let diagnostics = database
            .diagnose()
            .expect("upgraded database must be healthy");
        assert_eq!(diagnostics.migration_version, 11);
        database.close().expect("upgraded database must close");

        let connection = Connection::open(&path).expect("upgraded database must reopen");
        let project_name: String = connection
            .query_row(
                "SELECT name FROM projects WHERE id = 'project-fixture'",
                [],
                |row| row.get(0),
            )
            .expect("fixture project must survive upgrade");
        assert_eq!(project_name, "Fixture");
        drop(connection);
        fs::remove_dir_all(path.parent().expect("fixture path must have parent"))
            .expect("fixture directory must be removed");
    }
}
