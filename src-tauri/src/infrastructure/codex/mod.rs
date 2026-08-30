mod auth;
mod catalogs;
mod commit_message;
mod connection;
mod conversation;
mod conversation_advanced;
mod conversation_background;
mod conversation_commands;
mod conversation_delta_events;
mod conversation_events;
mod conversation_file_input;
mod conversation_items;
mod conversation_prompt;
mod conversation_queue;
mod conversation_request_fields;
mod conversation_requests;
mod conversation_runtime_events;
mod generated_image_store;
mod process;
mod protocol;
mod runtime_manager;
mod settings;
mod sidebar;
mod tasks;

#[cfg(test)]
#[path = "auth_tests.rs"]
mod auth_tests;
#[cfg(test)]
#[path = "catalogs_tests.rs"]
mod catalogs_tests;
#[cfg(test)]
#[path = "connection_message_tests.rs"]
mod connection_message_tests;
#[cfg(test)]
#[path = "connection_retry_tests.rs"]
mod connection_retry_tests;
#[cfg(test)]
#[path = "conversation_advanced_tests.rs"]
mod conversation_advanced_tests;
#[cfg(test)]
#[path = "conversation_command_tests.rs"]
mod conversation_command_tests;
#[cfg(test)]
#[path = "conversation_error_tests.rs"]
mod conversation_error_tests;
#[cfg(test)]
#[path = "conversation_item_tests.rs"]
mod conversation_item_tests;
#[cfg(test)]
#[path = "conversation_tests.rs"]
mod conversation_tests;
#[cfg(test)]
#[path = "runtime_manager_tests.rs"]
mod runtime_manager_tests;
#[cfg(test)]
#[path = "settings_tests.rs"]
mod settings_tests;

pub use auth::{
    cancel_provider_login, configure_custom_provider, get_provider_connection,
    list_provider_models, logout_provider, start_official_provider_login,
};
pub use catalogs::{list_mcp_servers, list_skills, reload_mcp_servers};
pub use commit_message::{
    parse_commit_message_output, read_commit_message_settings, start_commit_message_thread,
    start_commit_message_turn,
};
pub(crate) use connection::ConnectionError;
pub use connection::{AppServerConnection, ServerMessage};
pub(crate) use conversation::RUNTIME_SESSION_ID;
pub use conversation::read_task_snapshot;
pub use conversation_advanced::{
    clear_goal, compact_task, fork_task, set_goal_objective, start_review, update_goal,
    upload_feedback,
};
pub use conversation_background::{list_background_terminals, terminate_background_terminal};
pub use conversation_commands::{
    interrupt_turn, resume_task, start_task, start_turn, steer_turn, update_thread_settings,
};
pub use conversation_events::map_server_event_now;
pub use conversation_queue::{
    add_queued_submission, delete_queued_submission, list_queued_submissions,
    reorder_queued_submissions, start_queued_submission, update_queued_submission,
};
pub(crate) use conversation_requests::MappedServerRequest;
pub use conversation_requests::{
    PendingServerRequest, map_server_request_now, resolved_request_id, response_for_resolution,
};
pub use process::CodexProcess;
pub use runtime_manager::{inspect_codex_runtime, install_codex_runtime};
pub use settings::{
    get_global_settings, get_project_defaults, update_global_settings, update_project_defaults,
};
pub use sidebar::{
    add_project, list_projects, read_project, remove_project, rename_project, reorder_projects,
};
pub use tasks::{
    archive_task, delete_task, list_tasks, pin_task, read_task, rename_task, unarchive_task,
    unsubscribe_task,
};
