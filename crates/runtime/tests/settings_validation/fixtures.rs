use std::{sync::Arc, time::Duration};

use code_agent_protocol::{AgentGlobalSettings, AgentProjectDefaults, AgentTaskSettings};
use code_agent_runtime::{CodeAgentRuntime, CodeAgentRuntimeBuilder, RuntimeOptions};
use serde_json::json;

use super::FakePorts;

pub fn runtime() -> (Arc<FakePorts>, CodeAgentRuntime) {
    let ports = Arc::new(FakePorts::default());
    let runtime = CodeAgentRuntimeBuilder::new(RuntimeOptions {
        idempotency_capacity: 16,
        idempotency_ttl: Duration::from_secs(60),
        operation_capacity: 16,
        shutdown_timeout: Duration::from_secs(1),
        temporary_project_root: None,
    })
    .repository(ports.clone())
    .provider(ports.clone())
    .git(ports.clone())
    .file(ports.clone())
    .attachment(ports.clone())
    .clock(ports.clone())
    .update(ports.clone())
    .build();
    (ports, runtime)
}

pub fn global_settings(model: &str, effort: &str) -> AgentGlobalSettings {
    serde_json::from_value(json!({
        "approvalPolicy": "on-request",
        "approvalsReviewer": "user",
        "commitMessageModel": "gpt-5.6",
        "commitMessagePrompt": "",
        "commitMessageReasoningEffort": "high",
        "defaultOpenAppId": null,
        "followUpBehavior": "queue",
        "model": model,
        "reasoningEffort": effort,
        "sandboxMode": "workspace-write"
    }))
    .expect("global settings")
}

pub fn project_defaults(model: &str, effort: &str) -> AgentProjectDefaults {
    serde_json::from_value(json!({
        "model": model,
        "reasoningEffort": effort,
        "sandboxMode": "workspace-write"
    }))
    .expect("project defaults")
}

pub fn task_settings(sandbox_mode: &str) -> AgentTaskSettings {
    serde_json::from_value(json!({
        "approvalPolicy": "on-request",
        "approvalsReviewer": "user",
        "model": "gpt-5.6",
        "reasoningEffort": "high",
        "sandboxMode": sandbox_mode
    }))
    .expect("task settings")
}
