mod application;
pub mod domain;
mod infrastructure;

use application::{
    commands::{connect_runtime, start_runtime},
    state::AppState,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let result = tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![connect_runtime, start_runtime])
        .run(tauri::generate_context!());

    if let Err(error) = result {
        eprintln!("failed to run CodeAgent: {error}");
    }
}
