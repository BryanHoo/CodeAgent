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
    NSWindowOrderingMode, NSWindowStyleMask,
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

/// 在两个窗口完成 NSPanel 转换后建立原生父子关系，父窗口移动时由 AppKit 同步子窗口。
pub fn attach_child_window(parent: &NSPanel, child: &NSPanel) {
    // SAFETY: 两个 NSPanel 均由应用持有，并在 AppKit 主线程调用。
    unsafe {
        parent.addChildWindow_ordered(child, NSWindowOrderingMode::Above);
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
    let size = NSSize::new(430.0, 82.0);
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
    panel.setHasShadow(false);
    panel.setLevel(NSFloatingWindowLevel);
    panel.setIgnoresMouseEvents(true);
    panel.setHidesOnDeactivate(false);
    panel.setCollectionBehavior(
        NSWindowCollectionBehavior::CanJoinAllSpaces
            | NSWindowCollectionBehavior::FullScreenAuxiliary,
    );

    let background = NSBox::initWithFrame(NSBox::alloc(mtm), frame);
    background.setBoxType(NSBoxType::Custom);
    background.setBorderWidth(0.0);
    background.setTitlePosition(NSTitlePosition::NoTitle);
    background.setCornerRadius(18.0);
    background.setFillColor(&NSColor::colorWithCalibratedWhite_alpha(0.2, 0.78));

    let message = NSTextField::labelWithString(&NSString::from_str("按住 ⌘Q 键即可退出"), mtm);
    message.setFont(Some(&NSFont::boldSystemFontOfSize(24.0)));
    message.setTextColor(Some(&NSColor::whiteColor()));
    message.setAlignment(NSTextAlignment::Center);
    // 文本和背景均由面板内容视图持有，frame 位于固定 HUD 边界内。
    message.setFrame(NSRect::new(
        NSPoint::new(0.0, 24.0),
        NSSize::new(size.width, 32.0),
    ));
    background.addSubview(&message);
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
}
