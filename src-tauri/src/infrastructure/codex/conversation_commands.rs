use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use super::{
    AppServerConnection,
    connection::ConnectionError,
    conversation::{
        NativeThreadSection, NativeTurn, PINNED_SECTION_ID, RUNTIME_SESSION_ID, map_turn,
        normalized_title,
    },
    conversation_prompt::map_prompt_input,
    sidebar::unix_seconds_to_rfc3339,
};
use crate::domain::{
    conversation::{
        AgentPromptInput, AgentTurnActionResponse, AgentTurnOptions, EventCheckpoint,
        StartAgentTurnResponse,
    },
    sidebar::{AgentTask, AgentTaskMutationResponse},
};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const TEMPORARY_PROJECT_ID: &str = "temporary";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectReadParams<'a> {
    project_id: &'a str,
}

#[derive(Deserialize)]
struct NativeProjectResponse {
    project: NativeProject,
}

#[derive(Deserialize)]
struct NativeProject {
    id: String,
    roots: Vec<NativeProjectRoot>,
}

#[derive(Deserialize)]
struct NativeProjectRoot {
    path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ThreadStartParams<'a> {
    cwd: Option<&'a str>,
    history_mode: &'static str,
    project_id: Option<&'a str>,
    runtime_workspace_roots: Option<&'a [String]>,
}

#[derive(Deserialize)]
struct NativeTaskResponse {
    thread: NativeTask,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeTask {
    id: String,
    name: Option<String>,
    preview: String,
    project_id: Option<String>,
    section: Option<NativeThreadSection>,
    updated_at: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ThreadResumeParams<'a> {
    exclude_turns: bool,
    thread_id: &'a str,
}

#[derive(Deserialize)]
struct NativeResumeResponse {
    thread: NativeTaskIdentity,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeTaskIdentity {
    id: String,
    project_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TurnStartParams<'a> {
    approval_policy: &'a Value,
    approvals_reviewer: &'a str,
    collaboration_mode: Value,
    effort: &'a str,
    input: Vec<Value>,
    model: &'a str,
    sandbox_policy: Value,
    service_tier: Option<&'static str>,
    thread_id: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ThreadSettingsUpdateParams<'a> {
    approval_policy: &'a Value,
    approvals_reviewer: &'a str,
    collaboration_mode: Value,
    effort: &'a str,
    model: &'a str,
    sandbox_policy: Value,
    service_tier: Option<Option<&'static str>>,
    thread_id: &'a str,
}

#[derive(Deserialize)]
struct NativeTurnResponse {
    turn: NativeTurn,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TurnSteerParams<'a> {
    expected_turn_id: &'a str,
    input: Vec<Value>,
    thread_id: &'a str,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TurnSteerResponse {
    turn_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TurnInterruptParams<'a> {
    thread_id: &'a str,
    turn_id: &'a str,
}

pub async fn start_task(
    connection: &AppServerConnection,
    project_id: String,
) -> Result<AgentTaskMutationResponse, ConnectionError> {
    let root_paths = if project_id == TEMPORARY_PROJECT_ID {
        Vec::new()
    } else {
        let project_response: NativeProjectResponse = connection
            .request(
                "project/read",
                &ProjectReadParams {
                    project_id: &project_id,
                },
                REQUEST_TIMEOUT,
            )
            .await?;
        let project = project_response.project;
        if project.id != project_id || project.roots.is_empty() {
            return Err(ConnectionError::InvalidMessage);
        }
        project.roots.into_iter().map(|root| root.path).collect()
    };
    let native_project_id = (project_id != TEMPORARY_PROJECT_ID).then_some(project_id.as_str());
    let response: NativeTaskResponse = connection
        .request(
            "thread/start",
            &ThreadStartParams {
                cwd: root_paths.first().map(String::as_str),
                history_mode: "paginated",
                project_id: native_project_id,
                runtime_workspace_roots: (!root_paths.is_empty()).then_some(root_paths.as_slice()),
            },
            REQUEST_TIMEOUT,
        )
        .await?;
    validate_task_identity(
        &response.thread.id,
        response.thread.project_id.as_deref(),
        &project_id,
    )?;
    Ok(AgentTaskMutationResponse {
        task: map_native_task(response.thread, project_id),
    })
}

pub async fn start_turn(
    connection: &AppServerConnection,
    project_id: String,
    task_id: String,
    input: AgentPromptInput,
    options: AgentTurnOptions,
    resume_task_before_turn: bool,
) -> Result<StartAgentTurnResponse, ConnectionError> {
    // 新线程已由 thread/start 载入，但首个 Turn 前尚无 rollout，不能立即 resume。
    if resume_task_before_turn {
        resume_task(connection, &project_id, &task_id).await?;
    }

    let response: NativeTurnResponse = connection
        .request(
            "turn/start",
            &TurnStartParams {
                approval_policy: &options.approval_policy,
                approvals_reviewer: map_approvals_reviewer(&options.approvals_reviewer)?,
                collaboration_mode: collaboration_mode(&options),
                effort: &options.reasoning_effort,
                input: map_prompt_input(&input)?,
                model: &options.model,
                sandbox_policy: sandbox_policy(&options.sandbox_mode)?,
                service_tier: options.fast_mode.then_some("fast"),
                thread_id: &task_id,
            },
            REQUEST_TIMEOUT,
        )
        .await?;
    Ok(StartAgentTurnResponse {
        checkpoint: EventCheckpoint {
            sequence: 0,
            session_id: RUNTIME_SESSION_ID,
        },
        task_id,
        turn: map_turn(response.turn)?,
    })
}

pub async fn resume_task(
    connection: &AppServerConnection,
    project_id: &str,
    task_id: &str,
) -> Result<(), ConnectionError> {
    let resumed: NativeResumeResponse = connection
        .request(
            "thread/resume",
            &ThreadResumeParams {
                // 历史由分页接口加载，Resume 仅返回元数据，避免极限会话形成超大单帧。
                exclude_turns: true,
                thread_id: task_id,
            },
            REQUEST_TIMEOUT,
        )
        .await?;
    if resumed.thread.id != task_id {
        return Err(ConnectionError::InvalidMessage);
    }
    validate_task_identity(task_id, resumed.thread.project_id.as_deref(), project_id)
}

pub async fn update_thread_settings(
    connection: &AppServerConnection,
    task_id: &str,
    options: &AgentTurnOptions,
) -> Result<(), ConnectionError> {
    let _: Value = connection
        .request(
            "thread/settings/update",
            &ThreadSettingsUpdateParams {
                approval_policy: &options.approval_policy,
                approvals_reviewer: map_approvals_reviewer(&options.approvals_reviewer)?,
                collaboration_mode: collaboration_mode(options),
                effort: &options.reasoning_effort,
                model: &options.model,
                sandbox_policy: sandbox_policy(&options.sandbox_mode)?,
                service_tier: Some(options.fast_mode.then_some("fast")),
                thread_id: task_id,
            },
            REQUEST_TIMEOUT,
        )
        .await?;
    Ok(())
}

pub async fn steer_turn(
    connection: &AppServerConnection,
    task_id: String,
    turn_id: String,
    input: AgentPromptInput,
) -> Result<AgentTurnActionResponse, ConnectionError> {
    let response: TurnSteerResponse = connection
        .request(
            "turn/steer",
            &TurnSteerParams {
                expected_turn_id: &turn_id,
                input: map_prompt_input(&input)?,
                thread_id: &task_id,
            },
            REQUEST_TIMEOUT,
        )
        .await?;
    if response.turn_id != turn_id {
        return Err(ConnectionError::InvalidMessage);
    }
    Ok(AgentTurnActionResponse {
        status: "accepted",
        task_id,
        turn_id,
    })
}

pub async fn interrupt_turn(
    connection: &AppServerConnection,
    task_id: String,
    turn_id: String,
) -> Result<AgentTurnActionResponse, ConnectionError> {
    let _: Value = connection
        .request(
            "turn/interrupt",
            &TurnInterruptParams {
                thread_id: &task_id,
                turn_id: &turn_id,
            },
            REQUEST_TIMEOUT,
        )
        .await?;
    Ok(AgentTurnActionResponse {
        status: "interrupting",
        task_id,
        turn_id,
    })
}

fn map_native_task(thread: NativeTask, project_id: String) -> AgentTask {
    AgentTask {
        id: thread.id,
        pinned: thread
            .section
            .is_some_and(|section| section.id == PINNED_SECTION_ID),
        project_id,
        title: normalized_title(thread.name.as_deref(), &thread.preview),
        updated_at: unix_seconds_to_rfc3339(thread.updated_at),
    }
}

fn validate_task_identity(
    task_id: &str,
    native_project_id: Option<&str>,
    project_id: &str,
) -> Result<(), ConnectionError> {
    let expected_project_id = (project_id != TEMPORARY_PROJECT_ID).then_some(project_id);
    if task_id.is_empty() || native_project_id != expected_project_id {
        return Err(ConnectionError::InvalidMessage);
    }
    Ok(())
}

fn map_approvals_reviewer(value: &str) -> Result<&'static str, ConnectionError> {
    match value {
        "user" => Ok("user"),
        "auto_review" => Ok("autoReview"),
        _ => Err(ConnectionError::InvalidMessage),
    }
}

fn collaboration_mode(options: &AgentTurnOptions) -> Value {
    json!({
        "mode": options.collaboration_mode.as_deref().unwrap_or("default"),
        "settings": {
            "developer_instructions": null,
            "model": options.model,
            "reasoning_effort": options.reasoning_effort,
        }
    })
}

fn sandbox_policy(mode: &str) -> Result<Value, ConnectionError> {
    match mode {
        "danger-full-access" => Ok(json!({"type": "dangerFullAccess"})),
        "read-only" => Ok(json!({"networkAccess": false, "type": "readOnly"})),
        "workspace-write" => Ok(json!({
            "excludeSlashTmp": false,
            "excludeTmpdirEnvVar": false,
            "networkAccess": false,
            "type": "workspaceWrite",
            "writableRoots": [],
        })),
        _ => Err(ConnectionError::InvalidMessage),
    }
}
