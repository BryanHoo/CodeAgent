use std::sync::atomic::{AtomicU64, Ordering};

use serde_json::json;

use super::scheduled_tasks::{
    MAX_SCHEDULED_TASK_RUNS, read_scheduled_tasks, validate_and_resolve_next_run,
    write_scheduled_tasks,
};
use crate::domain::{
    conversation::{AgentPromptInput, AgentTurnOptions},
    scheduled_task::{
        ScheduledTask, ScheduledTaskRun, ScheduledTaskRunStatus, ScheduledTaskSchedule,
    },
};

static TEST_ID: AtomicU64 = AtomicU64::new(1);

fn recurring_schedule() -> ScheduledTaskSchedule {
    ScheduledTaskSchedule::Rrule {
        rrule: "FREQ=DAILY".to_owned(),
        start_at_unix_ms: 1_709_971_200_000,
        timezone: "America/New_York".to_owned(),
    }
}

fn task_with_runs(run_count: usize) -> ScheduledTask {
    ScheduledTask {
        created_at_unix_ms: 1_700_000_000_000,
        enabled: true,
        id: "scheduled-a".to_owned(),
        last_run_at_unix_ms: None,
        last_run_status: None,
        name: "Daily check".to_owned(),
        next_run_at_unix_ms: Some(1_709_971_200_000),
        project_id: "project-a".to_owned(),
        project_name: "Project A".to_owned(),
        prompt: AgentPromptInput {
            attachments: Vec::new(),
            skills: Vec::new(),
            text: "Inspect the repository".to_owned(),
        },
        runs: (0..run_count)
            .map(|index| ScheduledTaskRun {
                error: None,
                finished_at_unix_ms: Some(1_700_000_000_100 + index as i64),
                id: format!("run-{index}"),
                started_at_unix_ms: 1_700_000_000_000 + index as i64,
                status: ScheduledTaskRunStatus::Started,
                task_id: Some(format!("task-{index}")),
            })
            .collect(),
        schedule: recurring_schedule(),
        turn_options: AgentTurnOptions {
            approval_policy: json!("never"),
            ..AgentTurnOptions::default()
        },
        updated_at_unix_ms: 1_700_000_000_000,
    }
}

#[test]
fn scheduled_tasks_rrule_should_preserve_wall_clock_across_dst() {
    let before_dst = validate_and_resolve_next_run(&recurring_schedule(), 1_709_971_199_000)
        .expect("valid rule should resolve");
    let after_dst = validate_and_resolve_next_run(&recurring_schedule(), before_dst)
        .expect("daily rule should continue");

    assert_eq!(before_dst, 1_709_971_200_000);
    assert_eq!(after_dst, 1_710_054_000_000);
    assert_eq!(after_dst - before_dst, 82_800_000);
}

#[test]
fn scheduled_tasks_should_reject_runaway_recurrence() {
    let schedule = ScheduledTaskSchedule::Rrule {
        rrule: "FREQ=SECONDLY".to_owned(),
        start_at_unix_ms: 1_700_000_000_000,
        timezone: "UTC".to_owned(),
    };

    assert!(validate_and_resolve_next_run(&schedule, 1_699_999_999_000).is_err());
}

#[test]
fn scheduled_tasks_contract_should_reject_cron() {
    let cron = json!({
        "expression": "0 9 * * 1-5",
        "startAtUnixMs": 1_709_992_800_000_i64,
        "timezone": "America/New_York",
        "type": "cron"
    });

    assert!(serde_json::from_value::<ScheduledTaskSchedule>(cron).is_err());
}

#[test]
fn scheduled_task_schedule_should_use_frontend_camel_case_fields() {
    let once = json!({
        "atUnixMs": 2_000_000_000_000_i64,
        "type": "once"
    });
    let recurring = json!({
        "rrule": "RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=30",
        "startAtUnixMs": 2_000_000_000_000_i64,
        "timezone": "Asia/Shanghai",
        "type": "rrule"
    });

    let once_schedule = serde_json::from_value::<ScheduledTaskSchedule>(once.clone())
        .expect("once schedule should accept frontend fields");
    let recurring_schedule = serde_json::from_value::<ScheduledTaskSchedule>(recurring.clone())
        .expect("recurring schedule should accept frontend fields");

    assert_eq!(serde_json::to_value(once_schedule).unwrap(), once);
    assert_eq!(serde_json::to_value(recurring_schedule).unwrap(), recurring);
}

#[tokio::test]
async fn scheduled_tasks_should_restore_atomically_with_bounded_runs() {
    let root = std::env::temp_dir().join(format!(
        "codeagent-scheduled-tasks-{}-{}",
        std::process::id(),
        TEST_ID.fetch_add(1, Ordering::Relaxed)
    ));
    let task = task_with_runs(MAX_SCHEDULED_TASK_RUNS + 5);

    write_scheduled_tasks(&root, &[task])
        .await
        .expect("scheduled tasks should persist");
    let restored = read_scheduled_tasks(&root)
        .await
        .expect("scheduled tasks should restore");

    assert_eq!(restored.len(), 1);
    assert_eq!(restored[0].runs.len(), MAX_SCHEDULED_TASK_RUNS);
    assert_eq!(restored[0].runs[0].id, "run-5");
    assert_eq!(restored[0].runs.last().unwrap().id, "run-24");

    tokio::fs::remove_dir_all(root)
        .await
        .expect("test directory should clean up");
}
