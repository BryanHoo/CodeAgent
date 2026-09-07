use super::state::AppState;
use crate::domain::project_terminal::TerminalError;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};
use tauri::{AppHandle, Manager, WebviewWindow, Window, WindowEvent};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

#[derive(Default)]
pub(crate) struct TerminalLifecycle {
    owner: Mutex<Option<Arc<WindowOwner>>>,
    exiting: AtomicBool,
}

#[derive(Default)]
struct WindowOwner {
    generation: Mutex<String>,
    closing: AtomicBool,
}

impl TerminalLifecycle {
    fn owner(&self) -> Option<Arc<WindowOwner>> {
        self.owner
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }
    pub fn is_closing(&self) -> bool {
        self.exiting.load(Ordering::Acquire)
            || self
                .owner()
                .is_some_and(|owner| owner.closing.load(Ordering::Acquire))
    }
    pub fn bind_generation(&self, generation: &str) {
        if let Some(owner) = self.owner() {
            *owner
                .generation
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner) = generation.to_owned();
        }
    }
}

pub(crate) fn bind_window(app: &AppHandle, window: &WebviewWindow) {
    let manager = app.state::<AppState>().terminals.clone();
    let owner = Arc::new(WindowOwner {
        generation: Mutex::new(manager.generation()),
        ..WindowOwner::default()
    });
    *app.state::<TerminalLifecycle>()
        .owner
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(owner.clone());
    // 每个原生窗口捕获独立 owner；重建窗口后，旧 Destroyed 回调不会读取新窗口的 generation。
    window.on_window_event(move |event| {
        if matches!(event, WindowEvent::Destroyed) {
            let generation = owner
                .generation
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .clone();
            let manager = manager.clone();
            tauri::async_runtime::spawn_blocking(move || {
                if let Err(error) = manager.close_generation(&generation) {
                    crate::infrastructure::diagnostics::record_error(
                        "terminal_owner_cleanup_failed",
                        error,
                    );
                }
            });
        }
    });
}

pub(crate) fn resume_owner(app: &AppHandle) {
    let manager = &app.state::<AppState>().terminals;
    if !app.state::<TerminalLifecycle>().is_closing() && manager.live_count() == 0 {
        manager.set_closing(false);
    }
}

pub(crate) fn request_close(window: &Window) -> bool {
    let app = window.app_handle();
    let manager = app.state::<AppState>().terminals.clone();
    if manager.live_count() == 0 {
        return false;
    }
    let Some(owner) = app.state::<TerminalLifecycle>().owner() else {
        return true;
    };
    if owner.closing.swap(true, Ordering::AcqRel) {
        return true;
    }
    let generation = manager.generation();
    manager.set_closing(true);
    let app = app.clone();
    app.dialog()
        .message("关闭窗口将结束所有本地终端及其运行中的程序。")
        // 绑定发起关闭的原生窗口，避免 macOS 使用脱离应用窗口的系统级提示。
        .parent(window)
        .title("结束本地终端？")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "结束并关闭".into(),
            "取消".into(),
        ))
        .show(move |confirmed| {
            if !confirmed {
                if manager.generation() == generation
                    && !app
                        .state::<TerminalLifecycle>()
                        .exiting
                        .load(Ordering::Acquire)
                {
                    manager.set_closing(false);
                }
                owner.closing.store(false, Ordering::Release);
                return;
            }
            tauri::async_runtime::spawn(async move {
                let cleanup = manager.clone();
                let closing_generation = generation.clone();
                let result = tauri::async_runtime::spawn_blocking(move || {
                    cleanup.close_generation(&closing_generation)
                })
                .await;
                if matches!(result, Ok(Ok(()))) && manager.generation() == generation {
                    if let Some(window) = app.get_webview_window("main") {
                        super::app_lifecycle::hide_main_window(&window.as_ref().window());
                    }
                } else if !matches!(result, Ok(Ok(()))) {
                    report_cleanup_failure(&app);
                }
                owner.closing.store(false, Ordering::Release);
            });
        });
    true
}

pub(crate) fn request_exit(app: &AppHandle, code: i32) -> bool {
    let manager = app.state::<AppState>().terminals.clone();
    if manager.live_count() == 0 {
        return false;
    }
    if app
        .state::<TerminalLifecycle>()
        .exiting
        .swap(true, Ordering::AcqRel)
    {
        return true;
    }
    manager.set_closing(true);
    let generation = manager.generation();
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let result =
            tauri::async_runtime::spawn_blocking(move || manager.close_generation(&generation))
                .await;
        if matches!(result, Ok(Ok(()))) {
            app.exit(code);
        } else {
            app.state::<TerminalLifecycle>()
                .exiting
                .store(false, Ordering::Release);
            report_cleanup_failure(&app);
        }
    });
    true
}

fn report_cleanup_failure(app: &AppHandle) {
    crate::infrastructure::diagnostics::record_error(
        "terminal_cleanup_failed",
        TerminalError::CleanupFailed,
    );
    app.dialog()
        .message("本地终端未能完成清理，窗口和应用将保持打开。请重试关闭。")
        .title("终端清理失败")
        .kind(MessageDialogKind::Error)
        .show(|_| {});
}
