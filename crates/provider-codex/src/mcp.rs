use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use code_agent_core::CodeAgentError;
use code_agent_protocol::{AgentMcpServerPage, RawProviderEvent, parse_provider_event};
use serde_json::{Value, json};

#[derive(Default)]
pub(crate) struct McpState {
    names: Mutex<HashMap<String, HashSet<String>>>,
    startup: Mutex<HashMap<String, HashMap<String, Value>>>,
}

impl McpState {
    pub(crate) fn snapshot(&self, task_id: &str) -> Option<HashMap<String, Value>> {
        self.startup.lock().ok()?.get(task_id).cloned()
    }

    pub(crate) fn restore(&self, task_id: &str, snapshot: Option<HashMap<String, Value>>) {
        if let Ok(mut startup) = self.startup.lock() {
            match snapshot {
                Some(snapshot) => {
                    startup.insert(task_id.to_owned(), snapshot);
                }
                None => {
                    startup.remove(task_id);
                }
            }
        }
    }

    pub(crate) fn update(&self, params: &Value) -> Result<RawProviderEvent, CodeAgentError> {
        let task_id = string(params, "threadId")?;
        let name = string(params, "name")?;
        let status = match string(params, "status")? {
            "starting" | "ready" | "failed" | "cancelled" => params["status"].clone(),
            _ => return Err(invalid("MCP startup status is invalid")),
        };
        let failure_reason = match params.get("failureReason") {
            None | Some(Value::Null) => Value::Null,
            Some(Value::String(value)) if value == "reauthenticationRequired" => {
                Value::String(value.clone())
            }
            _ => return Err(invalid("MCP startup failure reason is invalid")),
        };
        let error = match params.get("error") {
            None | Some(Value::Null) => Value::Null,
            Some(Value::String(value)) => Value::String(value.clone()),
            _ => return Err(invalid("MCP startup error is invalid")),
        };
        let startup = json!({
            "error": error, "failureReason": failure_reason, "name": name, "status": status
        });
        self.startup
            .lock()
            .map_err(|_| invalid("MCP state is poisoned"))?
            .entry(task_id.to_owned())
            .or_default()
            .insert(name.to_owned(), startup.clone());
        parse_provider_event(json!({
            "payload": startup, "taskId": task_id, "type": "mcp_server.status_updated"
        }))
        .map_err(|error| invalid(error.to_string()))
    }

    pub(crate) fn merge_page(
        &self,
        task_id: &str,
        pages: Vec<Value>,
    ) -> Result<AgentMcpServerPage, CodeAgentError> {
        let mut servers = HashMap::<String, Value>::new();
        for entry in pages {
            let name = string(&entry, "name")?.to_owned();
            if servers.contains_key(&name) {
                continue;
            }
            let auth_status = match entry.get("authStatus") {
                Some(Value::String(value))
                    if matches!(
                        value.as_str(),
                        "unknown" | "unsupported" | "notLoggedIn" | "bearerToken" | "oAuth"
                    ) =>
                {
                    Value::String(value.clone())
                }
                _ => return Err(invalid("MCP authStatus is invalid")),
            };
            let info = entry.get("serverInfo").and_then(Value::as_object);
            let tools = entry["tools"]
                .as_object()
                .ok_or_else(|| invalid("MCP tools are invalid"))?;
            servers.insert(
                name.clone(),
                json!({
                    "authStatus": auth_status,
                    "description": display(info.and_then(|value| value.get("description"))),
                    "error": null, "failureReason": null, "name": name, "status": "ready",
                    "title": display(info.and_then(|value| value.get("title"))),
                    "toolCount": tools.len(),
                    "version": display(info.and_then(|value| value.get("version")))
                }),
            );
        }
        if let Some(startup) = self
            .startup
            .lock()
            .map_err(|_| invalid("MCP state is poisoned"))?
            .get_mut(task_id)
        {
            for name in startup.keys().cloned().collect::<Vec<_>>() {
                let state = startup.get(&name).cloned().unwrap_or(Value::Null);
                if state["status"] == "ready" && servers.contains_key(&name) {
                    startup.remove(&name);
                    continue;
                }
                let ready = servers.get(&name);
                servers.insert(name.clone(), json!({
                    "authStatus": ready.map_or(Value::Null, |value| value["authStatus"].clone()),
                    "description": ready.map_or(Value::Null, |value| value["description"].clone()),
                    "error": state["error"], "failureReason": state["failureReason"], "name": name,
                    "status": state["status"], "title": ready.map_or(Value::Null, |value| value["title"].clone()),
                    "toolCount": ready.and_then(|value| value["toolCount"].as_u64()).unwrap_or(0),
                    "version": ready.map_or(Value::Null, |value| value["version"].clone())
                }));
            }
        }
        let mut data = servers.into_values().collect::<Vec<_>>();
        data.sort_by(|left, right| left["name"].as_str().cmp(&right["name"].as_str()));
        if let Ok(mut names) = self.names.lock() {
            names.insert(
                task_id.to_owned(),
                data.iter()
                    .filter_map(|server| server["name"].as_str().map(str::to_owned))
                    .collect(),
            );
        }
        serde_json::from_value(json!({ "data": data })).map_err(|error| invalid(error.to_string()))
    }

    pub(crate) fn mark_reloading(&self, task_id: &str) {
        let names = self
            .names
            .lock()
            .ok()
            .and_then(|names| names.get(task_id).cloned())
            .unwrap_or_default();
        if let Ok(mut startup) = self.startup.lock() {
            let states = startup.entry(task_id.to_owned()).or_default();
            for name in names {
                states.insert(name.clone(), json!({ "error": null, "failureReason": null, "name": name, "status": "starting" }));
            }
        }
    }

    pub(crate) fn clear_task(&self, task_id: &str) {
        if let Ok(mut names) = self.names.lock() {
            names.remove(task_id);
        }
        if let Ok(mut startup) = self.startup.lock() {
            startup.remove(task_id);
        }
    }
}

fn sanitize_error(value: &str) -> String {
    let mut redact_next = false;
    let words = value
        .split_whitespace()
        .map(|word| {
            if redact_next {
                redact_next = false;
                return "[REDACTED]".to_owned();
            }
            if word.eq_ignore_ascii_case("Bearer") {
                redact_next = true;
                return "Bearer".to_owned();
            }
            if ["http://", "https://", "ws://", "wss://"]
                .iter()
                .any(|prefix| word.starts_with(prefix))
            {
                return "[URL redacted]".to_owned();
            }
            if let Some((key, _)) = word.split_once('=')
                && key.chars().all(|value| {
                    value.is_ascii_uppercase() || value.is_ascii_digit() || value == '_'
                })
                && ["TOKEN", "KEY", "SECRET", "PASSWORD"]
                    .iter()
                    .any(|needle| key.contains(needle))
            {
                return format!("{key}=[REDACTED]");
            }
            word.to_owned()
        })
        .collect::<Vec<_>>();
    words.join(" ")
}

fn display(value: Option<&Value>) -> Value {
    value
        .and_then(Value::as_str)
        .map(sanitize_error)
        .map(Value::String)
        .unwrap_or(Value::Null)
}

fn string<'a>(value: &'a Value, key: &str) -> Result<&'a str, CodeAgentError> {
    value[key]
        .as_str()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| invalid(format!("MCP {key} is invalid")))
}

fn invalid(message: impl Into<String>) -> CodeAgentError {
    CodeAgentError::internal(message.into())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::McpState;

    #[test]
    fn startup_error_preserves_codex_message_exactly() {
        let state = McpState::default();
        let message = "Bearer secret-token https://mcp.example.test API_KEY=secret\nprocess failed";

        let event = state
            .update(&json!({
                "error": message,
                "failureReason": null,
                "name": "docs",
                "status": "failed",
                "threadId": "thread-1"
            }))
            .expect("MCP status");

        assert_eq!(event.as_value()["payload"]["error"], message);
    }
}
