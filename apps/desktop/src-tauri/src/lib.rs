mod asset_protocol;
mod command_error;
mod commands;
mod lifecycle;
mod platform_adapters;
mod process_environment;

use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use code_agent_core::{
    AttachmentPort, ClockPort, FilePort, GitPort, ProviderPort, RepositoryPort, UpdatePort,
};
use code_agent_platform::{
    AttachmentStore, DatabaseOptions, GitCliService, PlatformDatabase, PlatformFilePort,
    ProcessEnvironment, SqliteRepository,
};
use code_agent_runtime::{CodeAgentRuntime, CodeAgentRuntimeBuilder, RuntimeOptions};
use tauri::{
    Manager, Runtime,
    plugin::{Builder as PluginBuilder, TauriPlugin},
};

use lifecycle::DesktopLifecycle;
use platform_adapters::{
    CodexSupervisor, DesktopHostPorts, DesktopProvider, start_codex_supervisor,
};
use process_environment::{immediate_process_path, resolved_process_path};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let application = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(
            |app, _arguments, _cwd| {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            },
        ))
        .plugin(navigation_guard_plugin())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let codex_home = codex_home(app)?;
            let data_root = code_agent_data_root(&app.path().home_dir()?);
            std::fs::create_dir_all(&data_root)?;
            let temporary_project_root = data_root.join("temporary-workspace");
            std::fs::create_dir_all(&temporary_project_root)?;
            let database = PlatformDatabase::open_deferred(DatabaseOptions {
                path: data_root.join("state.sqlite3"),
                queue_capacity: 64,
                request_timeout: Duration::from_secs(5),
            })?;
            let repository: Arc<dyn RepositoryPort> =
                Arc::new(SqliteRepository::new(database.clone()));
            let host_process_path = immediate_process_path();
            let host_environment = ProcessEnvironment::capture_with_path(host_process_path.clone());
            let background_host_environment = host_environment.clone();
            let file: Arc<dyn FilePort> = Arc::new(PlatformFilePort::new(
                database.clone(),
                host_environment.clone(),
            ));
            let git: Arc<dyn GitPort> = Arc::new(GitCliService::new(database, host_environment));
            let attachment: Arc<dyn AttachmentPort> =
                Arc::new(AttachmentStore::new(data_root.join("attachments"))?);
            let host = Arc::new(DesktopHostPorts);
            let provider_slot = Arc::new(DesktopProvider::default());
            let provider: Arc<dyn ProviderPort> = provider_slot.clone();
            let clock: Arc<dyn ClockPort> = host.clone();
            let update: Arc<dyn UpdatePort> = host;
            let runtime = CodeAgentRuntimeBuilder::new(RuntimeOptions {
                idempotency_capacity: 1_024,
                idempotency_ttl: Duration::from_secs(30 * 60),
                operation_capacity: 256,
                shutdown_timeout: Duration::from_secs(10),
                temporary_project_root: Some(temporary_project_root),
            })
            .repository(repository)
            .provider(provider)
            .git(git)
            .file(file)
            .attachment(attachment)
            .clock(clock)
            .update(update)
            .build();
            let supervisor = Arc::new(CodexSupervisor::default());
            app.manage(Arc::new(runtime));
            let runtime = app.state::<Arc<CodeAgentRuntime>>().inner().clone();
            app.manage(provider_slot.clone());
            app.manage(supervisor.clone());
            app.manage(Arc::new(DesktopLifecycle::new(runtime, supervisor.clone())));

            // Provider 启动失败只更新诊断，不能阻塞主窗口创建。
            let resource_directory = app.path().resource_dir()?;
            tauri::async_runtime::spawn(async move {
                let host_process_path = resolved_process_path().await;
                background_host_environment.replace_path(host_process_path.clone());
                start_codex_supervisor(
                    provider_slot,
                    supervisor,
                    env!("CARGO_PKG_VERSION").to_owned(),
                    resource_directory,
                    codex_home,
                    host_process_path,
                )
                .await;
            });
            Ok(())
        })
        .register_asynchronous_uri_scheme_protocol(
            "codeagent-asset",
            asset_protocol::handle_asset_request,
        )
        .invoke_handler(tauri::generate_handler![
            commands::app::access_status,
            commands::app::app_diagnostics,
            commands::app::app_info,
            commands::app::app_update_install,
            commands::app::cancel_operation,
            commands::attachments::attachment_import_host,
            commands::attachments::attachment_open,
            commands::attachments::attachment_upload,
            commands::events::event_subscribe,
            commands::events::event_unsubscribe,
            commands::files::file_search,
            commands::files::file_source_read,
            commands::files::file_tree,
            commands::files::host_files_list,
            commands::files::project_directories_list,
            commands::files::project_open,
            commands::files::project_open_capabilities,
            commands::git::git_branch_create,
            commands::git::git_branch_switch,
            commands::git::git_commit,
            commands::git::git_commit_message_generate,
            commands::git::git_commit_diff,
            commands::git::git_commit_files,
            commands::git::git_history,
            commands::git::git_status,
            commands::host::host_external_url_open,
            commands::host::host_notification_show,
            commands::projects::project_add,
            commands::projects::project_list,
            commands::projects::project_remove,
            commands::projects::project_rename,
            commands::projects::project_reorder,
            commands::provider::capabilities_get,
            commands::provider::models_list,
            commands::provider::provider_connection_get,
            commands::provider::provider_custom_configure,
            commands::provider::provider_login_cancel,
            commands::provider::provider_login_start,
            commands::provider::provider_logout,
            commands::provider::skills_list,
            commands::settings::global_settings_get,
            commands::settings::global_settings_update,
            commands::settings::project_defaults_get,
            commands::settings::project_defaults_update,
            commands::settings::task_settings_get,
            commands::settings::task_settings_update,
            commands::tasks::feedback_upload,
            commands::tasks::mcp_servers_list,
            commands::tasks::mcp_servers_retry,
            commands::tasks::task_archive,
            commands::tasks::task_compact,
            commands::tasks::task_fork,
            commands::tasks::task_list,
            commands::tasks::task_pin,
            commands::tasks::task_read,
            commands::tasks::task_rename,
            commands::tasks::task_review,
            commands::tasks::task_start,
            commands::tasks::task_unsubscribe,
            commands::tasks::terminal_terminate,
            commands::tasks::terminals_list,
            commands::turns::pending_request_resolve,
            commands::turns::turn_interrupt,
            commands::turns::turn_start,
            commands::turns::turn_steer,
        ])
        .build(tauri::generate_context!());
    let application = match application {
        Ok(application) => application,
        Err(error) => {
            eprintln!("CodeAgent Desktop failed to build: {error}");
            std::process::exit(1);
        }
    };
    application.run(|app, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            let lifecycle = app.state::<Arc<DesktopLifecycle>>().inner().clone();
            tauri::async_runtime::block_on(lifecycle.shutdown());
        }
    });
}

fn navigation_guard_plugin<R: Runtime>() -> TauriPlugin<R> {
    PluginBuilder::new("navigation-guard")
        .on_navigation(|_, url| allowed_navigation(url))
        .build()
}

fn allowed_navigation(url: &tauri::Url) -> bool {
    let host = url.host_str();
    if url.scheme() == "tauri" && host == Some("localhost") {
        return true;
    }
    if url.scheme() == "http" && host == Some("tauri.localhost") {
        return true;
    }
    cfg!(debug_assertions)
        && url.scheme() == "http"
        && host == Some("127.0.0.1")
        && url.port() == Some(5173)
}

fn code_agent_data_root(home: &Path) -> PathBuf {
    // 自有数据不跟随 CODEX_HOME，避免 CLI 与 Desktop 启动时打开不同状态目录。
    home.join(".code-agent")
}

fn codex_home<R: tauri::Runtime>(
    app: &tauri::App<R>,
) -> Result<PathBuf, Box<dyn std::error::Error>> {
    Ok(std::env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .unwrap_or(app.path().home_dir()?.join(".codex")))
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::{allowed_navigation, code_agent_data_root};

    #[test]
    fn code_agent_data_root_is_hidden_directory_under_user_home() {
        let home = Path::new("user-home");

        assert_eq!(code_agent_data_root(home), home.join(".code-agent"));
    }

    #[test]
    fn navigation_guard_rejects_remote_origins() {
        assert!(allowed_navigation(
            &"tauri://localhost/".parse().expect("valid URL")
        ));
        assert!(allowed_navigation(
            &"http://tauri.localhost/".parse().expect("valid URL")
        ));
        assert!(!allowed_navigation(
            &"https://example.com/".parse().expect("valid URL")
        ));
        assert!(!allowed_navigation(
            &"file:///tmp/index.html".parse().expect("valid URL")
        ));
    }
}
