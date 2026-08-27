use std::{path::Path, time::Duration};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

use super::{
    AppServerConnection,
    connection::ConnectionError,
    conversation::{NativeTurn, map_turn},
    conversation_prompt::map_prompt_input,
};
use crate::domain::conversation::{AgentPromptInput, AgentTurn};

const DEFAULT_PAGE_LIMIT: u32 = 100;
const MAX_PAGE_LIMIT: u32 = 100;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ListParams<'a> {
    cursor: Option<&'a str>,
    limit: u32,
    thread_id: &'a str,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativePage {
    data: Vec<NativeSubmission>,
    next_cursor: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeSubmission {
    client_user_message_id: String,
    id: String,
    input: Vec<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueuedSubmissionPage {
    pub data: Vec<AgentQueuedSubmission>,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentQueuedSubmission {
    pub attachments: Vec<Value>,
    pub client_user_message_id: String,
    pub id: String,
    pub skills: Vec<Value>,
    pub status: &'static str,
    pub text: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueuedSubmissionResponse {
    pub queued_submission: AgentQueuedSubmission,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AddParams<'a> {
    client_user_message_id: &'a str,
    input: Vec<Value>,
    thread_id: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateParams<'a> {
    input: Vec<Value>,
    queued_submission_id: &'a str,
    thread_id: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SubmissionIdParams<'a> {
    queued_submission_id: &'a str,
    thread_id: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReorderParams<'a> {
    queued_submission_ids: &'a [String],
    thread_id: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StartParams<'a> {
    queued_submission_id: Option<&'a str>,
    thread_id: &'a str,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeSubmissionResponse {
    queued_submission: NativeSubmission,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct DeleteQueuedSubmissionResponse {
    pub deleted: bool,
}

#[derive(Debug, Serialize)]
pub struct ReorderQueuedSubmissionsResponse {
    pub status: &'static str,
}

#[derive(Deserialize)]
struct NativeStartResponse {
    turn: NativeTurn,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartQueuedSubmissionResponse {
    pub task_id: String,
    pub turn: AgentTurn,
}

pub async fn list_queued_submissions(
    connection: &AppServerConnection,
    task_id: &str,
    cursor: Option<&str>,
    limit: Option<u32>,
) -> Result<QueuedSubmissionPage, ConnectionError> {
    let limit = limit.unwrap_or(DEFAULT_PAGE_LIMIT);
    if limit == 0 || limit > MAX_PAGE_LIMIT {
        return Err(ConnectionError::InvalidMessage);
    }
    let response: NativePage = connection
        .request(
            "thread/queue/list",
            &ListParams {
                cursor,
                limit,
                thread_id: task_id,
            },
            REQUEST_TIMEOUT,
        )
        .await?;
    Ok(QueuedSubmissionPage {
        data: response
            .data
            .into_iter()
            .map(map_submission)
            .collect::<Result<Vec<_>, _>>()?,
        next_cursor: response.next_cursor,
    })
}

pub async fn add_queued_submission(
    connection: &AppServerConnection,
    task_id: &str,
    input: &AgentPromptInput,
    client_user_message_id: &str,
) -> Result<QueuedSubmissionResponse, ConnectionError> {
    if client_user_message_id.is_empty() {
        return Err(ConnectionError::InvalidMessage);
    }
    let response: NativeSubmissionResponse = connection
        .request(
            "thread/queue/add",
            &AddParams {
                client_user_message_id,
                input: map_prompt_input(input)?,
                thread_id: task_id,
            },
            REQUEST_TIMEOUT,
        )
        .await?;
    Ok(QueuedSubmissionResponse {
        queued_submission: map_submission(response.queued_submission)?,
    })
}

pub async fn update_queued_submission(
    connection: &AppServerConnection,
    task_id: &str,
    submission_id: &str,
    input: &AgentPromptInput,
) -> Result<QueuedSubmissionResponse, ConnectionError> {
    let response: NativeSubmissionResponse = connection
        .request(
            "thread/queue/update",
            &UpdateParams {
                input: map_prompt_input(input)?,
                queued_submission_id: required_id(submission_id)?,
                thread_id: task_id,
            },
            REQUEST_TIMEOUT,
        )
        .await?;
    Ok(QueuedSubmissionResponse {
        queued_submission: map_submission(response.queued_submission)?,
    })
}

pub async fn delete_queued_submission(
    connection: &AppServerConnection,
    task_id: &str,
    submission_id: &str,
) -> Result<DeleteQueuedSubmissionResponse, ConnectionError> {
    connection
        .request(
            "thread/queue/delete",
            &SubmissionIdParams {
                queued_submission_id: required_id(submission_id)?,
                thread_id: task_id,
            },
            REQUEST_TIMEOUT,
        )
        .await
}

pub async fn reorder_queued_submissions(
    connection: &AppServerConnection,
    task_id: &str,
    submission_ids: &[String],
) -> Result<ReorderQueuedSubmissionsResponse, ConnectionError> {
    if submission_ids.is_empty() || submission_ids.iter().any(|id| id.is_empty()) {
        return Err(ConnectionError::InvalidMessage);
    }
    let _: Value = connection
        .request(
            "thread/queue/reorder",
            &ReorderParams {
                queued_submission_ids: submission_ids,
                thread_id: task_id,
            },
            REQUEST_TIMEOUT,
        )
        .await?;
    Ok(ReorderQueuedSubmissionsResponse {
        status: "reordered",
    })
}

pub async fn start_queued_submission(
    connection: &AppServerConnection,
    task_id: &str,
    submission_id: Option<&str>,
) -> Result<StartQueuedSubmissionResponse, ConnectionError> {
    if submission_id.is_some_and(str::is_empty) {
        return Err(ConnectionError::InvalidMessage);
    }
    let response: NativeStartResponse = connection
        .request(
            "thread/queue/start",
            &StartParams {
                queued_submission_id: submission_id,
                thread_id: task_id,
            },
            REQUEST_TIMEOUT,
        )
        .await?;
    Ok(StartQueuedSubmissionResponse {
        task_id: task_id.to_owned(),
        turn: map_turn(response.turn)?,
    })
}

fn required_id(value: &str) -> Result<&str, ConnectionError> {
    (!value.is_empty())
        .then_some(value)
        .ok_or(ConnectionError::InvalidMessage)
}

fn map_submission(native: NativeSubmission) -> Result<AgentQueuedSubmission, ConnectionError> {
    if native.id.is_empty() || native.client_user_message_id.is_empty() {
        return Err(ConnectionError::InvalidMessage);
    }
    let mut text = String::new();
    let mut attachments = Vec::new();
    let mut skills = Vec::new();
    for input in native.input {
        let object = input.as_object().ok_or(ConnectionError::InvalidMessage)?;
        match object_string_from_map(object, "type")? {
            "text" => text.push_str(object_string_from_map(object, "text")?),
            "skill" => skills.push(json!({
                "id": object_string_from_map(object, "path")?,
                "name": object_string_from_map(object, "name")?,
            })),
            "localImage" => attachments.push(map_local_image(object)?),
            _ => return Err(ConnectionError::InvalidMessage),
        }
    }
    Ok(AgentQueuedSubmission {
        attachments,
        client_user_message_id: native.client_user_message_id,
        id: native.id,
        skills,
        status: "queued",
        text,
    })
}

fn map_local_image(object: &Map<String, Value>) -> Result<Value, ConnectionError> {
    let path = Path::new(object_string_from_map(object, "path")?);
    let size = std::fs::metadata(path)
        .ok()
        .and_then(|metadata| usize::try_from(metadata.len()).ok())
        .filter(|size| *size > 0)
        .unwrap_or(1);
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .ok_or(ConnectionError::InvalidMessage)?;
    let media_type = match path.extension().and_then(|value| value.to_str()) {
        Some("gif") => "image/gif",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        _ => "image/png",
    };
    Ok(json!({
        "id": path.to_string_lossy(), "kind": "image", "mediaType": media_type,
        "name": name, "size": size,
    }))
}

fn object_string_from_map<'a>(
    object: &'a Map<String, Value>,
    key: &str,
) -> Result<&'a str, ConnectionError> {
    object
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or(ConnectionError::InvalidMessage)
}
