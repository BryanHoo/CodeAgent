fn main() {
    let windows_target = std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows");
    if windows_target {
        // Keep every final Rust target on the same Common Controls activation context.
        let manifest_path = std::path::PathBuf::from(
            std::env::var_os("OUT_DIR").expect("Cargo should provide OUT_DIR"),
        )
        .join("common-controls-v6.manifest");
        std::fs::write(
            &manifest_path,
            include_bytes!("windows-common-controls-v6.manifest"),
        )
        .expect("failed to write Windows application manifest");
        println!("cargo::rustc-link-arg=/MANIFEST:EMBED");
        println!(
            "cargo::rustc-link-arg=/MANIFESTINPUT:{}",
            manifest_path.display()
        );
    }

    // 所有应用命令先进入 ACL 清单；窗口仍需在 capability 中显式授权。
    let app_manifest = tauri_build::AppManifest::new().commands(&[
        "initialize_app_storage",
        "update_app_preferences",
        "list_custom_backgrounds",
        "read_custom_background",
        "update_custom_backgrounds",
        "connect_runtime",
        "start_runtime",
        "inspect_codex_runtime",
        "install_codex_runtime",
        "get_app_info",
        "install_app_update",
        "get_runtime_performance_metrics",
        "get_task_activities",
        "acknowledge_task_activity",
        "release_task_subscription",
        "retain_task_subscription",
        "configure_desktop_pet",
        "get_desktop_pet_state",
        "get_desktop_pet_drag_strategy",
        "get_desktop_pet_position",
        "show_desktop_pet",
        "set_desktop_pet_drag_position",
        "start_desktop_pet_native_drag",
        "move_desktop_pet",
        "layout_desktop_pet",
        "open_desktop_pet_task",
        "get_workbench_background",
        "list_workbench_pets",
        "download_workbench_pet",
        "list_models",
        "get_provider_connection",
        "start_official_provider_login",
        "cancel_provider_login",
        "configure_custom_provider",
        "logout_provider",
        "get_global_settings",
        "update_global_settings",
        "get_project_defaults",
        "update_project_defaults",
        "list_skills",
        "list_mcp_servers",
        "retry_mcp_servers",
        "list_projects",
        "add_project",
        "rename_project",
        "remove_project",
        "reorder_projects",
        "list_project_directories",
        "list_tasks",
        "read_task",
        "start_task",
        "start_turn",
        "steer_turn",
        "interrupt_turn",
        "resolve_pending_request",
        "start_review",
        "compact_task",
        "fork_task",
        "get_task_settings",
        "update_task_settings",
        "update_task_goal",
        "clear_task_goal",
        "upload_feedback",
        "list_background_terminals",
        "terminate_background_terminal",
        "list_queued_submissions",
        "add_queued_submission",
        "update_queued_submission",
        "delete_queued_submission",
        "reorder_queued_submissions",
        "start_queued_submission",
        "list_project_files",
        "search_project_files",
        "stop_project_file_search",
        "rename_project_file",
        "delete_project_file",
        "open_project_file_window",
        "read_project_source_file",
        "get_project_git_status",
        "get_project_git_history",
        "get_project_git_commit_files",
        "get_project_git_commit_file_diff",
        "switch_project_branch",
        "create_project_branch",
        "list_project_worktrees",
        "create_project_worktree",
        "switch_project_worktree",
        "generate_commit_message",
        "commit_project_changes",
        "upload_attachment",
        "import_host_attachment",
        "cache_project_image",
        "list_host_files",
        "get_project_open_capabilities",
        "open_project",
        "open_task_attachment",
        "rename_task",
        "pin_task",
        "archive_task",
        "unarchive_task",
        "delete_task",
    ]);

    let mut attributes = tauri_build::Attributes::new().app_manifest(app_manifest);
    if windows_target {
        attributes = attributes
            .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());
    }
    tauri_build::try_build(attributes).expect("failed to build Tauri application");
}
