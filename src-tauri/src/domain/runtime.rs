use serde::Serialize;

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ProviderKind {
    Codex,
    Claude,
}

#[derive(Clone, Copy, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RuntimeStatus {
    #[default]
    Stopped,
    Starting,
    Ready,
    Failed,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSnapshot {
    pub schema_version: u16,
    pub status: RuntimeStatus,
    pub provider: Option<ProviderKind>,
    pub last_seq: u64,
}

impl Default for RuntimeSnapshot {
    fn default() -> Self {
        Self {
            schema_version: 1,
            status: RuntimeStatus::Stopped,
            provider: None,
            last_seq: 0,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase", tag = "type", content = "data")]
pub enum AppEvent {
    RuntimeStatus {
        seq: u64,
        status: RuntimeStatus,
        provider: Option<ProviderKind>,
    },
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{AppEvent, ProviderKind, RuntimeStatus};

    #[test]
    fn runtime_event_should_match_frontend_contract() {
        let event = AppEvent::RuntimeStatus {
            seq: 7,
            status: RuntimeStatus::Ready,
            provider: Some(ProviderKind::Codex),
        };

        let value = serde_json::to_value(event).expect("event serialization should succeed");

        assert_eq!(
            value,
            json!({
                "type": "runtimeStatus",
                "data": {
                    "seq": 7,
                    "status": "ready",
                    "provider": "codex"
                }
            })
        );
    }
}
