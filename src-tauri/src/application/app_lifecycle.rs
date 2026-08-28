#[cfg(target_os = "macos")]
use tauri::menu::MenuItemKind;
use tauri::{
    AppHandle, Manager as _, Window, WindowEvent,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

const MAIN_WINDOW_LABEL: &str = "main";
const SHOW_MAIN_MENU_ID: &str = "show-main";
const QUIT_APP_MENU_ID: &str = "quit-app";
#[cfg(target_os = "macos")]
const HOLD_TO_QUIT_MENU_ID: &str = "hold-to-quit-app";
#[cfg(target_os = "macos")]
const MACOS_TRAY_ICON: tauri::image::Image<'_> = tauri::include_image!("./icons/tray-icon.png");

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum CloseRequestAction {
    HideMainWindow,
    AllowClose,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum TrayMenuAction {
    ShowMainWindow,
    QuitApplication,
    #[cfg(target_os = "macos")]
    ConfirmQuitApplication,
    Ignore,
}

fn close_request_action(window_label: &str) -> CloseRequestAction {
    if window_label == MAIN_WINDOW_LABEL {
        CloseRequestAction::HideMainWindow
    } else {
        CloseRequestAction::AllowClose
    }
}

fn tray_menu_action(menu_id: &str) -> TrayMenuAction {
    match menu_id {
        SHOW_MAIN_MENU_ID => TrayMenuAction::ShowMainWindow,
        QUIT_APP_MENU_ID => TrayMenuAction::QuitApplication,
        #[cfg(target_os = "macos")]
        HOLD_TO_QUIT_MENU_ID => TrayMenuAction::ConfirmQuitApplication,
        _ => TrayMenuAction::Ignore,
    }
}

pub(crate) fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    #[cfg(target_os = "macos")]
    configure_macos_hold_to_quit_menu(app)?;

    let show_main =
        MenuItem::with_id(app, SHOW_MAIN_MENU_ID, "打开 CodeAgent", true, None::<&str>)?;
    let quit_app = MenuItem::with_id(app, QUIT_APP_MENU_ID, "退出 CodeAgent", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_main, &quit_app])?;
    let mut tray = TrayIconBuilder::with_id("codeagent-tray")
        .tooltip("CodeAgent")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match tray_menu_action(event.id().as_ref()) {
            TrayMenuAction::ShowMainWindow => show_main_window(app),
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
        // 保留白色背景和品牌配色，避免 template 模式覆盖图标原色。
        tray = tray.icon(MACOS_TRAY_ICON);
    }
    #[cfg(not(target_os = "macos"))]
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

#[cfg(target_os = "macos")]
fn configure_macos_hold_to_quit_menu(app: &AppHandle) -> tauri::Result<()> {
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

    // 拦截主窗口关闭并仅隐藏工作台，让运行时和桌面宠物窗口继续常驻。
    api.prevent_close();
    let _ = window.hide();
    #[cfg(target_os = "macos")]
    let _ = window.app_handle().set_dock_visibility(false);
}

fn show_main_window(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    let _ = app.set_dock_visibility(true);
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return;
    };

    // 恢复时同时处理最小化状态，确保托盘操作始终把工作台带到前台。
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn main_window_close_moves_the_app_to_background() {
        assert_eq!(
            close_request_action("main"),
            CloseRequestAction::HideMainWindow
        );
    }

    #[test]
    fn desktop_pet_windows_keep_their_native_close_behavior() {
        assert_eq!(
            close_request_action("desktop-pet"),
            CloseRequestAction::AllowClose
        );
        assert_eq!(
            close_request_action("desktop-pet-bubbles"),
            CloseRequestAction::AllowClose
        );
    }

    #[test]
    fn tray_menu_actions_are_mapped_without_affecting_unknown_items() {
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
    }
}
