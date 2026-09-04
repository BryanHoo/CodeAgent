use std::{
    io,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

use chrono::{DateTime, Utc};
use rrule::{RRuleSet, Tz};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::fs;

use crate::domain::scheduled_task::{ScheduledTask, ScheduledTaskSchedule};

pub const MAX_SCHEDULED_TASK_RUNS: usize = 20;
const MIN_RECURRENCE_MILLIS: i64 = 60_000;
const STORAGE_SCHEMA_VERSION: u32 = 1;
static TEMP_FILE_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Error)]
pub enum ScheduledTaskStoreError {
    #[error("invalid scheduled task data")]
    InvalidData,
    #[error("invalid scheduled task schedule")]
    InvalidSchedule,
    #[error(transparent)]
    Io(#[from] io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredScheduledTasks {
    schema_version: u32,
    tasks: Vec<ScheduledTask>,
}

pub fn validate_and_resolve_next_run(
    schedule: &ScheduledTaskSchedule,
    after_unix_ms: i64,
) -> Result<i64, ScheduledTaskStoreError> {
    match schedule {
        ScheduledTaskSchedule::Once { at_unix_ms } => (*at_unix_ms > after_unix_ms)
            .then_some(*at_unix_ms)
            .ok_or(ScheduledTaskStoreError::InvalidSchedule),
        ScheduledTaskSchedule::Rrule {
            rrule,
            start_at_unix_ms,
            timezone,
        } => {
            let set = parse_rrule(*start_at_unix_ms, timezone, rrule)?;
            let first_dates = set.clone().all(2).dates;
            if first_dates.len() > 1
                && first_dates[1].timestamp_millis() - first_dates[0].timestamp_millis()
                    < MIN_RECURRENCE_MILLIS
            {
                return Err(ScheduledTaskStoreError::InvalidSchedule);
            }
            let threshold = utc_datetime(after_unix_ms.saturating_add(1))?;
            set.after(threshold.with_timezone(&Tz::UTC))
                .all(1)
                .dates
                .first()
                .map(DateTime::timestamp_millis)
                .ok_or(ScheduledTaskStoreError::InvalidSchedule)
        }
    }
}

fn parse_rrule(
    start_at_unix_ms: i64,
    timezone: &str,
    rrule: &str,
) -> Result<RRuleSet, ScheduledTaskStoreError> {
    let timezone_value = timezone
        .parse::<chrono_tz::Tz>()
        .map_err(|_| ScheduledTaskStoreError::InvalidSchedule)?;
    let start = utc_datetime(start_at_unix_ms)?.with_timezone(&timezone_value);
    let normalized = rrule.trim().strip_prefix("RRULE:").unwrap_or(rrule.trim());
    if normalized.is_empty()
        || normalized.len() > 2_048
        || normalized.contains('\r')
        || normalized.contains('\n')
    {
        return Err(ScheduledTaskStoreError::InvalidSchedule);
    }
    let source = format!(
        "DTSTART;TZID={timezone}:{}\nRRULE:{normalized}",
        start.format("%Y%m%dT%H%M%S")
    );
    source
        .parse::<RRuleSet>()
        .map_err(|_| ScheduledTaskStoreError::InvalidSchedule)
}

fn utc_datetime(value: i64) -> Result<DateTime<Utc>, ScheduledTaskStoreError> {
    DateTime::from_timestamp_millis(value).ok_or(ScheduledTaskStoreError::InvalidSchedule)
}

pub async fn read_scheduled_tasks(
    app_data: &Path,
) -> Result<Vec<ScheduledTask>, ScheduledTaskStoreError> {
    let bytes = match fs::read(storage_path(app_data)).await {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.into()),
    };
    let stored: StoredScheduledTasks = serde_json::from_slice(&bytes)?;
    if stored.schema_version != STORAGE_SCHEMA_VERSION
        || stored.tasks.iter().any(|task| !task.is_valid())
    {
        return Err(ScheduledTaskStoreError::InvalidData);
    }
    for task in &stored.tasks {
        if !matches!(task.schedule, ScheduledTaskSchedule::Once { .. }) {
            let _ = validate_and_resolve_next_run(&task.schedule, task.created_at_unix_ms - 1)?;
        }
    }
    Ok(stored.tasks)
}

pub async fn write_scheduled_tasks(
    app_data: &Path,
    tasks: &[ScheduledTask],
) -> Result<(), ScheduledTaskStoreError> {
    if tasks.iter().any(|task| !task.is_valid()) {
        return Err(ScheduledTaskStoreError::InvalidData);
    }
    let mut bounded_tasks = tasks.to_vec();
    for task in &mut bounded_tasks {
        if task.runs.len() > MAX_SCHEDULED_TASK_RUNS {
            task.runs.drain(..task.runs.len() - MAX_SCHEDULED_TASK_RUNS);
        }
    }
    let target = storage_path(app_data);
    let parent = target
        .parent()
        .ok_or(ScheduledTaskStoreError::InvalidData)?;
    fs::create_dir_all(parent).await?;
    let bytes = serde_json::to_vec(&StoredScheduledTasks {
        schema_version: STORAGE_SCHEMA_VERSION,
        tasks: bounded_tasks,
    })?;
    let temporary = temporary_path(parent);
    fs::write(&temporary, bytes).await?;
    replace_file(&temporary, &target).await
}

async fn replace_file(temporary: &Path, target: &Path) -> Result<(), ScheduledTaskStoreError> {
    if let Err(error) = fs::rename(temporary, target).await {
        if !matches!(
            error.kind(),
            io::ErrorKind::AlreadyExists | io::ErrorKind::PermissionDenied
        ) {
            let _ = fs::remove_file(temporary).await;
            return Err(error.into());
        }
        match fs::remove_file(target).await {
            Ok(()) => fs::rename(temporary, target).await?,
            Err(remove_error) if remove_error.kind() == io::ErrorKind::NotFound => {
                fs::rename(temporary, target).await?
            }
            Err(remove_error) => {
                let _ = fs::remove_file(temporary).await;
                return Err(remove_error.into());
            }
        }
    }
    Ok(())
}

fn storage_path(app_data: &Path) -> PathBuf {
    app_data.join("scheduled-tasks").join("v1.json")
}

fn temporary_path(parent: &Path) -> PathBuf {
    let id = TEMP_FILE_ID.fetch_add(1, Ordering::Relaxed);
    parent.join(format!(".v1.{}.{id}.tmp", std::process::id()))
}
