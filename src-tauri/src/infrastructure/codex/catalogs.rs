use std::{collections::HashSet, time::Duration};

use serde::Serialize;
use serde_json::{Map, Value, json};

use super::connection::{AppServerConnection, ConnectionError};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const PAGE_LIMIT: u32 = 100;
const MAX_CATALOG_ITEMS: usize = 10_000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PageParams {
    cursor: Option<String>,
    limit: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SkillsParams<'a> {
    cwds: [&'a str; 1],
    force_reload: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct McpParams {
    cursor: Option<String>,
    detail: &'static str,
    limit: u32,
    thread_id: String,
}

pub async fn list_models(connection: &AppServerConnection) -> Result<Value, ConnectionError> {
    let data = collect_pages(connection, "model/list", |cursor| PageParams {
        cursor: cursor.map(str::to_owned),
        limit: PAGE_LIMIT,
    })
    .await?;
    Ok(
        json!({"data": data.into_iter().filter_map(map_model).collect::<Vec<_>>(), "nextCursor": null}),
    )
}

pub async fn list_skills(
    connection: &AppServerConnection,
    cwd: &str,
    force_reload: bool,
) -> Result<Value, ConnectionError> {
    let response: Value = connection
        .request(
            "skills/list",
            &SkillsParams {
                cwds: [cwd],
                force_reload,
            },
            REQUEST_TIMEOUT,
        )
        .await?;
    let skills = response
        .get("data")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .flat_map(|entry| {
            entry
                .get("skills")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
        })
        .filter(|skill| skill.get("enabled").and_then(Value::as_bool) != Some(false))
        .filter_map(map_skill)
        .take(MAX_CATALOG_ITEMS)
        .collect::<Vec<_>>();
    Ok(json!({"data": skills, "nextCursor": null}))
}

pub async fn list_mcp_servers(
    connection: &AppServerConnection,
    thread_id: &str,
) -> Result<Value, ConnectionError> {
    let items = collect_pages(connection, "mcpServerStatus/list", |cursor| McpParams {
        cursor: cursor.map(str::to_owned),
        detail: "toolsAndAuthOnly",
        limit: PAGE_LIMIT,
        thread_id: thread_id.to_owned(),
    })
    .await?;
    Ok(json!({"data": items.into_iter().filter_map(map_mcp_server).collect::<Vec<_>>() }))
}

pub async fn reload_mcp_servers(
    connection: &AppServerConnection,
    thread_id: &str,
) -> Result<Value, ConnectionError> {
    let _: Value = connection
        .request(
            "config/mcpServer/reload",
            &Map::<String, Value>::new(),
            REQUEST_TIMEOUT,
        )
        .await?;
    list_mcp_servers(connection, thread_id).await
}

async fn collect_pages<P, F>(
    connection: &AppServerConnection,
    method: &str,
    params: F,
) -> Result<Vec<Value>, ConnectionError>
where
    P: Serialize,
    F: Fn(Option<&str>) -> P,
{
    let mut data = Vec::new();
    let mut cursor: Option<String> = None;
    let mut seen = HashSet::new();
    loop {
        let response: Value = connection
            .request(method, &params(cursor.as_deref()), REQUEST_TIMEOUT)
            .await?;
        let page = response
            .get("data")
            .and_then(Value::as_array)
            .ok_or(ConnectionError::InvalidMessage)?;
        data.extend(page.iter().cloned());
        if data.len() > MAX_CATALOG_ITEMS {
            return Err(ConnectionError::InvalidMessage);
        }
        let Some(next) = response.get("nextCursor").and_then(Value::as_str) else {
            break;
        };
        if !seen.insert(next.to_owned()) {
            return Err(ConnectionError::InvalidMessage);
        }
        cursor = Some(next.to_owned());
    }
    Ok(data)
}

fn map_model(model: Value) -> Option<Value> {
    let id = model.get("id")?.as_str()?;
    let display_name = model.get("displayName")?.as_str()?;
    let efforts = model
        .get("supportedReasoningEfforts")?
        .as_array()?
        .iter()
        .filter_map(|effort| {
            Some(json!({
                "description": effort.get("description")?.as_str()?,
                "id": effort.get("reasoningEffort")?.as_str()?,
            }))
        })
        .collect::<Vec<_>>();
    if efforts.is_empty() {
        return None;
    }
    Some(json!({
        "defaultReasoningEffort": model.get("defaultReasoningEffort")?.as_str()?,
        "description": model.get("description").and_then(Value::as_str).unwrap_or_default(),
        "displayName": display_name,
        "id": id,
        "isDefault": model.get("isDefault").and_then(Value::as_bool).unwrap_or(false),
        "supportedReasoningEfforts": efforts,
    }))
}

fn map_skill(skill: &Value) -> Option<Value> {
    let name = skill.get("name")?.as_str()?;
    let display_name = skill
        .pointer("/interface/displayName")
        .and_then(Value::as_str)
        .unwrap_or(name);
    Some(json!({
        "description": skill.get("description").and_then(Value::as_str).unwrap_or_default(),
        "displayName": display_name,
        "id": skill.get("path").and_then(Value::as_str).unwrap_or(name),
        "name": name,
        "scope": skill.get("scope").and_then(Value::as_str).unwrap_or("user"),
    }))
}

fn map_mcp_server(server: Value) -> Option<Value> {
    let name = server.get("name")?.as_str()?;
    let info = server.get("serverInfo").filter(|value| !value.is_null());
    // 保留 0.151 的线程连接态；仅按官方 TUI 规则补全无运行态但未登录的服务。
    let status = match server.get("runtimeStatus")? {
        Value::Null if server.get("authStatus").and_then(Value::as_str) == Some("notLoggedIn") => {
            "authenticationRequired"
        }
        Value::Null => "unknown",
        Value::String(value)
            if matches!(
                value.as_str(),
                "notStarted"
                    | "starting"
                    | "connected"
                    | "authenticationRequired"
                    | "failed"
                    | "cancelled"
                    | "disabled"
            ) =>
        {
            value
        }
        _ => return None,
    };
    let tool_count = server
        .get("tools")
        .and_then(Value::as_object)
        .map_or(0, Map::len);
    let display_name = info
        .and_then(|value| value.get("title"))
        .and_then(Value::as_str)
        .unwrap_or(name);
    Some(json!({
        "displayName": display_name,
        "name": name,
        "status": status,
        "toolCount": tool_count,
    }))
}
