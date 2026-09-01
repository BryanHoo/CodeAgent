#![cfg_attr(windows, windows_subsystem = "windows")]

fn main() {
    #[cfg(windows)]
    windows_process_platform::initialize_hidden_console();
    codeagent_lib::run();
}
