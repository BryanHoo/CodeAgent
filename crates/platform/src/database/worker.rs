use std::{
    fs,
    path::Path,
    sync::{Arc, Mutex, mpsc},
    time::Duration,
};

use rusqlite::{Connection, InterruptHandle, OptionalExtension, params};

use crate::migrations::MIGRATIONS;

use super::{DatabaseJob, PlatformError};

pub(super) fn run_database_worker(
    path: &Path,
    receiver: mpsc::Receiver<DatabaseJob>,
    interrupt: Arc<Mutex<Option<InterruptHandle>>>,
) {
    match open_connection(path) {
        Ok(mut connection) => {
            if let Ok(mut slot) = interrupt.lock() {
                *slot = Some(connection.get_interrupt_handle());
            }
            while let Ok(job) = receiver.recv() {
                if job.is_expired() {
                    continue;
                }
                (job.run)(Ok(&mut connection));
            }
        }
        Err(error) => {
            let message = error.to_string();
            // 初始化失败后仍消费有界队列，让每个请求立即得到同一可诊断错误。
            while let Ok(job) = receiver.recv() {
                if job.is_expired() {
                    continue;
                }
                (job.run)(Err(PlatformError::Worker(message.clone())));
            }
        }
    }
}

fn open_connection(path: &Path) -> Result<Connection, PlatformError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let existed = path.metadata().is_ok_and(|metadata| metadata.len() > 0);
    let mut connection = Connection::open(path)?;
    connection.busy_timeout(Duration::from_millis(5_000))?;
    connection.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA foreign_keys = ON;
         PRAGMA synchronous = NORMAL;",
    )?;
    if existed {
        backup_before_migration(&connection, path)?;
    }
    run_migrations(&mut connection)?;
    verify_integrity(&connection)?;
    Ok(connection)
}

fn backup_before_migration(connection: &Connection, path: &Path) -> Result<(), PlatformError> {
    let migration_version = MIGRATIONS.last().map_or(0, |migration| migration.version);
    // 每个目标 Schema 使用独立备份，避免旧备份让后续破坏性迁移失去恢复点。
    let backup_path = path.with_extension(format!("sqlite3.pre-rust-v{migration_version}.bak"));
    if !backup_path.exists() {
        connection.backup("main", backup_path, None)?;
    }
    Ok(())
}

fn run_migrations(connection: &mut Connection) -> Result<(), PlatformError> {
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
           version INTEGER PRIMARY KEY,
           name TEXT NOT NULL,
           applied_at TEXT NOT NULL
         ) STRICT;",
    )?;
    for migration in MIGRATIONS {
        let applied = connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = ?1)",
            [migration.version],
            |row| row.get::<_, bool>(0),
        )?;
        if applied {
            continue;
        }
        let transaction = connection.transaction()?;
        transaction.execute_batch(migration.sql)?;
        transaction.execute(
            "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?1, ?2, ?3)",
            params![
                migration.version,
                migration.name,
                "1970-01-01T00:00:00.000Z"
            ],
        )?;
        transaction.commit()?;
    }
    Ok(())
}

fn verify_integrity(connection: &Connection) -> Result<(), PlatformError> {
    let integrity: String = connection.query_row("PRAGMA integrity_check", [], |row| row.get(0))?;
    if integrity != "ok" {
        return Err(PlatformError::Worker(format!(
            "integrity check failed: {integrity}"
        )));
    }
    let violation = connection
        .query_row("PRAGMA foreign_key_check", [], |_| Ok(()))
        .optional()?
        .is_some();
    if violation {
        return Err(PlatformError::Worker("foreign key check failed".to_owned()));
    }
    Ok(())
}
