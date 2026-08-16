use std::{
    path::PathBuf,
    sync::{Arc, Mutex, mpsc},
    thread,
    time::{Duration, Instant},
};

use rusqlite::{Connection, InterruptHandle, OptionalExtension};
use thiserror::Error;
use tokio::sync::oneshot;

mod job;
mod worker;

use job::{DatabaseJob, run_database_job};
use worker::run_database_worker;

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
    interrupt: Arc<Mutex<Option<InterruptHandle>>>,
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
        let interrupt = Arc::new(Mutex::new(None));
        let interrupt_for_worker = Arc::clone(&interrupt);
        let join = thread::Builder::new()
            .name("code-agent-sqlite".to_owned())
            .spawn(move || run_database_worker(&path, receiver, interrupt_for_worker))?;

        Ok(Self {
            inner: Arc::new(DatabaseInner {
                interrupt,
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
        let deadline = Instant::now() + self.inner.request_timeout;
        let (response_sender, response_receiver) = oneshot::channel();
        let job = DatabaseJob {
            deadline,
            run: Box::new(move |connection: Result<&mut Connection, PlatformError>| {
                run_database_job(connection, deadline, response_sender, operation);
            }),
        };
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
        tokio::time::timeout_at(
            tokio::time::Instant::from_std(deadline),
            response_receiver,
        )
        .await
        .map_err(|_| {
            if let Ok(interrupt) = self.inner.interrupt.lock()
                && let Some(interrupt) = interrupt.as_ref()
            {
                interrupt.interrupt();
            }
            PlatformError::Timeout
        })?
        .map_err(|_| PlatformError::Worker("database worker dropped response".to_owned()))?
    }
}

#[cfg(test)]
mod tests;
