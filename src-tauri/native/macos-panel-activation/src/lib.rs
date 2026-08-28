use objc2::{MainThreadMarker, msg_send, runtime::NSObjectProtocol as _, sel};
use objc2_app_kit::{NSApplication, NSEvent, NSPanel, NSWindowOrderingMode};

const PRIMARY_MOUSE_BUTTON_MASK: usize = 1;

/// 检查 AppKit 的实时按键状态，避免释放事件早于原生拖拽会话启动。
pub fn primary_mouse_button_pressed() -> bool {
    NSEvent::pressedMouseButtons() & PRIMARY_MOUSE_BUTTON_MASK != 0
}

fn panel_can_become_key_window(application_is_active: bool) -> bool {
    application_is_active
}

pub fn application_is_active() -> bool {
    MainThreadMarker::new()
        .is_some_and(|mtm| NSApplication::sharedApplication(mtm).isActive())
}

/// 仅在应用已经位于前台时允许面板获得键盘焦点，避免桌面宠物抢走其他应用的 key window。
pub fn can_become_key_window() -> bool {
    panel_can_become_key_window(application_is_active())
}

/// 补齐动态转换 NSPanel 时缺失的 macOS 防激活标记。
pub fn prevent_activation(panel: &NSPanel) {
    let selector = sel!(_setPreventsActivation:);
    if panel.respondsToSelector(selector) {
        // SAFETY: 已检查 selector，参数签名与 AppKit 的 BOOL setter 一致。
        unsafe {
            let _: () = msg_send![panel, _setPreventsActivation: true];
        }
    }
}

/// 在两个窗口完成 NSPanel 转换后建立原生父子关系，父窗口移动时由 AppKit 同步子窗口。
pub fn attach_child_window(parent: &NSPanel, child: &NSPanel) {
    // SAFETY: 两个 NSPanel 均由应用持有，并在 AppKit 主线程调用。
    unsafe {
        parent.addChildWindow_ordered(child, NSWindowOrderingMode::Above);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn panel_only_accepts_key_focus_when_application_is_active() {
        assert!(!panel_can_become_key_window(false));
        assert!(panel_can_become_key_window(true));
    }
}
