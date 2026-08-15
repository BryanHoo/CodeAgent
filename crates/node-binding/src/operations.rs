pub mod attachments;
pub mod files;
pub mod git;
pub mod projects;
pub mod provider;
pub mod settings;
pub mod tasks;

use std::str::FromStr;

use code_agent_protocol::{ProjectId, TaskId};

use crate::errors::invalid_input;

pub fn project_id(value: &str) -> napi::Result<ProjectId> {
    ProjectId::from_str(value).map_err(|_| invalid_input("projectId must not be empty"))
}

pub fn task_id(value: &str) -> napi::Result<TaskId> {
    TaskId::from_str(value).map_err(|_| invalid_input("taskId must not be empty"))
}
