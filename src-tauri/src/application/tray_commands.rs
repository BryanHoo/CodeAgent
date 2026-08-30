use serde::Deserialize;
use tauri::{
    AppHandle, Manager, State, Url,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use tokio::sync::Mutex;

use super::{
    app_lifecycle::{show_main_window, show_main_window_at_route},
    error::AppError,
};
use crate::domain::runtime::AgentEvent;

#[cfg(target_os = "macos")]
const HOLD_TO_QUIT_MENU_ID: &str = "hold-to-quit-app";
const MAX_MENU_TASK_NAME_CHARS: usize = 80;
const MAX_TRAY_TASKS: usize = 256;
#[cfg(target_os = "macos")]
const MACOS_TRAY_ICON: tauri::image::Image<'_> = tauri::include_image!("./icons/tray-icon.png");
const QUIT_APP_MENU_ID: &str = "quit-app";
const RUNNING_TASK_MENU_PREFIX: &str = "running-task:";
const SHOW_MAIN_MENU_ID: &str = "show-main";
const TRAY_ICON_ID: &str = "codeagent-tray";

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TrayTaskUpdate {
    is_running: bool,
    project_id: String,
    task_id: String,
    task_name: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct TrayTask {
    pub(super) project_id: String,
    pub(super) task_id: String,
    pub(super) task_name: String,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub(super) struct TrayTaskState {
    tasks: Vec<TrayTask>,
}

impl TrayTaskState {
    #[cfg(test)]
    pub(super) fn from_tasks(tasks: Vec<TrayTask>) -> Self {
        Self { tasks }
    }

    #[cfg(test)]
    pub(super) fn tasks(&self) -> &[TrayTask] {
        &self.tasks
    }

    fn apply_updates(&mut self, updates: Vec<TrayTaskUpdate>) -> bool {
        let mut changed = false;
        for update in updates {
            let task_index = self.tasks.iter().position(|task| {
                task.project_id == update.project_id && task.task_id == update.task_id
            });
            if update.is_running {
                let task = TrayTask {
                    project_id: update.project_id,
                    task_id: update.task_id,
                    task_name: update.task_name,
                };
                if let Some(task_index) = task_index {
                    if self.tasks[task_index] != task {
                        self.tasks[task_index] = task;
                        changed = true;
                    }
                } else if self.tasks.len() < MAX_TRAY_TASKS {
                    self.tasks.push(task);
                    changed = true;
                }
            } else if let Some(task_index) = task_index {
                self.tasks.remove(task_index);
                changed = true;
            }
        }
        changed
    }
}

#[derive(Default)]
pub struct TrayRuntime {
    state: Mutex<TrayTaskState>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) enum TrayMenuAction {
    ShowMainWindow,
    OpenTask {
        project_id: String,
        task_id: String,
    },
    QuitApplication,
    #[cfg(target_os = "macos")]
    ConfirmQuitApplication,
    Ignore,
}

pub(crate) fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    #[cfg(target_os = "macos")]
    super::app_lifecycle::configure_macos_hold_to_quit_menu(app)?;

    let menu = build_tray_menu(app, &[])?;
    let mut tray = TrayIconBuilder::with_id(TRAY_ICON_ID)
        .tooltip("CodeAgent")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match tray_menu_action(event.id().as_ref()) {
            TrayMenuAction::ShowMainWindow => show_main_window(app),
            TrayMenuAction::OpenTask {
                project_id,
                task_id,
            } => match tray_task_route(&project_id, &task_id) {
                Ok(route) => show_main_window_at_route(app, route),
                Err(error) => eprintln!("failed to open tray task: {error}"),
            },
            TrayMenuAction::QuitApplication => app.exit(0),
            #[cfg(target_os = "macos")]
            TrayMenuAction::ConfirmQuitApplication => {
                if macos_panel_activation::confirm_hold_to_quit() {
                    app.exit(0);
                }
            }
            TrayMenuAction::Ignore => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                show_main_window(tray.app_handle());
            }
        });
    #[cfg(target_os = "macos")]
    {
        // Template 模式让图标自动匹配菜单栏明暗外观和交互状态。
        tray = tray.icon(MACOS_TRAY_ICON).icon_as_template(true);
    }
    #[cfg(not(target_os = "macos"))]
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn sync_tray_tasks(
    app: AppHandle,
    runtime: State<'_, TrayRuntime>,
    tasks: Vec<TrayTaskUpdate>,
) -> Result<(), AppError> {
    if !tray_task_updates_are_valid(&tasks) {
        return Err(AppError::TrayOperationFailed);
    }
    let next_tasks = {
        let mut state = runtime.state.lock().await;
        if !state.apply_updates(tasks) {
            return Ok(());
        }
        state.tasks.clone()
    };
    render_tray_state(&app, &next_tasks)
}

pub(super) async fn observe_tray_agent_event(
    app: &AppHandle,
    project_id: &str,
    event: &AgentEvent,
) {
    if !matches!(
        event.event_type(),
        Some(
            "provider.error"
                | "task.removed"
                | "task.status_updated"
                | "turn.completed"
                | "turn.started"
        )
    ) {
        return;
    }
    let next_tasks = {
        let runtime = app.state::<TrayRuntime>();
        let mut state = runtime.state.lock().await;
        if !apply_agent_event_to_tray_state(&mut state, project_id, event) {
            return;
        }
        state.tasks.clone()
    };
    if let Err(error) = render_tray_state(app, &next_tasks) {
        eprintln!("failed to update tray from runtime event: {error}");
    }
}

pub(super) fn apply_agent_event_to_tray_state(
    state: &mut TrayTaskState,
    project_id: &str,
    event: &AgentEvent,
) -> bool {
    let Some(task_id) = event.task_id() else {
        return false;
    };
    let task_index = state
        .tasks
        .iter()
        .position(|task| task.project_id == project_id && task.task_id == task_id);
    let payload = event.as_json().and_then(|event| event.get("payload"));
    let should_remove = match event.event_type() {
        Some("turn.completed" | "task.removed") => true,
        Some("provider.error") => {
            payload
                .and_then(|payload| payload.get("willRetry"))
                .and_then(serde_json::Value::as_bool)
                == Some(false)
        }
        Some("task.status_updated") => payload
            .and_then(|payload| payload.get("status"))
            .and_then(serde_json::Value::as_str)
            .is_some_and(|status| status == "failed"),
        _ => false,
    };
    if should_remove {
        if let Some(task_index) = task_index {
            state.tasks.remove(task_index);
            return true;
        }
        return false;
    }
    let should_add = event.event_type() == Some("turn.started")
        || (event.event_type() == Some("task.status_updated")
            && payload
                .and_then(|payload| payload.get("status"))
                .and_then(serde_json::Value::as_str)
                == Some("running"));
    if !should_add || task_index.is_some() || state.tasks.len() >= MAX_TRAY_TASKS {
        return false;
    }
    state.tasks.push(TrayTask {
        project_id: project_id.to_owned(),
        task_id: task_id.to_owned(),
        task_name: task_id.to_owned(),
    });
    true
}

fn render_tray_state(app: &AppHandle, tasks: &[TrayTask]) -> Result<(), AppError> {
    let tray = app
        .tray_by_id(TRAY_ICON_ID)
        .ok_or(AppError::TrayOperationFailed)?;
    let title = tray_title(tasks.len());
    let tooltip = tray_tooltip(tasks.len());
    tray.set_title(title.as_deref())
        .map_err(|_| AppError::TrayOperationFailed)?;
    tray.set_tooltip(Some(tooltip))
        .map_err(|_| AppError::TrayOperationFailed)?;
    let menu = build_tray_menu(app, tasks).map_err(|_| AppError::TrayOperationFailed)?;
    tray.set_menu(Some(menu))
        .map_err(|_| AppError::TrayOperationFailed)
}

pub(super) fn tray_title(task_count: usize) -> Option<String> {
    (task_count > 0).then(|| format!(" {task_count}"))
}

pub(super) fn tray_tooltip(task_count: usize) -> String {
    if task_count == 0 {
        "CodeAgent".to_owned()
    } else {
        format!("CodeAgent · {task_count} 个任务进行中")
    }
}

fn build_tray_menu(app: &AppHandle, tasks: &[TrayTask]) -> tauri::Result<Menu<tauri::Wry>> {
    let menu = Menu::new(app)?;
    let show_main =
        MenuItem::with_id(app, SHOW_MAIN_MENU_ID, "打开 CodeAgent", true, None::<&str>)?;
    menu.append(&show_main)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    let heading = MenuItem::with_id(
        app,
        "running-task-heading",
        format!("进行中的任务 ({})", tasks.len()),
        false,
        None::<&str>,
    )?;
    menu.append(&heading)?;
    if tasks.is_empty() {
        let empty = MenuItem::with_id(
            app,
            "running-task-empty",
            "暂无进行中的任务",
            false,
            None::<&str>,
        )?;
        menu.append(&empty)?;
    } else {
        for task in tasks {
            let item = MenuItem::with_id(
                app,
                tray_task_menu_id(task),
                truncate_menu_task_name(&task.task_name),
                true,
                None::<&str>,
            )?;
            menu.append(&item)?;
        }
    }
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    let quit_app = MenuItem::with_id(app, QUIT_APP_MENU_ID, "退出 CodeAgent", true, None::<&str>)?;
    menu.append(&quit_app)?;
    Ok(menu)
}

pub(super) fn tray_task_menu_id(task: &TrayTask) -> String {
    format!(
        "{RUNNING_TASK_MENU_PREFIX}{}:{}{}",
        task.project_id.len(),
        task.project_id,
        task.task_id
    )
}

pub(super) fn tray_menu_action(menu_id: &str) -> TrayMenuAction {
    match menu_id {
        SHOW_MAIN_MENU_ID => return TrayMenuAction::ShowMainWindow,
        QUIT_APP_MENU_ID => return TrayMenuAction::QuitApplication,
        #[cfg(target_os = "macos")]
        HOLD_TO_QUIT_MENU_ID => return TrayMenuAction::ConfirmQuitApplication,
        _ => {}
    }
    let Some(encoded) = menu_id.strip_prefix(RUNNING_TASK_MENU_PREFIX) else {
        return TrayMenuAction::Ignore;
    };
    let Some((project_id_len, target)) = encoded.split_once(':') else {
        return TrayMenuAction::Ignore;
    };
    let Ok(project_id_len) = project_id_len.parse::<usize>() else {
        return TrayMenuAction::Ignore;
    };
    if project_id_len == 0
        || project_id_len >= target.len()
        || !target.is_char_boundary(project_id_len)
    {
        return TrayMenuAction::Ignore;
    }
    let (project_id, task_id) = target.split_at(project_id_len);
    TrayMenuAction::OpenTask {
        project_id: project_id.to_owned(),
        task_id: task_id.to_owned(),
    }
}

pub(super) fn tray_task_route(project_id: &str, task_id: &str) -> Result<String, AppError> {
    let mut url = Url::parse("tauri://localhost/").map_err(|_| AppError::TrayOperationFailed)?;
    let mut segments = url
        .path_segments_mut()
        .map_err(|()| AppError::TrayOperationFailed)?;
    if project_id == "temporary" {
        segments.push("temporary").push("t").push(task_id);
    } else {
        segments.push("p").push(project_id).push("t").push(task_id);
    }
    drop(segments);
    Ok(url.path().trim_start_matches('/').to_owned())
}

fn tray_task_updates_are_valid(tasks: &[TrayTaskUpdate]) -> bool {
    tasks.len() <= MAX_TRAY_TASKS
        && tasks.iter().all(|task| {
            !task.project_id.is_empty()
                && task.project_id.len() <= 128
                && !task.task_id.is_empty()
                && task.task_id.len() <= 128
                && !task.task_name.is_empty()
                && task.task_name.len() <= 512
        })
}

fn truncate_menu_task_name(task_name: &str) -> String {
    let mut chars = task_name.chars();
    let label: String = chars.by_ref().take(MAX_MENU_TASK_NAME_CHARS).collect();
    if chars.next().is_some() {
        format!("{label}...")
    } else {
        label
    }
}
