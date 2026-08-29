use std::{
    ptr::NonNull,
    time::{Duration, Instant},
};

use block2::RcBlock;
use objc2::{
    MainThreadMarker, MainThreadOnly, msg_send, rc::Retained, runtime::NSObjectProtocol as _, sel,
};
use objc2_app_kit::{
    NSApplication, NSBackingStoreType, NSBox, NSBoxType, NSColor, NSEvent, NSEventMask,
    NSEventModifierFlags, NSEventTrackingRunLoopMode, NSEventType, NSFloatingWindowLevel, NSFont,
    NSPanel, NSTextAlignment, NSTextField, NSTitlePosition, NSWindowCollectionBehavior,
    NSWindowStyleMask,
};
use objc2_core_graphics::{CGEventSource, CGEventSourceStateID};
use objc2_foundation::{NSDate, NSPoint, NSRect, NSSize, NSString, NSTimer};

const PRIMARY_MOUSE_BUTTON_MASK: usize = 1;
const COMMAND_Q_KEY_CODE: u16 = 12;
// Chromium 在 1500ms 目标时间上保留 1000ms 判定余量，实际约 500ms 即确认退出。
const HOLD_TO_QUIT_CONFIRM_DELAY: Duration = Duration::from_millis(500);
const HUD_DISMISS_DELAY_SECONDS: f64 = 1.0;
const KEY_EVENT_POLL_SECONDS: f64 = 0.05;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum HoldToQuitAction {
    Wait,
    Cancel,
    Confirm,
    Quit,
}

fn hold_to_quit_action(
    elapsed: Duration,
    key_pressed: bool,
    quit_confirmed: bool,
) -> HoldToQuitAction {
    if !key_pressed {
        if quit_confirmed || elapsed >= HOLD_TO_QUIT_CONFIRM_DELAY {
            HoldToQuitAction::Quit
        } else {
            HoldToQuitAction::Cancel
        }
    } else if !quit_confirmed && elapsed >= HOLD_TO_QUIT_CONFIRM_DELAY {
        HoldToQuitAction::Confirm
    } else {
        HoldToQuitAction::Wait
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct HoldToQuitHudLayout {
    width: f64,
    height: f64,
    corner_radius: f64,
    label_font_size: f64,
    horizontal_padding: f64,
}

const fn hold_to_quit_hud_layout() -> HoldToQuitHudLayout {
    HoldToQuitHudLayout {
        width: 236.0,
        height: 64.0,
        corner_radius: 14.0,
        label_font_size: 15.0,
        horizontal_padding: 24.0,
    }
}

fn command_q_key_pressed() -> bool {
    CGEventSource::key_state(
        CGEventSourceStateID::CombinedSessionState,
        COMMAND_Q_KEY_CODE,
    )
}

fn conceal_application_windows(application: &NSApplication) {
    // 保持应用处于前台继续消费重复 Cmd+Q，仅隐藏视觉内容，避免组合键转发到下一应用。
    for window in application.windows().iter() {
        window.setAlphaValue(0.0);
    }
}

/// 检查 AppKit 的实时按键状态，避免释放事件早于原生拖拽会话启动。
pub fn primary_mouse_button_pressed() -> bool {
    NSEvent::pressedMouseButtons() & PRIMARY_MOUSE_BUTTON_MASK != 0
}

fn panel_can_become_key_window(application_is_active: bool) -> bool {
    application_is_active
}

pub fn application_is_active() -> bool {
    MainThreadMarker::new().is_some_and(|mtm| NSApplication::sharedApplication(mtm).isActive())
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

/// 显示与 Chrome 一致的原生 HUD，确认后等待物理 Q 键释放再退出。
pub fn confirm_hold_to_quit() -> bool {
    let Some(mtm) = MainThreadMarker::new() else {
        return false;
    };
    let application = NSApplication::sharedApplication(mtm);
    let Some(event) = application.currentEvent() else {
        return true;
    };
    if event.r#type() != NSEventType::KeyDown
        || event.keyCode() != COMMAND_Q_KEY_CODE
        || !event
            .modifierFlags()
            .contains(NSEventModifierFlags::Command)
    {
        // 菜单点击和辅助功能触发不要求长按，保持标准“退出”命令语义。
        return true;
    }

    let hud = create_hold_to_quit_hud(mtm);
    let started_at = Instant::now();
    let mut quit_confirmed = false;
    // SAFETY: AppKit 导出的静态 RunLoop mode 在进程生命周期内始终有效。
    let tracking_mode = unsafe { NSEventTrackingRunLoopMode };
    let action = loop {
        let wait_until = NSDate::dateWithTimeIntervalSinceNow(KEY_EVENT_POLL_SECONDS);
        let key_up_event = application.nextEventMatchingMask_untilDate_inMode_dequeue(
            NSEventMask::KeyUp,
            Some(&wait_until),
            tracking_mode,
            true,
        );
        let action = hold_to_quit_action(
            started_at.elapsed(),
            command_q_key_pressed(),
            quit_confirmed,
        );
        match action {
            HoldToQuitAction::Confirm => {
                quit_confirmed = true;
                conceal_application_windows(&application);
            }
            HoldToQuitAction::Wait => {}
            HoldToQuitAction::Cancel | HoldToQuitAction::Quit => {
                // 清除抬键前积压的重复 Cmd+Q，防止退出后继续作用于下一聚焦应用。
                application.discardEventsMatchingMask_beforeEvent(
                    NSEventMask::Any,
                    key_up_event.as_deref(),
                );
                break action;
            }
        }
    };

    match action {
        HoldToQuitAction::Cancel => {
            schedule_hud_dismiss(hud);
            false
        }
        HoldToQuitAction::Quit => {
            hud.orderOut(None);
            true
        }
        HoldToQuitAction::Wait | HoldToQuitAction::Confirm => {
            unreachable!("hold loop only exits after a decision")
        }
    }
}

fn create_hold_to_quit_hud(mtm: MainThreadMarker) -> Retained<NSPanel> {
    let layout = hold_to_quit_hud_layout();
    let size = NSSize::new(layout.width, layout.height);
    let frame = NSRect::new(NSPoint::new(0.0, 0.0), size);
    let panel = NSPanel::initWithContentRect_styleMask_backing_defer(
        NSPanel::alloc(mtm),
        frame,
        NSWindowStyleMask::Borderless | NSWindowStyleMask::NonactivatingPanel,
        NSBackingStoreType::Buffered,
        false,
    );
    // SAFETY: 面板由当前函数和延迟关闭定时器共同持有，不依赖 close 自动释放。
    unsafe { panel.setReleasedWhenClosed(false) };
    panel.setOpaque(false);
    panel.setBackgroundColor(Some(&NSColor::clearColor()));
    panel.setHasShadow(true);
    panel.setLevel(NSFloatingWindowLevel);
    panel.setIgnoresMouseEvents(true);
    panel.setHidesOnDeactivate(false);
    panel.setCollectionBehavior(
        NSWindowCollectionBehavior::CanJoinAllSpaces
            | NSWindowCollectionBehavior::FullScreenAuxiliary,
    );

    let background = NSBox::initWithFrame(NSBox::alloc(mtm), frame);
    background.setBoxType(NSBoxType::Custom);
    background.setBorderWidth(0.5);
    background.setBorderColor(&NSColor::colorWithCalibratedWhite_alpha(1.0, 0.14));
    background.setTitlePosition(NSTitlePosition::NoTitle);
    background.setCornerRadius(layout.corner_radius);
    background.setFillColor(&NSColor::colorWithCalibratedWhite_alpha(0.12, 0.88));

    let label_y = 20.0;
    let label_height = 24.0;
    let leading_width = 38.0;
    let key_cap_x = layout.horizontal_padding + leading_width + 10.0;
    let key_cap_width = 54.0;
    let trailing_x = key_cap_x + key_cap_width + 10.0;
    let trailing_width = layout.width - layout.horizontal_padding - trailing_x;
    let label_color = NSColor::colorWithCalibratedWhite_alpha(1.0, 0.88);

    let leading = NSTextField::labelWithString(&NSString::from_str("按住"), mtm);
    leading.setFont(Some(&NSFont::systemFontOfSize(layout.label_font_size)));
    leading.setTextColor(Some(&label_color));
    leading.setAlignment(NSTextAlignment::Right);
    leading.setFrame(NSRect::new(
        NSPoint::new(layout.horizontal_padding, label_y),
        NSSize::new(leading_width, label_height),
    ));

    // 独立键帽让快捷键成为视觉锚点，同时保留两侧文字的自然阅读顺序。
    let key_cap_frame = NSRect::new(
        NSPoint::new(key_cap_x, 16.0),
        NSSize::new(key_cap_width, 32.0),
    );
    let key_cap = NSBox::initWithFrame(NSBox::alloc(mtm), key_cap_frame);
    key_cap.setBoxType(NSBoxType::Custom);
    key_cap.setBorderWidth(0.5);
    key_cap.setBorderColor(&NSColor::colorWithCalibratedWhite_alpha(1.0, 0.18));
    key_cap.setTitlePosition(NSTitlePosition::NoTitle);
    key_cap.setCornerRadius(7.0);
    key_cap.setFillColor(&NSColor::colorWithCalibratedWhite_alpha(1.0, 0.12));

    let shortcut = NSTextField::labelWithString(&NSString::from_str("⌘ Q"), mtm);
    shortcut.setFont(Some(&NSFont::boldSystemFontOfSize(14.0)));
    shortcut.setTextColor(Some(&NSColor::whiteColor()));
    shortcut.setAlignment(NSTextAlignment::Center);
    shortcut.setFrame(NSRect::new(
        NSPoint::new(0.0, 5.0),
        NSSize::new(key_cap_width, 22.0),
    ));
    key_cap.addSubview(&shortcut);

    let trailing = NSTextField::labelWithString(&NSString::from_str("退出"), mtm);
    trailing.setFont(Some(&NSFont::systemFontOfSize(layout.label_font_size)));
    trailing.setTextColor(Some(&label_color));
    trailing.setAlignment(NSTextAlignment::Left);
    trailing.setFrame(NSRect::new(
        NSPoint::new(trailing_x, label_y),
        NSSize::new(trailing_width, label_height),
    ));

    background.addSubview(&leading);
    background.addSubview(&key_cap);
    background.addSubview(&trailing);
    panel.setContentView(Some(&background));
    panel.center();
    panel.orderFrontRegardless();
    panel
}

fn schedule_hud_dismiss(hud: Retained<NSPanel>) {
    let dismiss = RcBlock::new(move |_: NonNull<NSTimer>| hud.orderOut(None));
    // SAFETY: 定时器固定调度到当前 AppKit 主线程的默认 RunLoop，闭包只访问该线程的面板。
    let _ = unsafe {
        NSTimer::scheduledTimerWithTimeInterval_repeats_block(
            HUD_DISMISS_DELAY_SECONDS,
            false,
            &dismiss,
        )
    };
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn panel_only_accepts_key_focus_when_application_is_active() {
        assert!(!panel_can_become_key_window(false));
        assert!(panel_can_become_key_window(true));
    }

    #[test]
    fn hold_to_quit_confirms_quickly_but_waits_for_key_release() {
        assert_eq!(
            hold_to_quit_action(Duration::from_millis(499), false, false),
            HoldToQuitAction::Cancel
        );
        assert_eq!(
            hold_to_quit_action(Duration::from_millis(500), true, false),
            HoldToQuitAction::Confirm
        );
        assert_eq!(
            hold_to_quit_action(Duration::from_millis(1_500), true, true),
            HoldToQuitAction::Wait
        );
        assert_eq!(
            hold_to_quit_action(Duration::from_millis(1_500), false, true),
            HoldToQuitAction::Quit
        );
    }

    #[test]
    fn hold_to_quit_hud_uses_compact_proportions() {
        let layout = hold_to_quit_hud_layout();

        assert_eq!((layout.width, layout.height), (236.0, 64.0));
        assert!((3.5..=4.0).contains(&(layout.width / layout.height)));
        assert_eq!(layout.corner_radius, 14.0);
        assert_eq!(layout.label_font_size, 15.0);
        assert_eq!(layout.horizontal_padding, 24.0);
    }
}
