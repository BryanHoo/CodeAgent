mod application;
pub mod domain;
mod infrastructure;

use application::{
    commands::{connect_runtime, start_runtime},
    sidebar_commands::{
        add_project, archive_task, delete_task, list_project_directories, list_projects,
        list_tasks, pin_task, read_task, remove_project, rename_project, rename_task,
        reorder_projects, unarchive_task,
    },
    state::AppState,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let result = tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            connect_runtime,
            start_runtime,
            list_projects,
            add_project,
            rename_project,
            remove_project,
            reorder_projects,
            list_project_directories,
            list_tasks,
            read_task,
            rename_task,
            pin_task,
            archive_task,
            unarchive_task,
            delete_task
        ])
        .run(tauri::generate_context!());

    if let Err(error) = result {
        eprintln!("failed to run CodeAgent: {error}");
    }
}
