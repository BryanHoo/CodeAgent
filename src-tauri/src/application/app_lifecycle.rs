use std::{
    sync::Mutex,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

#[cfg(target_os = "macos")]
use tauri::menu::{MenuItem, MenuItemKind};
use tauri::{
    AppHandle, Emitter as _, Manager as _, RunEvent, Url, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, Window, WindowEvent,
};

use super::desktop_pet_commands::acknowledge_completed_desktop_pet_route;

const MAIN_WINDOW_LABEL: &str = "main";
const MAIN_WINDOW_NAVIGATE_EVENT: &str = "main-window://navigate";
const MAIN_WINDOW_DESTROY_MIN_SECS: u64 = 30;
const MAIN_WINDOW_DESTROY_MAX_SECS: u64 = 60;
#[cfg(target_os = "macos")]
const HOLD_TO_QUIT_MENU_ID: &str = "hold-to-quit-app";

#[derive(Default)]
pub(crate) struct MainWindowLifecycle {
    inner: Mutex<MainWindowLifecycleState>,
}

#[derive(Default)]
struct MainWindowLifecycleState {
    destroy_generation: u64,
    route: Option<String>,
}

impl MainWindowLifecycle {
    fn schedule_destroy(&self, route: Option<String>) -> u64 {
        let mut state = self.lock();
        state.destroy_generation = state.destroy_generation.wrapping_add(1);
        if route.is_some() {
            state.route = route;
        }
        state.destroy_generation
    }

    fn prepare_show(&self, route: Option<String>) -> u64 {
        let mut state = self.lock();
        state.destroy_generation = state.destroy_generation.wrapping_add(1);
        if route.is_some() {
            state.route = route;
        }
        state.destroy_generation
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, MainWindowLifecycleState> {
        self.inner
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum CloseRequestAction {
    HideMainWindow,
    AllowClose,
}

fn close_request_action(window_label: &str) -> CloseRequestAction {
    if window_label == MAIN_WINDOW_LABEL {
        CloseRequestAction::HideMainWindow
    } else {
        CloseRequestAction::AllowClose
    }
}

#[cfg(target_os = "macos")]
pub(crate) fn configure_macos_hold_to_quit_menu(app: &AppHandle) -> tauri::Result<()> {
    let Some(menu) = app.menu() else {
        return Ok(());
    };
    let Some(MenuItemKind::Submenu(application_menu)) = menu.items()?.into_iter().next() else {
        return Ok(());
    };
    let application_items = application_menu.items()?;
    if application_items.is_empty() {
        return Ok(());
    }

    // 默认菜单末项是直接 terminate: 的 Quit；替换后由原生长按确认流程决定是否退出。
    application_menu.remove_at(application_items.len() - 1)?;
    let quit = MenuItem::with_id(
        app,
        HOLD_TO_QUIT_MENU_ID,
        "退出 CodeAgent",
        true,
        Some("CmdOrCtrl+Q"),
    )?;
    application_menu.append(&quit)
}

pub(crate) fn handle_window_event(window: &Window, event: &WindowEvent) {
    if close_request_action(window.label()) != CloseRequestAction::HideMainWindow {
        return;
    }
    let WindowEvent::CloseRequested { api, .. } = event else {
        return;
    };

    // 先隐藏以即时响应关闭操作，延迟到期后只销毁主 WebView。
    api.prevent_close();
    let _ = window.hide();
    #[cfg(target_os = "macos")]
    let _ = window.app_handle().set_dock_visibility(false);

    let app = window.app_handle().clone();
    let route = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .and_then(|main_window| main_window.url().ok())
        .map(|url| app_route_from_url(&url));
    let generation = app.state::<MainWindowLifecycle>().schedule_destroy(route);
    let entropy = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(generation, |duration| {
            duration.as_nanos() as u64 ^ generation
        });
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(main_window_destroy_delay(entropy)).await;
        destroy_main_window_if_current(&app, generation);
    });
}

pub(crate) fn handle_run_event(event: RunEvent) {
    let RunEvent::ExitRequested { code, api, .. } = event else {
        return;
    };
    // 销毁最后一个隐藏窗口只释放 WebView 资源，后台运行时和托盘必须继续存活。
    if should_keep_background_runtime_alive(code) {
        api.prevent_exit();
    }
}

fn should_keep_background_runtime_alive(exit_code: Option<i32>) -> bool {
    exit_code.is_none()
}

pub(super) fn show_main_window(app: &AppHandle) {
    queue_main_window_restore(app, None);
}

pub(crate) fn show_main_window_at_route(app: &AppHandle, route: String) {
    queue_main_window_restore(app, Some(route));
}

pub(super) fn visible_main_window_route(app: &AppHandle) -> Option<String> {
    let window = app.get_webview_window(MAIN_WINDOW_LABEL)?;
    // 隐藏或最小化窗口不算用户正在查看，后台完成仍应保留待查看气泡。
    if !window.is_visible().ok()? || window.is_minimized().ok()? {
        return None;
    }
    window.url().ok().map(|url| app_route_from_url(&url))
}

fn queue_main_window_restore(app: &AppHandle, route: Option<String>) {
    let generation = app
        .state::<MainWindowLifecycle>()
        .prepare_show(route.clone());
    let app = app.clone();
    // Windows WebView2 不能在同步托盘回调中创建窗口，统一切到异步运行时重建。
    tauri::async_runtime::spawn(async move {
        restore_main_window(&app, generation, route);
    });
}

trait MainWindowFullscreen {
    fn set_fullscreen(&self, fullscreen: bool);
}

impl MainWindowFullscreen for WebviewWindow {
    fn set_fullscreen(&self, fullscreen: bool) {
        let _ = WebviewWindow::set_fullscreen(self, fullscreen);
    }
}

fn reset_main_window_fullscreen(window: &impl MainWindowFullscreen) {
    window.set_fullscreen(false);
}

fn restore_main_window(app: &AppHandle, generation: u64, requested_route: Option<String>) {
    #[cfg(target_os = "macos")]
    let _ = app.set_dock_visibility(true);
    let lifecycle = app.state::<MainWindowLifecycle>();
    let saved_route = {
        let state = lifecycle.lock();
        if state.destroy_generation != generation {
            return;
        }
        state.route.clone()
    };
    let (window, should_navigate) = match app.get_webview_window(MAIN_WINDOW_LABEL) {
        Some(window) => (window, true),
        None => match create_main_window(app, saved_route) {
            Ok(window) => (window, false),
            Err(error) => {
                crate::infrastructure::diagnostics::record_error(
                    "main_window_recreate_failed",
                    error,
                );
                return;
            }
        },
    };

    if should_navigate
        && let Some(route) = requested_route.as_deref()
        && let Err(error) = window.emit(MAIN_WINDOW_NAVIGATE_EVENT, route)
    {
        crate::infrastructure::diagnostics::record_error(
            "main_window_navigation_emit_failed",
            error,
        );
    }

    // 先清除复用窗口的原生全屏状态，避免窗口重新显示后滞留在 macOS 全屏空间。
    reset_main_window_fullscreen(&window);
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();

    let active_route =
        requested_route.or_else(|| window.url().ok().map(|url| app_route_from_url(&url)));
    if let Some(route) = active_route {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            acknowledge_completed_desktop_pet_route(&app, &route).await;
        });
    }
}

fn create_main_window(app: &AppHandle, route: Option<String>) -> tauri::Result<WebviewWindow> {
    let mut config = app
        .config()
        .app
        .windows
        .iter()
        .find(|config| config.label == MAIN_WINDOW_LABEL)
        .cloned()
        .ok_or_else(|| tauri::Error::WindowNotFound)?;
    if let Some(route) = route {
        config.url = WebviewUrl::App(route.into());
    }
    WebviewWindowBuilder::from_config(app, &config)?.build()
}

fn destroy_main_window_if_current(app: &AppHandle, generation: u64) {
    let lifecycle = app.state::<MainWindowLifecycle>();
    let mut state = lifecycle.lock();
    if state.destroy_generation != generation {
        return;
    }
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return;
    };
    if window.is_visible().unwrap_or(true) {
        return;
    }
    if let Ok(route) = window.url() {
        state.route = Some(app_route_from_url(&route));
    }
    if let Err(error) = window.destroy() {
        crate::infrastructure::diagnostics::record_error("main_window_destroy_failed", error);
    }
}

fn main_window_destroy_delay(entropy: u64) -> Duration {
    let range = MAIN_WINDOW_DESTROY_MAX_SECS - MAIN_WINDOW_DESTROY_MIN_SECS + 1;
    Duration::from_secs(MAIN_WINDOW_DESTROY_MIN_SECS + entropy % range)
}

fn app_route_from_url(url: &Url) -> String {
    let mut route = url.path().trim_start_matches('/').to_owned();
    if route.is_empty() {
        route.push_str("index.html");
    }
    if let Some(query) = url.query() {
        route.push('?');
        route.push_str(query);
    }
    if let Some(fragment) = url.fragment() {
        route.push('#');
        route.push_str(fragment);
    }
    route
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    #[derive(Default)]
    struct RecordingWindow {
        fullscreen: Cell<Option<bool>>,
    }

    impl MainWindowFullscreen for RecordingWindow {
        fn set_fullscreen(&self, fullscreen: bool) {
            self.fullscreen.set(Some(fullscreen));
        }
    }

    #[test]
    fn reopening_main_window_resets_fullscreen_before_showing_it() {
        let window = RecordingWindow::default();

        reset_main_window_fullscreen(&window);

        assert_eq!(window.fullscreen.get(), Some(false));
    }

    #[test]
    fn main_window_close_moves_the_app_to_background() {
        assert_eq!(
            close_request_action("main"),
            CloseRequestAction::HideMainWindow
        );
    }

    #[test]
    fn background_runtime_only_survives_implicit_exit_requests() {
        assert!(should_keep_background_runtime_alive(None));
        assert!(!should_keep_background_runtime_alive(Some(0)));
    }

    #[test]
    fn desktop_pet_window_keeps_its_native_close_behavior() {
        assert_eq!(
            close_request_action("desktop-pet"),
            CloseRequestAction::AllowClose
        );
    }

    #[test]
    fn hidden_main_window_destroy_delay_stays_within_configured_range() {
        assert_eq!(main_window_destroy_delay(0), Duration::from_secs(30));
        assert_eq!(main_window_destroy_delay(30), Duration::from_secs(60));
        assert_eq!(main_window_destroy_delay(31), Duration::from_secs(30));
    }

    #[test]
    fn showing_main_window_invalidates_pending_destroy_generation() {
        let lifecycle = MainWindowLifecycle::default();
        let scheduled = lifecycle.schedule_destroy(None);
        lifecycle.prepare_show(None);

        assert_ne!(lifecycle.lock().destroy_generation, scheduled);
    }

    #[test]
    fn latest_requested_route_replaces_the_hidden_route() {
        let lifecycle = MainWindowLifecycle::default();
        lifecycle.schedule_destroy(Some("p/project-a".to_owned()));
        let generation = lifecycle.prepare_show(Some("p/project-a/t/task-a".to_owned()));
        let state = lifecycle.lock();

        assert_eq!(state.destroy_generation, generation);
        assert_eq!(state.route.as_deref(), Some("p/project-a/t/task-a"));
    }

    #[test]
    fn restored_app_route_preserves_path_query_and_fragment() {
        let route = app_route_from_url(
            &Url::parse("tauri://localhost/p/project-a/task/task-a?panel=context#turn-a").unwrap(),
        );

        assert_eq!(route, "p/project-a/task/task-a?panel=context#turn-a");
        assert_eq!(
            app_route_from_url(&Url::parse("tauri://localhost/").unwrap()),
            "index.html"
        );
    }
}
