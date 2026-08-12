mod asset_protocol;
mod command_error;
mod commands;
mod platform_adapters;

use std::{path::PathBuf, sync::Arc, time::Duration};

use code_agent_core::{
    AttachmentPort, ClockPort, FilePort, GitPort, ProviderPort, RepositoryPort, UpdatePort,
};
use code_agent_platform::{
    AttachmentStore, DatabaseOptions, GitCliService, PlatformDatabase, PlatformFilePort,
    SqliteRepository,
};
use code_agent_runtime::{CodeAgentRuntime, CodeAgentRuntimeBuilder, RuntimeOptions};
use tauri::Manager;

use platform_adapters::DesktopHostPorts;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let application = tauri::Builder::default()
        .setup(|app| {
            let data_root = desktop_data_root(app)?;
            std::fs::create_dir_all(&data_root)?;
            let database = PlatformDatabase::open(DatabaseOptions {
                path: data_root.join("state.sqlite3"),
                queue_capacity: 64,
                request_timeout: Duration::from_secs(5),
            })?;
            let repository: Arc<dyn RepositoryPort> =
                Arc::new(SqliteRepository::new(database.clone()));
            let file: Arc<dyn FilePort> = Arc::new(PlatformFilePort::new(database.clone()));
            let git: Arc<dyn GitPort> = Arc::new(GitCliService::new(database));
            let attachment: Arc<dyn AttachmentPort> = Arc::new(tauri::async_runtime::block_on(
                AttachmentStore::new(data_root.join("attachments")),
            )?);
            let host = Arc::new(DesktopHostPorts);
            let provider: Arc<dyn ProviderPort> = host.clone();
            let clock: Arc<dyn ClockPort> = host.clone();
            let update: Arc<dyn UpdatePort> = host;
            let runtime = CodeAgentRuntimeBuilder::new(RuntimeOptions {
                idempotency_capacity: 1_024,
                idempotency_ttl: Duration::from_secs(30 * 60),
                operation_capacity: 256,
                shutdown_timeout: Duration::from_secs(10),
            })
            .repository(repository)
            .provider(provider)
            .git(git)
            .file(file)
            .attachment(attachment)
            .clock(clock)
            .update(update)
            .build();
            app.manage(Arc::new(runtime));
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
            commands::app::cancel_operation,
            commands::attachments::attachment_import_host,
            commands::attachments::attachment_open,
            commands::attachments::attachment_upload,
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
            commands::git::git_commit_diff,
            commands::git::git_commit_files,
            commands::git::git_history,
            commands::git::git_status,
            commands::projects::project_add,
            commands::projects::project_list,
            commands::projects::project_remove,
            commands::projects::project_rename,
            commands::projects::project_reorder,
            commands::provider::provider_connection_get,
            commands::settings::global_settings_get,
            commands::settings::global_settings_update,
            commands::settings::project_defaults_get,
            commands::settings::project_defaults_update,
            commands::settings::task_settings_get,
            commands::settings::task_settings_update,
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
            let runtime = app.state::<Arc<CodeAgentRuntime>>().inner().clone();
            if let Err(error) = tauri::async_runtime::block_on(runtime.shutdown()) {
                eprintln!("CodeAgent Desktop failed to shut down cleanly: {error}");
            }
        }
    });
}

fn desktop_data_root<R: tauri::Runtime>(
    app: &tauri::App<R>,
) -> Result<PathBuf, Box<dyn std::error::Error>> {
    if let Some(codex_home) = std::env::var_os("CODEX_HOME") {
        return Ok(PathBuf::from(codex_home).join("code-agent"));
    }
    Ok(app.path().app_data_dir()?.join("code-agent"))
}
