use std::sync::atomic::{AtomicU64, Ordering};

use serde_json::json;

use super::task_settings::{delete_task_settings, read_task_settings, write_task_settings};
use crate::domain::conversation::AgentTaskSettings;

static TEST_ID: AtomicU64 = AtomicU64::new(1);

fn settings(model: &str) -> AgentTaskSettings {
    AgentTaskSettings {
        approval_policy: json!("on-request"),
        approvals_reviewer: "user".to_owned(),
        model: model.to_owned(),
        reasoning_effort: "high".to_owned(),
        sandbox_mode: "workspace-write".to_owned(),
    }
}

#[tokio::test]
async fn task_settings_should_survive_new_reads_and_replace_atomically() {
    let root = std::env::temp_dir().join(format!(
        "codeagent-task-settings-{}-{}",
        std::process::id(),
        TEST_ID.fetch_add(1, Ordering::Relaxed)
    ));

    assert!(
        read_task_settings(&root, "project-a", "thread-a")
            .await
            .expect("missing settings should be readable")
            .is_none()
    );
    write_task_settings(&root, "project-a", "thread-a", &settings("model-a"))
        .await
        .expect("settings should persist");
    assert_eq!(
        read_task_settings(&root, "project-a", "thread-a")
            .await
            .expect("settings should restore")
            .expect("settings should exist")
            .model,
        "model-a"
    );

    write_task_settings(&root, "project-a", "thread-a", &settings("model-b"))
        .await
        .expect("settings should replace");
    assert_eq!(
        read_task_settings(&root, "project-a", "thread-a")
            .await
            .expect("replaced settings should restore")
            .expect("replaced settings should exist")
            .model,
        "model-b"
    );

    delete_task_settings(&root, "project-a", "thread-a")
        .await
        .expect("settings should delete");
    assert!(
        read_task_settings(&root, "project-a", "thread-a")
            .await
            .expect("deleted settings should be readable")
            .is_none()
    );
    tokio::fs::remove_dir_all(root)
        .await
        .expect("test directory should clean up");
}
