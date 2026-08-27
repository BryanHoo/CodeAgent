use std::time::Duration;

use serde::{Deserialize, Serialize};

use super::{
    connection::{AppServerConnection, ConnectionError},
    sidebar::unix_seconds_to_rfc3339,
};
use crate::domain::sidebar::{
    AgentTask, AgentTaskMutationResponse, AgentTaskPage, AgentTaskStatusResponse, ListTasksInput,
};

const PINNED_SECTION_ID: &str = "01984de2-8f74-7c91-a3b2-5c5e937cf318";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const TEMPORARY_PROJECT_ID: &str = "temporary";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ThreadListParams<'a> {
    archived: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    cursor: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    limit: Option<u32>,
    project_id: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    search_term: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    section_id: Option<&'a str>,
    sort_direction: &'static str,
    sort_key: &'static str,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeThreadPage {
    data: Vec<NativeThread>,
    next_cursor: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeThread {
    id: String,
    name: Option<String>,
    preview: String,
    project_id: Option<String>,
    section: Option<NativeThreadSection>,
    updated_at: i64,
}

#[derive(Deserialize)]
struct NativeThreadSection {
    id: String,
}

#[derive(Deserialize)]
struct NativeThreadResponse {
    thread: NativeThread,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ThreadIdParams<'a> {
    thread_id: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ThreadReadParams<'a> {
    include_turns: bool,
    thread_id: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ThreadSetNameParams<'a> {
    name: &'a str,
    thread_id: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ThreadSectionMoveParams<'a> {
    section_id: Option<&'a str>,
    thread_id: &'a str,
}

pub async fn list_tasks(
    connection: &AppServerConnection,
    input: ListTasksInput,
) -> Result<AgentTaskPage, ConnectionError> {
    let project_filter = if input.project_id == TEMPORARY_PROJECT_ID {
        None
    } else {
        Some(input.project_id.as_str())
    };
    let response: NativeThreadPage = connection
        .request(
            "thread/list",
            &ThreadListParams {
                archived: input.archived.unwrap_or(false),
                cursor: input.cursor.as_deref(),
                limit: input.limit,
                project_id: project_filter,
                search_term: input.search_term.as_deref(),
                section_id: input.pinned.unwrap_or(false).then_some(PINNED_SECTION_ID),
                sort_direction: "desc",
                sort_key: "updated_at",
            },
            REQUEST_TIMEOUT,
        )
        .await?;

    let mut data = Vec::with_capacity(response.data.len());
    for thread in response.data {
        if thread.project_id.as_deref() != project_filter {
            return Err(ConnectionError::InvalidMessage);
        }
        data.push(map_task(thread, &input.project_id));
    }
    Ok(AgentTaskPage {
        data,
        next_cursor: response.next_cursor,
    })
}

pub async fn read_task(
    connection: &AppServerConnection,
    project_id: String,
    task_id: String,
) -> Result<AgentTask, ConnectionError> {
    let thread = read_native_task(connection, &project_id, &task_id).await?;
    Ok(map_task(thread, &project_id))
}

pub async fn rename_task(
    connection: &AppServerConnection,
    project_id: String,
    task_id: String,
    title: String,
) -> Result<AgentTaskMutationResponse, ConnectionError> {
    let title = title.trim();
    if title.is_empty() {
        return Err(ConnectionError::InvalidMessage);
    }
    read_native_task(connection, &project_id, &task_id).await?;
    request_empty(
        connection,
        "thread/name/set",
        &ThreadSetNameParams {
            name: title,
            thread_id: &task_id,
        },
    )
    .await?;
    Ok(AgentTaskMutationResponse {
        task: read_task(connection, project_id, task_id).await?,
    })
}

pub async fn pin_task(
    connection: &AppServerConnection,
    project_id: String,
    task_id: String,
    pinned: bool,
) -> Result<AgentTaskMutationResponse, ConnectionError> {
    read_native_task(connection, &project_id, &task_id).await?;
    request_empty(
        connection,
        "thread/section/move",
        &ThreadSectionMoveParams {
            section_id: pinned.then_some(PINNED_SECTION_ID),
            thread_id: &task_id,
        },
    )
    .await?;
    Ok(AgentTaskMutationResponse {
        task: read_task(connection, project_id, task_id).await?,
    })
}

pub async fn archive_task(
    connection: &AppServerConnection,
    project_id: String,
    task_id: String,
) -> Result<AgentTaskStatusResponse, ConnectionError> {
    read_native_task(connection, &project_id, &task_id).await?;
    request_empty(
        connection,
        "thread/archive",
        &ThreadIdParams {
            thread_id: &task_id,
        },
    )
    .await?;
    Ok(AgentTaskStatusResponse {
        status: "archived",
        task_id,
    })
}

pub async fn unarchive_task(
    connection: &AppServerConnection,
    project_id: String,
    task_id: String,
) -> Result<AgentTaskMutationResponse, ConnectionError> {
    read_native_task(connection, &project_id, &task_id).await?;
    let response: NativeThreadResponse = connection
        .request(
            "thread/unarchive",
            &ThreadIdParams {
                thread_id: &task_id,
            },
            REQUEST_TIMEOUT,
        )
        .await?;
    validate_task_project(&response.thread, &project_id)?;
    Ok(AgentTaskMutationResponse {
        task: map_task(response.thread, &project_id),
    })
}

pub async fn delete_task(
    connection: &AppServerConnection,
    project_id: String,
    task_id: String,
) -> Result<AgentTaskStatusResponse, ConnectionError> {
    read_native_task(connection, &project_id, &task_id).await?;
    request_empty(
        connection,
        "thread/delete",
        &ThreadIdParams {
            thread_id: &task_id,
        },
    )
    .await?;
    Ok(AgentTaskStatusResponse {
        status: "deleted",
        task_id,
    })
}

async fn read_native_task(
    connection: &AppServerConnection,
    project_id: &str,
    task_id: &str,
) -> Result<NativeThread, ConnectionError> {
    let response: NativeThreadResponse = connection
        .request(
            "thread/read",
            &ThreadReadParams {
                include_turns: false,
                thread_id: task_id,
            },
            REQUEST_TIMEOUT,
        )
        .await?;
    validate_task_project(&response.thread, project_id)?;
    Ok(response.thread)
}

fn validate_task_project(thread: &NativeThread, project_id: &str) -> Result<(), ConnectionError> {
    let expected = (project_id != TEMPORARY_PROJECT_ID).then_some(project_id);
    if thread.project_id.as_deref() != expected {
        return Err(ConnectionError::InvalidMessage);
    }
    Ok(())
}

async fn request_empty<P: Serialize>(
    connection: &AppServerConnection,
    method: &str,
    params: &P,
) -> Result<(), ConnectionError> {
    let _: serde_json::Value = connection.request(method, params, REQUEST_TIMEOUT).await?;
    Ok(())
}

fn map_task(thread: NativeThread, project_id: &str) -> AgentTask {
    let title = thread
        .name
        .as_deref()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .or_else(|| {
            thread
                .preview
                .lines()
                .next()
                .map(str::trim)
                .filter(|preview| !preview.is_empty())
        })
        .unwrap_or("新聊天")
        .to_owned();
    AgentTask {
        id: thread.id,
        pinned: thread
            .section
            .is_some_and(|section| section.id == PINNED_SECTION_ID),
        project_id: project_id.to_owned(),
        title,
        updated_at: unix_seconds_to_rfc3339(thread.updated_at),
    }
}

#[cfg(test)]
#[path = "tasks_tests.rs"]
mod tests;
