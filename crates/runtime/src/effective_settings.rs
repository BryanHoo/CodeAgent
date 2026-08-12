use code_agent_core::{CodeAgentError, PortRequestContext};
use code_agent_protocol::{AgentGlobalSettings, AgentModelPage, AgentProjectDefaults, ProjectId};
use serde_json::{Map, Value, json};

use crate::CodeAgentRuntime;

impl CodeAgentRuntime {
    /// 返回可直接用于界面的全局设置；首次运行时继承 Codex 用户配置，不隐式写库。
    pub async fn effective_global_settings(
        &self,
        request_id: &str,
    ) -> Result<AgentGlobalSettings, CodeAgentError> {
        let context = self.begin_operation(request_id).await?;
        let result = self.resolve_global_settings(&context).await;
        self.finish_operation(request_id).await;
        result
    }

    /// 返回 Project 的有效默认设置；本地记录缺失时继承当前有效全局设置。
    pub async fn effective_project_defaults(
        &self,
        request_id: &str,
        project_id: &ProjectId,
    ) -> Result<AgentProjectDefaults, CodeAgentError> {
        let context = self.begin_operation(request_id).await?;
        let result = async {
            if let Some(stored) = self
                .ports
                .repository
                .read_project_defaults(project_id, &context)
                .await?
            {
                return Ok(stored);
            }
            let global = self.resolve_global_settings(&context).await?;
            let requested = serde_json::to_value(global)
                .map_err(|error| CodeAgentError::internal(error.to_string()))?;
            resolve_project_defaults(&self.ports.provider.models(&context).await?, &requested)
        }
        .await;
        self.finish_operation(request_id).await;
        result
    }

    async fn resolve_global_settings(
        &self,
        context: &PortRequestContext,
    ) -> Result<AgentGlobalSettings, CodeAgentError> {
        if let Some(stored) = self.ports.repository.read_global_settings(context).await? {
            return Ok(stored);
        }
        let defaults = self.ports.provider.default_settings(context).await?;
        let config = defaults.get("config").unwrap_or(&defaults);
        let project_defaults =
            resolve_project_defaults(&self.ports.provider.models(context).await?, config)?;
        let project_value = serde_json::to_value(&project_defaults)
            .map_err(|error| CodeAgentError::internal(error.to_string()))?;
        let approvals_reviewer = supported_string(config, "approvals_reviewer")
            .filter(|value| *value == "auto_review")
            .unwrap_or("user");
        let approval_policy = if approvals_reviewer == "auto_review" {
            "on-request"
        } else {
            supported_string(config, "approval_policy")
                .filter(|value| matches!(*value, "untrusted" | "on-request" | "never"))
                .unwrap_or("on-request")
        };
        serde_json::from_value(json!({
            "approvalPolicy": approval_policy,
            "approvalsReviewer": approvals_reviewer,
            "commitMessageModel": project_value["model"],
            "commitMessagePrompt": "",
            "commitMessageReasoningEffort": project_value["reasoningEffort"],
            "defaultOpenAppId": null,
            "followUpBehavior": "queue",
            "model": project_value["model"],
            "reasoningEffort": project_value["reasoningEffort"],
            "sandboxMode": project_value["sandboxMode"]
        }))
        .map_err(|error| CodeAgentError::internal(error.to_string()))
    }
}

fn resolve_project_defaults(
    models: &AgentModelPage,
    requested: &Value,
) -> Result<AgentProjectDefaults, CodeAgentError> {
    let requested = requested.as_object().cloned().unwrap_or_default();
    let mut models = models.data.iter().collect::<Vec<_>>();
    models.sort_by(|left, right| left.id.as_str().cmp(right.id.as_str()));
    let requested_model = read_setting(&requested, "model");
    let model = models
        .iter()
        .copied()
        .find(|model| Some(model.id.as_str()) == requested_model)
        .or_else(|| models.iter().copied().find(|model| model.is_default))
        .or_else(|| models.first().copied())
        .ok_or_else(|| CodeAgentError::internal("No Agent models are available"))?;

    let mut efforts = model.supported_reasoning_efforts.iter().collect::<Vec<_>>();
    efforts.sort_by(|left, right| left.id.as_str().cmp(right.id.as_str()));
    let requested_effort = read_setting(&requested, "reasoningEffort")
        .or_else(|| read_setting(&requested, "model_reasoning_effort"));
    let effort = efforts
        .iter()
        .copied()
        .find(|effort| Some(effort.id.as_str()) == requested_effort)
        .or_else(|| {
            efforts
                .iter()
                .copied()
                .find(|effort| effort.id.as_str() == model.default_reasoning_effort.as_str())
        })
        .or_else(|| efforts.first().copied())
        .ok_or_else(|| {
            CodeAgentError::internal("The selected Agent model has no reasoning effort")
        })?;
    let sandbox_mode = read_setting(&requested, "sandboxMode")
        .or_else(|| read_setting(&requested, "sandbox_mode"))
        .filter(|value| {
            matches!(
                *value,
                "read-only" | "workspace-write" | "danger-full-access"
            )
        })
        .unwrap_or("workspace-write");

    serde_json::from_value(json!({
        "model": model.id.as_str(),
        "reasoningEffort": effort.id.as_str(),
        "sandboxMode": sandbox_mode
    }))
    .map_err(|error| CodeAgentError::internal(error.to_string()))
}

fn read_setting<'a>(settings: &'a Map<String, Value>, key: &str) -> Option<&'a str> {
    settings
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
}

fn supported_string<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
}
