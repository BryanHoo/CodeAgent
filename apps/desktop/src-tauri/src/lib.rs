#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let result = tauri::Builder::default().run(tauri::generate_context!());
    if let Err(error) = result {
        eprintln!("CodeAgent Desktop failed to start: {error}");
        std::process::exit(1);
    }
}
