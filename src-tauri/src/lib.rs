#[cfg(all(target_os = "macos", not(target_arch = "aarch64")))]
compile_error!("CodeAgent only supports aarch64-apple-darwin on macOS");

mod application;
pub mod domain;
mod infrastructure;

use application::{
    app_lifecycle::{MainWindowLifecycle, handle_window_event, setup_tray},
    app_storage_commands::{
        initialize_app_storage, list_custom_backgrounds, read_custom_background,
        update_app_preferences, update_custom_backgrounds,
    },
    attachment_commands::{
        cache_project_image, import_host_attachment, list_host_files, upload_attachment,
    },
    background_commands::get_workbench_background,
    catalog_commands::{
        cancel_provider_login, configure_custom_provider, get_global_settings,
        get_project_defaults, get_provider_connection, list_mcp_servers, list_models, list_skills,
        logout_provider, retry_mcp_servers, start_official_provider_login, update_global_settings,
        update_project_defaults,
    },
    commands::{
        cancel_native_request, connect_runtime, get_app_info, get_runtime_performance_metrics,
        inspect_codex_runtime, install_codex_runtime, start_runtime,
    },
    desktop_pet_commands::{
        DesktopPetRuntime, get_desktop_pet_drag_strategy, get_desktop_pet_position,
        get_desktop_pet_state, layout_desktop_pet, move_desktop_pet, open_desktop_pet_task,
        set_desktop_pet_drag_position, show_desktop_pet, start_desktop_pet_native_drag,
        sync_desktop_pet,
    },
    notification_commands::show_task_notification,
    open_commands::{get_project_open_capabilities, open_project, open_task_attachment},
    pet_commands::{download_workbench_pet, list_workbench_pets},
    sidebar_commands::{
        add_project, archive_task, compact_task, delete_task, fork_task, get_task_settings,
        interrupt_turn, list_projects, list_tasks, pin_task, read_task, remove_project,
        rename_project, rename_task, reorder_projects, resolve_pending_request, start_review,
        start_task, start_turn, steer_turn, unarchive_task, unsubscribe_task, update_task_settings,
    },
    sidebar_directory_commands::list_project_directories,
    state::AppState,
    workflow_commands::{
        add_queued_submission, clear_task_goal, delete_queued_submission,
        list_background_terminals, list_queued_submissions, reorder_queued_submissions,
        start_queued_submission, terminate_background_terminal, update_queued_submission,
        update_task_goal, upload_feedback,
    },
    workspace_commands::{
        commit_project_changes, create_project_branch, create_project_worktree,
        delete_project_file, generate_commit_message, get_project_git_commit_file_diff,
        get_project_git_commit_files, get_project_git_history, get_project_git_status,
        list_project_files, list_project_worktrees, read_project_source_file, rename_project_file,
        search_project_files, stop_project_file_search, switch_project_branch,
        switch_project_worktree,
    },
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_nspanel::init());
    #[cfg(all(debug_assertions, feature = "webview-tests"))]
    let builder = builder
        .plugin(tauri_plugin_wdio::init())
        .plugin(tauri_plugin_wdio_webdriver::init());
    let result = builder
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::default())
        .manage(DesktopPetRuntime::default())
        .manage(MainWindowLifecycle::default())
        .setup(|app| setup_tray(app.handle()).map_err(Into::into))
        .on_window_event(handle_window_event)
        .invoke_handler(tauri::generate_handler![
            initialize_app_storage,
            update_app_preferences,
            list_custom_backgrounds,
            read_custom_background,
            update_custom_backgrounds,
            connect_runtime,
            start_runtime,
            inspect_codex_runtime,
            install_codex_runtime,
            cancel_native_request,
            get_app_info,
            get_runtime_performance_metrics,
            sync_desktop_pet,
            get_desktop_pet_state,
            get_desktop_pet_drag_strategy,
            get_desktop_pet_position,
            show_desktop_pet,
            set_desktop_pet_drag_position,
            start_desktop_pet_native_drag,
            move_desktop_pet,
            layout_desktop_pet,
            open_desktop_pet_task,
            show_task_notification,
            get_workbench_background,
            list_workbench_pets,
            download_workbench_pet,
            list_models,
            get_provider_connection,
            start_official_provider_login,
            cancel_provider_login,
            configure_custom_provider,
            logout_provider,
            get_global_settings,
            update_global_settings,
            get_project_defaults,
            update_project_defaults,
            list_skills,
            list_mcp_servers,
            retry_mcp_servers,
            list_projects,
            add_project,
            rename_project,
            remove_project,
            reorder_projects,
            list_project_directories,
            list_tasks,
            read_task,
            start_task,
            start_turn,
            steer_turn,
            interrupt_turn,
            resolve_pending_request,
            start_review,
            compact_task,
            fork_task,
            get_task_settings,
            update_task_settings,
            update_task_goal,
            clear_task_goal,
            upload_feedback,
            list_background_terminals,
            terminate_background_terminal,
            list_queued_submissions,
            add_queued_submission,
            update_queued_submission,
            delete_queued_submission,
            reorder_queued_submissions,
            start_queued_submission,
            list_project_files,
            search_project_files,
            stop_project_file_search,
            rename_project_file,
            delete_project_file,
            read_project_source_file,
            get_project_git_status,
            get_project_git_history,
            get_project_git_commit_files,
            get_project_git_commit_file_diff,
            switch_project_branch,
            create_project_branch,
            list_project_worktrees,
            create_project_worktree,
            switch_project_worktree,
            generate_commit_message,
            commit_project_changes,
            upload_attachment,
            import_host_attachment,
            cache_project_image,
            list_host_files,
            get_project_open_capabilities,
            open_project,
            open_task_attachment,
            rename_task,
            pin_task,
            archive_task,
            unarchive_task,
            unsubscribe_task,
            delete_task
        ])
        .run(tauri::generate_context!());

    if let Err(error) = result {
        eprintln!("failed to run CodeAgent: {error}");
    }
}
