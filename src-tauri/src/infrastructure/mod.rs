pub mod app_storage;
pub mod codex;
pub mod diagnostics;
pub mod filesystem;
pub mod local_settings;
pub mod provider_models;
pub mod scheduled_tasks;
pub mod skills_market;
pub mod task_settings;
pub mod workspace;

#[cfg(test)]
#[path = "task_settings_tests.rs"]
mod task_settings_tests;

#[cfg(test)]
#[path = "app_storage_tests.rs"]
mod app_storage_tests;

#[cfg(test)]
#[path = "local_settings_tests.rs"]
mod local_settings_tests;

#[cfg(test)]
#[path = "provider_models_tests.rs"]
mod provider_models_tests;

#[cfg(test)]
#[path = "scheduled_tasks_tests.rs"]
mod scheduled_tasks_tests;
