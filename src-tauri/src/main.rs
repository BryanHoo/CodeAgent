#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "linux")]
    desktop_pet_platform::prepare_linux_window_backend();
    codeagent_lib::run();
}
