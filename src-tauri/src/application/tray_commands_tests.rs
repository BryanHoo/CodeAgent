use super::tray_commands::{
    TrayMenuAction, TrayTask, TrayTaskState, apply_agent_event_to_tray_state, tray_menu_action,
    tray_show_menu_on_left_click, tray_task_menu_id, tray_task_route, tray_title, tray_tooltip,
};
use crate::domain::runtime::AgentEvent;

fn running_task() -> TrayTask {
    TrayTask {
        project_id: "project-1".to_owned(),
        task_id: "task-1".to_owned(),
        task_name: "Implement tray status".to_owned(),
    }
}

#[test]
fn tray_count_is_rendered_next_to_the_icon_and_in_the_tooltip() {
    assert_eq!(tray_title(0).as_deref(), Some(""));
    assert_eq!(tray_title(2).as_deref(), Some(" 2"));
    assert_eq!(tray_tooltip(0), "CodeAgent");
    assert_eq!(tray_tooltip(2), "CodeAgent · 2 个任务进行中");
}

#[test]
fn tray_left_click_opens_the_menu() {
    assert!(tray_show_menu_on_left_click());
}

#[test]
fn started_runtime_events_add_tasks_without_waiting_for_the_webview() {
    let mut state = TrayTaskState::default();
    let started = AgentEvent::from(serde_json::json!({
        "taskId": "task-1",
        "type": "turn.started"
    }));

    assert!(apply_agent_event_to_tray_state(
        &mut state,
        "project-1",
        &started,
        Some("底层任务标题"),
    ));
    assert_eq!(
        state.tasks(),
        &[TrayTask {
            project_id: "project-1".to_owned(),
            task_id: "task-1".to_owned(),
            task_name: "底层任务标题".to_owned(),
        }]
    );
}

#[test]
fn metadata_events_update_running_task_names_in_rust() {
    let mut state = TrayTaskState::from_tasks(vec![running_task()]);
    let metadata_changed = AgentEvent::from(serde_json::json!({
        "payload": {"title": "更新后的任务标题"},
        "taskId": "task-1",
        "type": "task.metadata_changed"
    }));

    assert!(apply_agent_event_to_tray_state(
        &mut state,
        "project-1",
        &metadata_changed,
        Some("更新后的任务标题"),
    ));
    assert_eq!(state.tasks()[0].task_name, "更新后的任务标题");
}

#[test]
fn tray_task_menu_ids_round_trip_to_navigation_targets() {
    let task = running_task();

    assert_eq!(
        tray_menu_action("show-main"),
        TrayMenuAction::ShowMainWindow
    );
    assert_eq!(
        tray_menu_action("quit-app"),
        TrayMenuAction::QuitApplication
    );
    assert_eq!(tray_menu_action("unknown"), TrayMenuAction::Ignore);
    #[cfg(target_os = "macos")]
    assert_eq!(
        tray_menu_action("hold-to-quit-app"),
        TrayMenuAction::ConfirmQuitApplication
    );
    assert_eq!(
        tray_menu_action(&tray_task_menu_id(&task)),
        TrayMenuAction::OpenTask {
            project_id: task.project_id.clone(),
            task_id: task.task_id.clone(),
        }
    );
    assert_eq!(
        tray_task_route("project-1", "task-1").unwrap(),
        "p/project-1/t/task-1"
    );
    assert_eq!(
        tray_task_route("temporary", "task-2").unwrap(),
        "temporary/t/task-2"
    );
}

#[test]
fn terminal_runtime_events_remove_tasks_from_the_tray_count() {
    let mut state = TrayTaskState::from_tasks(vec![running_task()]);
    let completed = AgentEvent::from(serde_json::json!({
        "payload": {"turn": {"status": "completed"}},
        "taskId": "task-1",
        "type": "turn.completed"
    }));

    assert!(apply_agent_event_to_tray_state(
        &mut state,
        "project-1",
        &completed,
        Some("Implement tray status"),
    ));
    assert!(state.tasks().is_empty());
}
