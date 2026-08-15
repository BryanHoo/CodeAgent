use std::{fs, path::PathBuf, time::Duration};

use code_agent_platform::{DatabaseOptions, PlatformDatabase, PlatformError};

fn temporary_database_path(name: &str) -> PathBuf {
    let directory = std::env::temp_dir().join(format!(
        "code-agent-platform-{name}-{}-{}",
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
async fn database_should_configure_and_migrate_on_dedicated_thread() {
    let path = temporary_database_path("migrate");
    let database = PlatformDatabase::open_deferred(DatabaseOptions {
        path: path.clone(),
        queue_capacity: 4,
        request_timeout: Duration::from_secs(2),
    })
    .expect("database must open");

    let diagnostics = database.diagnose().await.expect("diagnostics must succeed");

    assert_eq!(diagnostics.migration_version, 13);
    assert_eq!(diagnostics.journal_mode, "wal");
    assert!(diagnostics.foreign_keys);
    assert_eq!(diagnostics.integrity_check, "ok");
    assert!(diagnostics.foreign_key_check);
    database.close().expect("database must close cleanly");
    assert!(database.diagnose().await.is_err());

    fs::remove_dir_all(path.parent().expect("database must have parent"))
        .expect("temporary database directory must be removed");
}

#[tokio::test(flavor = "current_thread")]
async fn database_should_backup_existing_state_before_migration() {
    let path = temporary_database_path("backup");
    {
        let connection = rusqlite::Connection::open(&path).expect("legacy database must open");
        connection
            .execute_batch(
                "CREATE TABLE legacy_marker (value TEXT NOT NULL) STRICT;
                 INSERT INTO legacy_marker (value) VALUES ('preserve-me');",
            )
            .expect("legacy database must be initialized");
    }

    let database = PlatformDatabase::open(DatabaseOptions {
        path: path.clone(),
        queue_capacity: 4,
        request_timeout: Duration::from_secs(2),
    })
    .await
    .expect("database must open");
    database.close().expect("database must close cleanly");

    let backup_path = path.with_extension("sqlite3.pre-rust-v13.bak");
    let backup = rusqlite::Connection::open(&backup_path).expect("backup database must exist");
    let marker: String = backup
        .query_row("SELECT value FROM legacy_marker", [], |row| row.get(0))
        .expect("backup must preserve legacy rows");
    assert_eq!(marker, "preserve-me");

    fs::remove_dir_all(path.parent().expect("database must have parent"))
        .expect("temporary database directory must be removed");
}

#[tokio::test(flavor = "current_thread")]
async fn deferred_database_should_report_worker_initialization_failure_on_first_request() {
    let path = temporary_database_path("deferred-failure");
    let directory = path
        .parent()
        .expect("database path must have parent")
        .to_path_buf();

    let database = PlatformDatabase::open_deferred(DatabaseOptions {
        path: directory.clone(),
        queue_capacity: 4,
        request_timeout: Duration::from_secs(2),
    })
    .expect("deferred open must return before worker initialization");

    let error = database
        .diagnose()
        .await
        .expect_err("first request must receive the worker initialization failure");
    assert!(matches!(error, PlatformError::Worker(_)));
    database
        .close()
        .expect("failed database must close cleanly");

    fs::remove_dir_all(directory).expect("temporary database directory must be removed");
}
