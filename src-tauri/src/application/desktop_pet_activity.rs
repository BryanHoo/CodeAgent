use crate::domain::runtime::AgentEvent;

use super::desktop_pet_commands::{DesktopPetAnimation, DesktopPetState, DesktopPetTaskStatus};

pub(super) fn apply_agent_event_to_desktop_pet_state(
    state: &mut DesktopPetState,
    project_id: &str,
    event: &AgentEvent,
) -> bool {
    let Some(task_id) = event.task_id() else {
        return false;
    };
    let Some(task_index) = state
        .tasks
        .iter()
        .position(|task| task.project_id == project_id && task.task_id == task_id)
    else {
        return false;
    };
    let payload = event.as_json().and_then(|event| event.get("payload"));

    match event.event_type() {
        Some("turn.started") => {
            state.tasks[task_index].status = DesktopPetTaskStatus::Running;
        }
        Some("turn.completed") => {
            let failed = payload
                .and_then(|payload| payload.pointer("/turn/status"))
                .and_then(serde_json::Value::as_str)
                .is_some_and(|status| matches!(status, "failed" | "interrupted"));
            if failed {
                state.tasks.remove(task_index);
                state.animation_name = DesktopPetAnimation::Failed;
                return true;
            }
            state.tasks[task_index].status = DesktopPetTaskStatus::Completed;
        }
        Some("provider.error")
            if payload
                .and_then(|payload| payload.get("willRetry"))
                .and_then(serde_json::Value::as_bool)
                == Some(false) =>
        {
            state.tasks.remove(task_index);
            state.animation_name = DesktopPetAnimation::Failed;
            return true;
        }
        Some("task.status_updated") => {
            match payload
                .and_then(|payload| payload.get("status"))
                .and_then(serde_json::Value::as_str)
            {
                Some("running") => {
                    state.tasks[task_index].status = DesktopPetTaskStatus::Running;
                }
                Some("failed") => {
                    state.tasks.remove(task_index);
                    state.animation_name = DesktopPetAnimation::Failed;
                    return true;
                }
                Some("idle") => {
                    // idle 与 turn.completed 的到达顺序不稳定，终态只由完整 Turn 事件确认。
                    return false;
                }
                _ => return false,
            }
        }
        _ => return false,
    }
    refresh_desktop_pet_animation(state);
    true
}

fn refresh_desktop_pet_animation(state: &mut DesktopPetState) {
    if state.animation_name == DesktopPetAnimation::Failed {
        return;
    }
    state.animation_name = if state
        .tasks
        .iter()
        .any(|task| task.status == DesktopPetTaskStatus::Waiting)
    {
        DesktopPetAnimation::Waiting
    } else if state
        .tasks
        .iter()
        .any(|task| task.status == DesktopPetTaskStatus::Running)
    {
        DesktopPetAnimation::Running
    } else if state
        .tasks
        .iter()
        .any(|task| task.status == DesktopPetTaskStatus::Completed)
    {
        DesktopPetAnimation::Review
    } else {
        DesktopPetAnimation::Idle
    };
}

pub(super) fn preserve_hidden_completed_tasks(
    current: &DesktopPetState,
    next: &mut DesktopPetState,
) {
    for task in &current.tasks {
        if task.status == DesktopPetTaskStatus::Completed
            && !next.tasks.iter().any(|next_task| {
                next_task.project_id == task.project_id && next_task.task_id == task.task_id
            })
        {
            next.tasks.push(task.clone());
        }
    }
    refresh_desktop_pet_animation(next);
}

pub(super) fn acknowledge_completed_task(
    state: &mut DesktopPetState,
    project_id: &str,
    task_id: &str,
) -> bool {
    let original_len = state.tasks.len();
    state.tasks.retain(|task| {
        task.status != DesktopPetTaskStatus::Completed
            || task.project_id != project_id
            || task.task_id != task_id
    });
    if state.tasks.len() == original_len {
        return false;
    }
    refresh_desktop_pet_animation(state);
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::application::desktop_pet_commands::DesktopPetTask;

    fn running_pet_state() -> DesktopPetState {
        DesktopPetState {
            animation_name: DesktopPetAnimation::Running,
            pet_id: "codex".to_owned(),
            tasks: vec![DesktopPetTask {
                project_id: "project-1".to_owned(),
                root_path: Some("/workspace".to_owned()),
                status: DesktopPetTaskStatus::Running,
                task_id: "task-1".to_owned(),
                task_name: "Review change".to_owned(),
            }],
        }
    }

    #[test]
    fn completed_runtime_event_replaces_loading_with_review_state() {
        let mut state = running_pet_state();
        let idle = AgentEvent::from(serde_json::json!({
            "payload": {"status": "idle"},
            "taskId": "task-1",
            "type": "task.status_updated"
        }));
        assert!(!apply_agent_event_to_desktop_pet_state(
            &mut state,
            "project-1",
            &idle
        ));
        assert_eq!(state.tasks[0].status, DesktopPetTaskStatus::Running);

        let completed = AgentEvent::from(serde_json::json!({
            "payload": {"turn": {"status": "completed"}},
            "taskId": "task-1",
            "type": "turn.completed"
        }));

        assert!(apply_agent_event_to_desktop_pet_state(
            &mut state,
            "project-1",
            &completed
        ));
        assert_eq!(state.animation_name, DesktopPetAnimation::Review);
        assert_eq!(state.tasks[0].status, DesktopPetTaskStatus::Completed);

        assert!(!apply_agent_event_to_desktop_pet_state(
            &mut state,
            "project-1",
            &idle
        ));
        assert_eq!(state.tasks[0].status, DesktopPetTaskStatus::Completed);
    }

    #[test]
    fn failed_runtime_event_stops_loading_without_leaving_a_task_bubble() {
        let mut state = running_pet_state();
        let failed = AgentEvent::from(serde_json::json!({
            "payload": {"turn": {"status": "failed"}},
            "taskId": "task-1",
            "type": "turn.completed"
        }));

        assert!(apply_agent_event_to_desktop_pet_state(
            &mut state,
            "project-1",
            &failed
        ));
        assert_eq!(state.animation_name, DesktopPetAnimation::Failed);
        assert!(state.tasks.is_empty());
    }

    #[test]
    fn hidden_frontend_sync_preserves_unacknowledged_completion() {
        let mut current = running_pet_state();
        current.tasks[0].status = DesktopPetTaskStatus::Completed;
        current.animation_name = DesktopPetAnimation::Review;
        let mut next = DesktopPetState {
            animation_name: DesktopPetAnimation::Idle,
            pet_id: "codex".to_owned(),
            tasks: vec![],
        };

        preserve_hidden_completed_tasks(&current, &mut next);

        assert_eq!(next.animation_name, DesktopPetAnimation::Review);
        assert_eq!(next.tasks, current.tasks);
    }

    #[test]
    fn acknowledging_completion_only_removes_the_selected_completed_task() {
        let mut state = running_pet_state();
        state
            .tasks
            .push(super::super::desktop_pet_commands::DesktopPetTask {
                project_id: "project-1".to_owned(),
                root_path: Some("/workspace".to_owned()),
                status: DesktopPetTaskStatus::Completed,
                task_id: "task-2".to_owned(),
                task_name: "Completed task".to_owned(),
            });

        assert!(acknowledge_completed_task(
            &mut state,
            "project-1",
            "task-2"
        ));
        assert_eq!(state.tasks.len(), 1);
        assert_eq!(state.tasks[0].status, DesktopPetTaskStatus::Running);
        assert_eq!(state.animation_name, DesktopPetAnimation::Running);
    }
}
