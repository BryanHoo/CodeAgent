use super::AppState;
use crate::infrastructure::codex::QueueSnapshot;

#[tokio::test]
async fn queue_snapshot_should_not_clear_an_edit_started_during_read() {
    let state = AppState::default();
    state.update_queue_editing("task", "old", true).await;
    let baseline = state.queue_editing_submission("task").await;
    state.update_queue_editing("task", "new", true).await;
    state
        .complete_queue_snapshot(
            "task",
            baseline.as_deref(),
            &mut QueueSnapshot { data: vec![] },
        )
        .await;
    assert_eq!(
        state.queue_editing_submission("task").await.as_deref(),
        Some("new")
    );
}

#[tokio::test]
async fn queue_snapshot_should_clear_only_the_matching_missing_edit() {
    let state = AppState::default();
    state.update_queue_editing("task", "old", true).await;
    state
        .update_queue_editing("other", "other-edit", true)
        .await;
    state
        .complete_queue_snapshot("task", Some("old"), &mut QueueSnapshot { data: vec![] })
        .await;
    assert!(state.queue_editing_submission("task").await.is_none());
    assert_eq!(
        state.queue_editing_submission("other").await.as_deref(),
        Some("other-edit")
    );
}
