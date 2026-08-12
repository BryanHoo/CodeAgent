use async_trait::async_trait;
use chrono::{DateTime, Utc};
use code_agent_core::{ClockPort, CodeAgentError, PortRequestContext, ProviderPort, UpdatePort};
use code_agent_protocol::AgentCapabilities;
use serde_json::json;

pub struct DesktopHostPorts;

#[async_trait]
impl ProviderPort for DesktopHostPorts {
    async fn capabilities(
        &self,
        _context: &PortRequestContext,
    ) -> Result<AgentCapabilities, CodeAgentError> {
        // Phase 5 接入 Codex Provider 前明确关闭 Agent 能力，不能伪造在线状态。
        serde_json::from_value(json!({
            "feedback": { "upload": false },
            "provider": "unavailable",
            "skills": { "list": false, "use": false },
            "tasks": { "fork": false, "list": false, "read": false, "start": false },
            "turns": {
                "compact": false,
                "interrupt": false,
                "review": false,
                "start": false,
                "steer": false
            }
        }))
        .map_err(|_| CodeAgentError::internal("desktop capabilities are invalid"))
    }
}

impl ClockPort for DesktopHostPorts {
    fn now(&self) -> DateTime<Utc> {
        std::time::SystemTime::now().into()
    }
}

#[async_trait]
impl UpdatePort for DesktopHostPorts {
    async fn current_version(
        &self,
        _context: &PortRequestContext,
    ) -> Result<String, CodeAgentError> {
        Ok(env!("CARGO_PKG_VERSION").to_owned())
    }
}
