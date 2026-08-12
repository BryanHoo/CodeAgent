use std::{str::FromStr, sync::Arc};

use code_agent_protocol::{ProjectId, TaskId};
use code_agent_runtime::CodeAgentRuntime;
use percent_encoding::percent_decode_str;
use tauri::{Manager, Runtime, UriSchemeContext, UriSchemeResponder, http};
use uuid::Uuid;

pub fn handle_asset_request<R: Runtime>(
    context: UriSchemeContext<'_, R>,
    request: http::Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let runtime = context
        .app_handle()
        .state::<Arc<CodeAgentRuntime>>()
        .inner()
        .clone();
    let path = request.uri().path().to_owned();
    tauri::async_runtime::spawn(async move {
        let response = match read_asset(runtime, &path).await {
            Ok(bytes) => http::Response::builder()
                .status(http::StatusCode::OK)
                .header(http::header::CONTENT_TYPE, detect_media_type(&bytes))
                .header(http::header::CACHE_CONTROL, "private, no-store")
                .body(bytes),
            Err(status) => http::Response::builder()
                .status(status)
                .header(http::header::CACHE_CONTROL, "no-store")
                .body(Vec::new()),
        }
        .unwrap_or_else(|_| http::Response::new(Vec::new()));
        responder.respond(response);
    });
}

async fn read_asset(
    runtime: Arc<CodeAgentRuntime>,
    path: &str,
) -> Result<Vec<u8>, http::StatusCode> {
    let decoded_path = decode_segment(path.trim_start_matches('/'))?;
    let segments = decoded_path
        .split('/')
        .map(decode_segment)
        .collect::<Result<Vec<_>, _>>()?;
    let request_id = format!("asset-{}", Uuid::new_v4());
    match segments.as_slice() {
        [kind, project_id, attachment_id] if kind == "project-attachment" => {
            let project_id = parse_project(project_id)?;
            runtime
                .pending_attachment(&request_id, &project_id, attachment_id)
                .await
                .map_err(|_| http::StatusCode::NOT_FOUND)
        }
        [kind, project_id, task_id, attachment_id] if kind == "task-attachment" => {
            let project_id = parse_project(project_id)?;
            let task_id = TaskId::from_str(task_id).map_err(|_| http::StatusCode::BAD_REQUEST)?;
            runtime
                .task_attachment(&request_id, &project_id, &task_id, attachment_id)
                .await
                .map_err(|_| http::StatusCode::NOT_FOUND)
        }
        [kind, project_id, image_path] if kind == "project-image" => {
            let project_id = parse_project(project_id)?;
            runtime
                .project_image(&request_id, &project_id, image_path)
                .await
                .map_err(|_| http::StatusCode::NOT_FOUND)
        }
        _ => Err(http::StatusCode::BAD_REQUEST),
    }
}

fn decode_segment(value: &str) -> Result<String, http::StatusCode> {
    percent_decode_str(value)
        .decode_utf8()
        .map(|value| value.into_owned())
        .map_err(|_| http::StatusCode::BAD_REQUEST)
}

fn parse_project(value: &str) -> Result<ProjectId, http::StatusCode> {
    ProjectId::from_str(value).map_err(|_| http::StatusCode::BAD_REQUEST)
}

fn detect_media_type(bytes: &[u8]) -> &'static str {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]) {
        "image/png"
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        "image/jpeg"
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        "image/gif"
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        "image/webp"
    } else {
        "application/octet-stream"
    }
}
