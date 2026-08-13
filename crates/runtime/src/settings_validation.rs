use code_agent_core::{
    AgentMutationErrorCode, CodeAgentError, CodeAgentErrorCode, PortRequestContext,
};
use code_agent_protocol::{AgentTaskSettings, ProjectId, TaskId};
use serde::Serialize;
use serde_json::{Value, json};

use crate::CodeAgentRuntime;

const TEMPORARY_PROJECT_ID: &str = "temporary";
const TEMPORARY_SANDBOX_MODE: &str = "danger-full-access";

impl CodeAgentRuntime {
    pub(super) async fn validate_settings_model(
        &self,
        settings: &Value,
        context: &PortRequestContext,
    ) -> Result<(), CodeAgentError> {
        let model_id = settings["model"].as_str().unwrap_or_default();
        let effort_id = settings["reasoningEffort"].as_str().unwrap_or_default();
        let models = self.ports.provider.models(context).await?;
        let valid = models.data.iter().any(|model| {
            model.id.as_str() == model_id
                && model
                    .supported_reasoning_efforts
                    .iter()
                    .any(|effort| effort.id.as_str() == effort_id)
        });
        if valid {
            return Ok(());
        }
        Err(invalid_input(
            "model and reasoning effort combination is invalid",
        ))
    }

    pub(super) async fn ensure_project_exists(
        &self,
        project_id: &ProjectId,
        context: &PortRequestContext,
    ) -> Result<(), CodeAgentError> {
        if self
            .ports
            .repository
            .read_project(project_id, context)
            .await?
            .is_some()
        {
            return Ok(());
        }
        Err(not_found(
            "project was not found",
            AgentMutationErrorCode::ProjectNotFound,
        ))
    }

    pub(super) async fn ensure_task_belongs_to_project(
        &self,
        project_id: &ProjectId,
        task_id: &TaskId,
        context: &PortRequestContext,
    ) -> Result<(), CodeAgentError> {
        let project = self.project_context(project_id, context).await?;
        let task = project
            .provider
            .read_task(task_id.as_str(), context)
            .await?;
        if task.as_ref().and_then(|value| value["projectId"].as_str()) == Some(project_id.as_str())
        {
            return Ok(());
        }
        Err(not_found(
            "task was not found",
            AgentMutationErrorCode::TaskNotFound,
        ))
    }

    pub(super) async fn validated_task_settings(
        &self,
        project_id: &ProjectId,
        settings: &AgentTaskSettings,
        context: &PortRequestContext,
    ) -> Result<AgentTaskSettings, CodeAgentError> {
        let mut value = serialize(settings)?;
        if project_id.as_str() == TEMPORARY_PROJECT_ID {
            value["sandboxMode"] = json!(TEMPORARY_SANDBOX_MODE);
        }
        self.validate_settings_model(&value, context).await?;
        serde_json::from_value(value).map_err(|error| CodeAgentError::internal(error.to_string()))
    }
}

fn serialize(value: &impl Serialize) -> Result<Value, CodeAgentError> {
    serde_json::to_value(value).map_err(|error| CodeAgentError::internal(error.to_string()))
}

fn invalid_input(message: &'static str) -> CodeAgentError {
    CodeAgentError::new(CodeAgentErrorCode::InvalidInput, message, None)
}

fn not_found(message: &'static str, mutation_code: AgentMutationErrorCode) -> CodeAgentError {
    CodeAgentError::new(CodeAgentErrorCode::NotFound, message, None)
        .with_mutation_code(mutation_code)
}
