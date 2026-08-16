use std::time::Instant;

use rusqlite::{Connection, ErrorCode};
use tokio::sync::oneshot;

use super::PlatformError;

pub(super) struct DatabaseJob {
    pub deadline: Instant,
    pub run: Box<dyn FnOnce(Result<&mut Connection, PlatformError>) + Send>,
}

impl DatabaseJob {
    pub fn is_expired(&self) -> bool {
        Instant::now() >= self.deadline
    }
}

pub(super) fn run_database_job<T, F>(
    connection: Result<&mut Connection, PlatformError>,
    deadline: Instant,
    response_sender: oneshot::Sender<Result<T, PlatformError>>,
    operation: F,
) where
    T: Send + 'static,
    F: FnOnce(&mut Connection) -> Result<T, PlatformError>,
{
    if job_is_cancelled(&response_sender, deadline) {
        return;
    }

    let Ok(connection) = connection else {
        if !job_is_cancelled(&response_sender, deadline) {
            let _ = response_sender.send(connection.map(|_| unreachable!()));
        }
        return;
    };

    clear_stale_sqlite_interrupt(connection);

    let result = operation(connection).map_err(map_interrupted_sqlite_error);

    if !job_is_cancelled(&response_sender, deadline) {
        let _ = response_sender.send(result);
    }
}

fn job_is_cancelled<T>(response_sender: &oneshot::Sender<T>, deadline: Instant) -> bool {
    response_sender.is_closed() || Instant::now() >= deadline
}

fn map_interrupted_sqlite_error(error: PlatformError) -> PlatformError {
    match error {
        PlatformError::Sqlite(error)
            if error.sqlite_error_code() == Some(ErrorCode::OperationInterrupted) =>
        {
            PlatformError::Cancelled
        }
        other => other,
    }
}

fn clear_stale_sqlite_interrupt(connection: &Connection) {
    if !connection.is_interrupted() {
        return;
    }
    let _ = connection.query_row("SELECT 1", [], |_| Ok(()));
}
