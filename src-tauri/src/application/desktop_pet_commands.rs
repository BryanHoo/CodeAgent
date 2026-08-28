#[cfg(not(target_os = "macos"))]
use std::{
    sync::atomic::{AtomicU64, Ordering},
    time::Duration,
};

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, State, Url, WebviewWindow,
};
use tokio::sync::Mutex;

use super::{
    app_lifecycle::show_main_window_at_route,
    desktop_pet_activity::apply_agent_event_to_desktop_pet_state,
    desktop_pet_window::{
        DESKTOP_PET_BUBBLES_LABEL, DESKTOP_PET_EVENT, DESKTOP_PET_LABEL,
        create_desktop_pet_bubbles_window, create_desktop_pet_window, destroy_desktop_pet_window,
        drag_pet_position, monitor_bounds, move_pet_position, persist_position,
        position_desktop_pet_bubbles,
    },
    error::AppError,
};
use crate::domain::runtime::AgentEvent;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DesktopPetAnimation {
    Failed,
    Idle,
    Review,
    Running,
    Waiting,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DesktopPetDragStrategy {
    Native,
    Webview,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopPetState {
    pub(super) animation_name: DesktopPetAnimation,
    pub(super) pet_id: String,
    pub(super) tasks: Vec<DesktopPetTask>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DesktopPetTask {
    pub(super) project_id: String,
    pub(super) root_path: Option<String>,
    pub(super) status: DesktopPetTaskStatus,
    pub(super) task_id: String,
    pub(super) task_name: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(super) enum DesktopPetTaskStatus {
    Completed,
    Running,
    Waiting,
}

#[derive(Clone, Copy, Debug, Serialize)]
pub struct DesktopPetPosition {
    x: i32,
    y: i32,
}

impl From<PhysicalPosition<i32>> for DesktopPetPosition {
    fn from(position: PhysicalPosition<i32>) -> Self {
        Self {
            x: position.x,
            y: position.y,
        }
    }
}

#[derive(Default)]
pub struct DesktopPetRuntime {
    #[cfg(not(target_os = "macos"))]
    position_generation: AtomicU64,
    state: Mutex<Option<DesktopPetState>>,
}

impl DesktopPetRuntime {
    #[cfg(not(target_os = "macos"))]
    pub(super) fn schedule_position_persist(
        &self,
        app: AppHandle,
        position: PhysicalPosition<i32>,
    ) {
        let generation = self.position_generation.fetch_add(1, Ordering::Relaxed) + 1;
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_millis(180)).await;
            let runtime = app.state::<DesktopPetRuntime>();
            if runtime.position_generation.load(Ordering::Relaxed) == generation {
                let _ = persist_position(&app, position).await;
            }
        });
    }
}

fn ensure_desktop_pet_window(window: &WebviewWindow) -> Result<(), AppError> {
    if matches!(
        window.label(),
        DESKTOP_PET_LABEL | DESKTOP_PET_BUBBLES_LABEL
    ) {
        Ok(())
    } else {
        Err(AppError::DesktopPetWindowFailed)
    }
}

fn ensure_pet_sprite_window(window: &WebviewWindow) -> Result<(), AppError> {
    if window.label() == DESKTOP_PET_LABEL {
        Ok(())
    } else {
        Err(AppError::DesktopPetWindowFailed)
    }
}

fn state_is_valid(state: &DesktopPetState) -> bool {
    !state.pet_id.is_empty()
        && state.pet_id.len() <= 128
        && state.tasks.len() <= 256
        && state.tasks.iter().all(|task| {
            !task.project_id.is_empty()
                && task.project_id.len() <= 128
                && !task.task_id.is_empty()
                && task.task_id.len() <= 128
                && !task.task_name.is_empty()
                && task.task_name.len() <= 512
                && task
                    .root_path
                    .as_ref()
                    .is_none_or(|path| path.len() <= 4096)
        })
}

#[tauri::command(rename_all = "camelCase")]
pub async fn sync_desktop_pet(
    app: AppHandle,
    runtime: State<'_, DesktopPetRuntime>,
    state: Option<DesktopPetState>,
) -> Result<(), AppError> {
    if state.as_ref().is_some_and(|state| !state_is_valid(state)) {
        return Err(AppError::DesktopPetWindowFailed);
    }
    *runtime.state.lock().await = state.clone();

    render_desktop_pet_state(&app, state).await
}

async fn render_desktop_pet_state(
    app: &AppHandle,
    state: Option<DesktopPetState>,
) -> Result<(), AppError> {
    let Some(state) = state else {
        for label in [DESKTOP_PET_LABEL, DESKTOP_PET_BUBBLES_LABEL] {
            destroy_desktop_pet_window(app, label).await?;
        }
        return Ok(());
    };
    let window = match app.get_webview_window(DESKTOP_PET_LABEL) {
        Some(window) => window,
        None => create_desktop_pet_window(app).await?,
    };
    window
        .emit(DESKTOP_PET_EVENT, state.clone())
        .map_err(|_| AppError::DesktopPetWindowFailed)?;

    if state.tasks.is_empty() {
        destroy_desktop_pet_window(app, DESKTOP_PET_BUBBLES_LABEL).await?;
        return Ok(());
    }
    let bubble_window = match app.get_webview_window(DESKTOP_PET_BUBBLES_LABEL) {
        Some(window) => window,
        None => create_desktop_pet_bubbles_window(app).await?,
    };
    bubble_window
        .emit(DESKTOP_PET_EVENT, state)
        .map_err(|_| AppError::DesktopPetWindowFailed)
}

pub(super) async fn observe_desktop_pet_agent_event(
    app: &AppHandle,
    project_id: &str,
    event: &AgentEvent,
) {
    let runtime = app.state::<DesktopPetRuntime>();
    let next_state = {
        let mut stored_state = runtime.state.lock().await;
        let Some(state) = stored_state.as_mut() else {
            return;
        };
        if !apply_agent_event_to_desktop_pet_state(state, project_id, event) {
            return;
        }
        state.clone()
    };

    // 主 WebView 不存在时由 Rust 直接刷新独立宠物窗口。
    if let Err(error) = render_desktop_pet_state(app, Some(next_state)).await {
        eprintln!("failed to update desktop pet from runtime event: {error}");
    }
}

#[tauri::command]
pub async fn get_desktop_pet_state(
    window: WebviewWindow,
    runtime: State<'_, DesktopPetRuntime>,
) -> Result<Option<DesktopPetState>, AppError> {
    ensure_desktop_pet_window(&window)?;
    Ok(runtime.state.lock().await.clone())
}

#[tauri::command]
pub fn get_desktop_pet_position(window: WebviewWindow) -> Result<DesktopPetPosition, AppError> {
    ensure_pet_sprite_window(&window)?;
    window
        .outer_position()
        .map(DesktopPetPosition::from)
        .map_err(|_| AppError::DesktopPetWindowFailed)
}

#[tauri::command]
pub fn get_desktop_pet_drag_strategy(
    window: WebviewWindow,
) -> Result<DesktopPetDragStrategy, AppError> {
    ensure_pet_sprite_window(&window)?;
    if cfg!(target_os = "macos") {
        Ok(DesktopPetDragStrategy::Native)
    } else {
        Ok(DesktopPetDragStrategy::Webview)
    }
}

#[tauri::command]
pub fn show_desktop_pet(window: WebviewWindow) -> Result<(), AppError> {
    ensure_pet_sprite_window(&window)?;
    window.show().map_err(|_| AppError::DesktopPetWindowFailed)
}

#[tauri::command(rename_all = "camelCase")]
pub fn set_desktop_pet_drag_position(
    window: WebviewWindow,
    x: i32,
    y: i32,
) -> Result<(), AppError> {
    ensure_pet_sprite_window(&window)?;
    let size = window
        .outer_size()
        .map_err(|_| AppError::DesktopPetWindowFailed)?;
    let position = drag_pet_position(PhysicalPosition::new(x, y), &monitor_bounds(&window)?, size);
    window
        .set_position(position)
        .map_err(|_| AppError::DesktopPetWindowFailed)
}

#[tauri::command]
pub async fn start_desktop_pet_native_drag(window: WebviewWindow) -> Result<(), AppError> {
    ensure_pet_sprite_window(&window)?;
    #[cfg(not(target_os = "macos"))]
    return Err(AppError::DesktopPetWindowFailed);

    #[cfg(target_os = "macos")]
    {
        super::desktop_pet_panel::run_desktop_pet_drag(&window).await?;
        let size = window
            .outer_size()
            .map_err(|_| AppError::DesktopPetWindowFailed)?;
        let current = window
            .outer_position()
            .map_err(|_| AppError::DesktopPetWindowFailed)?;
        let position = drag_pet_position(current, &monitor_bounds(&window)?, size);
        if position != current {
            window
                .set_position(position)
                .map_err(|_| AppError::DesktopPetWindowFailed)?;
        }
        position_desktop_pet_bubbles(window.app_handle(), position)?;
        persist_position(window.app_handle(), position).await
    }
}

#[tauri::command(rename_all = "camelCase")]
pub async fn move_desktop_pet(
    window: WebviewWindow,
    delta_x: i32,
    delta_y: i32,
    reset: bool,
) -> Result<(), AppError> {
    ensure_pet_sprite_window(&window)?;
    if !(-48..=48).contains(&delta_x) || !(-48..=48).contains(&delta_y) {
        return Err(AppError::DesktopPetWindowFailed);
    }
    let size = window
        .outer_size()
        .map_err(|_| AppError::DesktopPetWindowFailed)?;
    let monitors = monitor_bounds(&window)?;
    let position = if reset {
        super::desktop_pet_window::resolve_pet_position(None, &monitors, size)
    } else {
        move_pet_position(
            window
                .outer_position()
                .map_err(|_| AppError::DesktopPetWindowFailed)?,
            delta_x,
            delta_y,
            &monitors,
            size,
        )
    };
    window
        .set_position(position)
        .map_err(|_| AppError::DesktopPetWindowFailed)?;
    #[cfg(target_os = "macos")]
    position_desktop_pet_bubbles(window.app_handle(), position)?;
    persist_position(window.app_handle(), position).await
}

#[tauri::command(rename_all = "camelCase")]
pub fn layout_desktop_pet_bubbles(
    window: WebviewWindow,
    width: f64,
    height: f64,
) -> Result<(), AppError> {
    if window.label() != DESKTOP_PET_BUBBLES_LABEL
        || !(80.0..=320.0).contains(&width)
        || !(24.0..=640.0).contains(&height)
    {
        return Err(AppError::DesktopPetWindowFailed);
    }
    window
        .set_size(LogicalSize::new(width.ceil(), height.ceil()))
        .map_err(|_| AppError::DesktopPetWindowFailed)?;
    let pet_window = window
        .app_handle()
        .get_webview_window(DESKTOP_PET_LABEL)
        .ok_or(AppError::DesktopPetWindowFailed)?;
    position_desktop_pet_bubbles(
        window.app_handle(),
        pet_window
            .outer_position()
            .map_err(|_| AppError::DesktopPetWindowFailed)?,
    )?;
    window.show().map_err(|_| AppError::DesktopPetWindowFailed)
}

#[tauri::command(rename_all = "camelCase")]
pub fn open_desktop_pet_task(
    window: WebviewWindow,
    project_id: String,
    task_id: String,
) -> Result<(), AppError> {
    if window.label() != DESKTOP_PET_BUBBLES_LABEL
        || project_id.is_empty()
        || project_id.len() > 128
        || task_id.is_empty()
        || task_id.len() > 128
    {
        return Err(AppError::DesktopPetWindowFailed);
    }
    let route = desktop_pet_task_route(&project_id, &task_id)?;
    show_main_window_at_route(window.app_handle(), route);
    Ok(())
}

fn desktop_pet_task_route(project_id: &str, task_id: &str) -> Result<String, AppError> {
    let mut url = Url::parse("tauri://localhost/").map_err(|_| AppError::DesktopPetWindowFailed)?;
    let mut segments = url
        .path_segments_mut()
        .map_err(|()| AppError::DesktopPetWindowFailed)?;
    segments.push("p").push(project_id).push("t").push(task_id);
    drop(segments);
    Ok(url.path().trim_start_matches('/').to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn desktop_pet_state_uses_the_frontend_camel_case_contract() {
        let state = DesktopPetState {
            animation_name: DesktopPetAnimation::Waiting,
            pet_id: "codex".to_string(),
            tasks: vec![DesktopPetTask {
                project_id: "project-1".to_string(),
                root_path: Some("/workspace".to_string()),
                status: DesktopPetTaskStatus::Waiting,
                task_id: "task-1".to_string(),
                task_name: "Review change".to_string(),
            }],
        };

        assert_eq!(
            serde_json::to_value(state).unwrap(),
            serde_json::json!({
                "animationName": "waiting",
                "petId": "codex",
                "tasks": [{
                    "projectId": "project-1",
                    "rootPath": "/workspace",
                    "status": "waiting",
                    "taskId": "task-1",
                    "taskName": "Review change"
                }]
            }),
        );
    }

    #[test]
    fn desktop_pet_drag_strategy_uses_the_frontend_lowercase_contract() {
        assert_eq!(
            serde_json::to_value(DesktopPetDragStrategy::Native).unwrap(),
            serde_json::json!("native"),
        );
        assert_eq!(
            serde_json::to_value(DesktopPetDragStrategy::Webview).unwrap(),
            serde_json::json!("webview"),
        );
    }

    #[test]
    fn pet_task_route_encodes_each_dynamic_segment() {
        assert_eq!(
            desktop_pet_task_route("project/one", "task two").unwrap(),
            "p/project%2Fone/t/task%20two"
        );
    }
}
