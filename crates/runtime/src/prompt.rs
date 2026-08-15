use std::collections::HashSet;

use code_agent_core::{AttachmentPort, CodeAgentError, CodeAgentErrorCode, PortRequestContext};
use code_agent_protocol::{AgentAttachmentKind, ProjectId};
use serde_json::{Value, json};

const MAX_IMAGE_COUNT: usize = 20;
const MAX_IMAGE_BYTES: u64 = 50 * 1024 * 1024;
const MAX_FILE_BYTES: u64 = 50 * 1024 * 1024;

pub(crate) struct ResolvedPrompt {
    pub attachment_ids: Vec<String>,
    pub value: Value,
}

pub(crate) async fn resolve_prompt(
    attachments: &dyn AttachmentPort,
    project_id: &ProjectId,
    input: &Value,
    context: &PortRequestContext,
) -> Result<ResolvedPrompt, CodeAgentError> {
    let references = input["attachments"]
        .as_array()
        .ok_or_else(|| invalid("prompt attachments must be an array"))?;
    let mut ids = HashSet::with_capacity(references.len());
    let mut ordered_ids = Vec::with_capacity(references.len());
    let mut resolved = Vec::with_capacity(references.len());
    let mut image_count = 0usize;
    let mut image_bytes = 0u64;
    let mut file_bytes = 0u64;
    for reference in references {
        let id = reference["id"]
            .as_str()
            .filter(|id| !id.is_empty())
            .ok_or_else(|| invalid("prompt attachment id is invalid"))?;
        if !ids.insert(id) {
            return Err(invalid("duplicate prompt attachments are not allowed"));
        }
        let managed = attachments.resolve_pending(project_id, id, context).await?;
        let size = managed.attachment.size.get();
        match managed.attachment.kind {
            AgentAttachmentKind::Image => {
                image_count += 1;
                image_bytes = image_bytes.saturating_add(size);
            }
            AgentAttachmentKind::File | AgentAttachmentKind::Text => {
                file_bytes = file_bytes.saturating_add(size);
            }
        }
        ordered_ids.push(id.to_owned());
        resolved.push(json!({
            "kind": managed.attachment.kind,
            "mediaType": managed.attachment.media_type.as_str(),
            "name": managed.attachment.name.as_str(),
            "path": managed.path,
        }));
    }
    if image_count > MAX_IMAGE_COUNT || image_bytes > MAX_IMAGE_BYTES {
        return Err(invalid("prompt image input limit exceeded"));
    }
    if file_bytes > MAX_FILE_BYTES {
        return Err(invalid("prompt file input limit exceeded"));
    }
    Ok(ResolvedPrompt {
        attachment_ids: ordered_ids,
        value: json!({
            "attachments": resolved,
            "skills": input["skills"],
            "text": input["text"],
        }),
    })
}

fn invalid(message: &'static str) -> CodeAgentError {
    CodeAgentError::new(CodeAgentErrorCode::InvalidInput, message, None)
}
