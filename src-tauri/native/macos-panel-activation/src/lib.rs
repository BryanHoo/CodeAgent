use objc2::{msg_send, runtime::NSObjectProtocol as _, sel};
use objc2_app_kit::NSPanel;

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
