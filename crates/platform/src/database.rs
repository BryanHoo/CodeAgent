use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, mpsc},
    thread,
    time::Duration,
};

use rusqlite::{Connection, OptionalExtension, params};
use thiserror::Error;
use tokio::sync::oneshot;

use crate::migrations::MIGRATIONS;

type DatabaseJob =
    Box<dyn for<'connection> FnOnce(Result<&'connection mut Connection, PlatformError>) + Send>;

#[derive(Clone, Debug)]
pub struct DatabaseOptions {
    pub path: PathBuf,
    pub queue_capacity: usize,
    pub request_timeout: Duration,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DatabaseDiagnostics {
    pub foreign_key_check: bool,
    pub foreign_keys: bool,
    pub integrity_check: String,
    pub journal_mode: String,
    pub migration_version: i64,
}

#[derive(Debug, Error)]
pub enum PlatformError {
    #[error("operation was cancelled")]
    Cancelled,
    #[error("database is closed")]
    Closed,
    #[error("database request timed out")]
    Timeout,
    #[error("database worker failed: {0}")]
    Worker(String),
    #[error("invalid database options: {0}")]
    InvalidOptions(String),
    #[error("database operation failed: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("serialization failed: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("filesystem operation failed: {0}")]
    Io(#[from] std::io::Error),
}

struct DatabaseInner {
    join: Mutex<Option<thread::JoinHandle<()>>>,
    request_timeout: Duration,
    sender: Mutex<Option<mpsc::SyncSender<DatabaseJob>>>,
}

impl Drop for DatabaseInner {
    fn drop(&mut self) {
        // 最后一个数据库句柄释放时先断开队列，再等待唯一 owner thread 退出。
        if let Ok(sender) = self.sender.get_mut() {
            sender.take();
        }
        if let Ok(join) = self.join.get_mut()
            && let Some(join) = join.take()
        {
            let _ = join.join();
        }
    }
}

#[derive(Clone)]
pub struct PlatformDatabase {
    inner: Arc<DatabaseInner>,
}

impl PlatformDatabase {
    pub async fn open(options: DatabaseOptions) -> Result<Self, PlatformError> {
        let database = Self::open_deferred(options)?;
        database.call(|_| Ok(())).await?;
        Ok(database)
    }

    pub fn open_deferred(options: DatabaseOptions) -> Result<Self, PlatformError> {
        if !options.path.is_absolute() {
            return Err(PlatformError::InvalidOptions(
                "path must be absolute".to_owned(),
            ));
        }
        if options.queue_capacity == 0 || options.request_timeout.is_zero() {
            return Err(PlatformError::InvalidOptions(
                "queue capacity and timeout must be positive".to_owned(),
            ));
        }

        let (sender, receiver) = mpsc::sync_channel::<DatabaseJob>(options.queue_capacity);
        let path = options.path.clone();
        let join = thread::Builder::new()
            .name("code-agent-sqlite".to_owned())
            .spawn(move || run_database_worker(&path, receiver))?;

        Ok(Self {
            inner: Arc::new(DatabaseInner {
                join: Mutex::new(Some(join)),
                request_timeout: options.request_timeout,
                sender: Mutex::new(Some(sender)),
            }),
        })
    }

    pub async fn diagnose(&self) -> Result<DatabaseDiagnostics, PlatformError> {
        self.call(|connection| {
            let journal_mode = connection.query_row("PRAGMA journal_mode", [], |row| row.get(0))?;
            let foreign_keys =
                connection.query_row("PRAGMA foreign_keys", [], |row| row.get::<_, i64>(0))? == 1;
            let integrity_check =
                connection.query_row("PRAGMA integrity_check", [], |row| row.get(0))?;
            let foreign_key_violation = connection
                .query_row("PRAGMA foreign_key_check", [], |_| Ok(()))
                .optional()?
                .is_some();
            let migration_version = connection.query_row(
                "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
                [],
                |row| row.get(0),
            )?;
            Ok(DatabaseDiagnostics {
                foreign_key_check: !foreign_key_violation,
                foreign_keys,
                integrity_check,
                journal_mode,
                migration_version,
            })
        })
        .await
    }

    pub fn close(&self) -> Result<(), PlatformError> {
        let sender = self
            .inner
            .sender
            .lock()
            .map_err(|_| PlatformError::Worker("database sender lock poisoned".to_owned()))?
            .take();
        drop(sender);
        let join = self
            .inner
            .join
            .lock()
            .map_err(|_| PlatformError::Worker("database join lock poisoned".to_owned()))?
            .take();
        if let Some(join) = join {
            join.join()
                .map_err(|_| PlatformError::Worker("database thread panicked".to_owned()))?;
        }
        Ok(())
    }

    pub(crate) async fn call<T, F>(&self, operation: F) -> Result<T, PlatformError>
    where
        T: Send + 'static,
        F: FnOnce(&mut Connection) -> Result<T, PlatformError> + Send + 'static,
    {
        // SQLite 仍由唯一 owner thread 串行执行，oneshot 只异步唤醒调用方，不占用 Tokio worker。
        let (response_sender, response_receiver) = oneshot::channel();
        let job = Box::new(move |connection: Result<&mut Connection, PlatformError>| {
            let _ = response_sender.send(connection.and_then(operation));
        });
        let sender = self
            .inner
            .sender
            .lock()
            .map_err(|_| PlatformError::Worker("database sender lock poisoned".to_owned()))?
            .clone()
            .ok_or(PlatformError::Closed)?;
        sender.try_send(job).map_err(|error| match error {
            mpsc::TrySendError::Full(_) => {
                PlatformError::Worker("database queue is full".to_owned())
            }
            mpsc::TrySendError::Disconnected(_) => PlatformError::Closed,
        })?;
        tokio::time::timeout(self.inner.request_timeout, response_receiver)
            .await
            .map_err(|_| PlatformError::Timeout)?
            .map_err(|_| PlatformError::Worker("database worker dropped response".to_owned()))?
    }
}

fn run_database_worker(path: &Path, receiver: mpsc::Receiver<DatabaseJob>) {
    match open_connection(path) {
        Ok(mut connection) => {
            while let Ok(job) = receiver.recv() {
                job(Ok(&mut connection));
            }
        }
        Err(error) => {
            let message = error.to_string();
            // 初始化失败后仍消费有界队列，让每个请求立即得到同一可诊断错误。
            while let Ok(job) = receiver.recv() {
                job(Err(PlatformError::Worker(message.clone())));
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

#[cfg(test)]
mod tests {
    use std::{
        fs,
        sync::{
            Arc,
            atomic::{AtomicBool, Ordering},
        },
        time::Duration,
    };

    use super::{DatabaseOptions, PlatformDatabase};

    #[tokio::test(flavor = "current_thread")]
    async fn database_call_should_not_block_tokio_worker() {
        let directory = std::env::temp_dir().join(format!(
            "code-agent-platform-async-call-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system clock must follow unix epoch")
                .as_nanos()
        ));
        fs::create_dir_all(&directory).expect("temporary database directory must be created");
        let database = PlatformDatabase::open_deferred(DatabaseOptions {
            path: directory.join("state.sqlite3"),
            queue_capacity: 4,
            request_timeout: Duration::from_secs(2),
        })
        .expect("database must open");
        let timer_fired = Arc::new(AtomicBool::new(false));

        let database_operation = async {
            database
                .call(|_| {
                    std::thread::sleep(Duration::from_millis(100));
                    Ok(())
                })
                .await
                .expect("database operation must succeed");
            assert!(
                timer_fired.load(Ordering::Acquire),
                "Tokio timer must run while the database owner thread is busy"
            );
        };
        let timer = async {
            tokio::time::sleep(Duration::from_millis(10)).await;
            timer_fired.store(true, Ordering::Release);
        };

        tokio::join!(database_operation, timer);
        database.close().expect("database must close cleanly");
        fs::remove_dir_all(directory).expect("temporary database directory must be removed");
    }
}
