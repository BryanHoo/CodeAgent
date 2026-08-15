use std::{str::FromStr, sync::Arc};

use code_agent_protocol::{AgentAttachment, AgentAttachmentKind, ProjectId, TaskId};
use code_agent_runtime::{AttachmentUploadInput, CodeAgentRuntime};
use percent_encoding::percent_decode_str;
use serde::Serialize;
use tauri::{
    Runtime, State,
    ipc::{CommandArg, CommandItem, InvokeBody},
};

use crate::command_error::CommandError;

const PROJECT_ID_HEADER: &str = "x-code-agent-project-id";
const IDEMPOTENCY_KEY_HEADER: &str = "x-code-agent-idempotency-key";
const KIND_HEADER: &str = "x-code-agent-kind";
const MEDIA_TYPE_HEADER: &str = "x-code-agent-media-type";
const NAME_HEADER: &str = "x-code-agent-name";
const REQUEST_ID_HEADER: &str = "x-code-agent-request-id";

#[derive(Debug)]
pub struct RawAttachmentUpload {
    bytes: Vec<u8>,
    kind: AgentAttachmentKind,
    media_type: String,
    name: String,
    project_id: ProjectId,
    request_id: String,
    idempotency_key: String,
}

impl<'de, R: Runtime> CommandArg<'de, R> for RawAttachmentUpload {
    fn from_command(command: CommandItem<'de, R>) -> Result<Self, tauri::ipc::InvokeError> {
        let bytes = match command.message.payload() {
            InvokeBody::Raw(bytes) => bytes.clone(),
            InvokeBody::Json(_) => return Err("attachment upload body must be raw bytes".into()),
        };
        let headers = command.message.headers();
        let value = |name: &'static str| -> Result<String, tauri::ipc::InvokeError> {
            headers
                .get(name)
                .and_then(|value| value.to_str().ok())
                .filter(|value| !value.is_empty())
                .map(str::to_owned)
                .ok_or_else(|| format!("missing attachment header: {name}").into())
        };
        let project_id = ProjectId::from_str(&value(PROJECT_ID_HEADER)?)
            .map_err(|_| tauri::ipc::InvokeError::from("invalid project id"))?;
        let kind = AgentAttachmentKind::from_str(&value(KIND_HEADER)?)
            .map_err(|_| tauri::ipc::InvokeError::from("invalid attachment kind"))?;
        let encoded_name = value(NAME_HEADER)?;
        let name = percent_decode_str(&encoded_name)
            .decode_utf8()
            .map_err(|_| tauri::ipc::InvokeError::from("invalid attachment name"))?
            .into_owned();
        Ok(Self {
            bytes,
            kind,
            media_type: value(MEDIA_TYPE_HEADER)?,
            name,
            project_id,
            request_id: value(REQUEST_ID_HEADER)?,
            idempotency_key: value(IDEMPOTENCY_KEY_HEADER)?,
        })
    }
}

#[derive(Debug, Serialize)]
pub struct AttachmentResponse {
    attachment: AgentAttachment,
}

#[tauri::command]
pub async fn attachment_upload(
    upload: RawAttachmentUpload,
    runtime: State<'_, Arc<CodeAgentRuntime>>,
) -> Result<AttachmentResponse, CommandError> {
    let attachment = runtime
        .upload_attachment(
            &upload.request_id,
            &upload.idempotency_key,
            &upload.project_id,
            AttachmentUploadInput {
                bytes: upload.bytes,
                kind: upload.kind,
                media_type: upload.media_type,
                name: upload.name,
            },
        )
        .await?;
    Ok(AttachmentResponse { attachment })
}

#[tauri::command]
pub async fn attachment_import_host(
    request_id: String,
    idempotency_key: String,
    project_id: String,
    kind: String,
    path: String,
    runtime: State<'_, Arc<CodeAgentRuntime>>,
) -> Result<AttachmentResponse, CommandError> {
    let project_id = ProjectId::from_str(&project_id).map_err(|_| invalid("invalid project id"))?;
    let kind =
        AgentAttachmentKind::from_str(&kind).map_err(|_| invalid("invalid attachment kind"))?;
    let attachment = runtime
        .import_host_attachment(&request_id, &idempotency_key, &project_id, kind, &path)
        .await?;
    Ok(AttachmentResponse { attachment })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenAttachmentResponse {
    attachment_id: String,
    status: &'static str,
}

#[tauri::command]
pub async fn attachment_open(
    request_id: String,
    idempotency_key: String,
    project_id: String,
    task_id: String,
    attachment_id: String,
    runtime: State<'_, Arc<CodeAgentRuntime>>,
) -> Result<OpenAttachmentResponse, CommandError> {
    let project_id = ProjectId::from_str(&project_id).map_err(|_| invalid("invalid project id"))?;
    let task_id = TaskId::from_str(&task_id).map_err(|_| invalid("invalid task id"))?;
    runtime
        .open_task_attachment(
            &request_id,
            &idempotency_key,
            &project_id,
            &task_id,
            &attachment_id,
        )
        .await?;
    Ok(OpenAttachmentResponse {
        attachment_id,
        status: "opened",
    })
}

fn invalid(message: &str) -> CommandError {
    CommandError::invalid_input(message)
}
