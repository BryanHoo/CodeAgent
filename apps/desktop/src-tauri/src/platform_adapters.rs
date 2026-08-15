use async_trait::async_trait;
use chrono::{DateTime, Utc};
use code_agent_core::{ClockPort, CodeAgentError, PortRequestContext, UpdatePort};

pub use crate::codex_supervisor::{CodexSupervisor, start_codex_supervisor};
pub use crate::desktop_provider::{DesktopProvider, RuntimeReadiness};

pub struct DesktopHostPorts;

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

#[cfg(test)]
#[path = "platform_adapters_tests.rs"]
mod tests;
