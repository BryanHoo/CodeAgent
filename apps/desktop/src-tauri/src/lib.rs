mod command_error;
mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let result = tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::app::access_status,
            commands::app::app_diagnostics,
            commands::app::app_info,
            commands::app::cancel_operation,
        ])
        .run(tauri::generate_context!());
    if let Err(error) = result {
        eprintln!("CodeAgent Desktop failed to start: {error}");
        std::process::exit(1);
    }
}
