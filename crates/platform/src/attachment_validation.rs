use std::path::Path;

use code_agent_core::{CodeAgentError, CodeAgentErrorCode};

use crate::attachments::{AttachmentKind, AttachmentUpload};

const MAX_FILE_BYTES: usize = 50 * 1024 * 1024;
const MAX_IMAGE_BYTES: usize = 10 * 1024 * 1024;
const MAX_TEXT_BYTES: usize = 1024 * 1024;

pub(crate) fn validate_upload(upload: &AttachmentUpload) -> Result<(), CodeAgentError> {
    if upload.bytes.is_empty() || upload.name.is_empty() || upload.name.chars().count() > 255 {
        return Err(invalid("attachment metadata or content is invalid"));
    }
    let maximum = match upload.kind {
        AttachmentKind::File => MAX_FILE_BYTES,
        AttachmentKind::Image => MAX_IMAGE_BYTES,
        AttachmentKind::Text => MAX_TEXT_BYTES,
    };
    if upload.bytes.len() > maximum {
        return Err(capacity("attachment exceeds the maximum size"));
    }
    match upload.kind {
        AttachmentKind::Image if !valid_image(&upload.bytes, &upload.media_type) => {
            Err(invalid("attachment image content is invalid"))
        }
        AttachmentKind::Text
            if upload.media_type != "text/plain" || std::str::from_utf8(&upload.bytes).is_err() =>
        {
            Err(invalid("text attachment must contain UTF-8 text/plain"))
        }
        AttachmentKind::File if upload.media_type.is_empty() => {
            Err(invalid("attachment media type is invalid"))
        }
        _ => Ok(()),
    }
}

pub(crate) fn infer_media_type(
    kind: AttachmentKind,
    path: &Path,
) -> Result<String, CodeAgentError> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let media_type = match (kind, extension.as_str()) {
        (AttachmentKind::Image, "png") => "image/png",
        (AttachmentKind::Image, "jpg" | "jpeg") => "image/jpeg",
        (AttachmentKind::Image, "gif") => "image/gif",
        (AttachmentKind::Image, "webp") => "image/webp",
        (AttachmentKind::Text, _) => "text/plain",
        (AttachmentKind::File, _) => "application/octet-stream",
        _ => return Err(invalid("host attachment type is unsupported")),
    };
    Ok(media_type.to_owned())
}

fn valid_image(bytes: &[u8], media_type: &str) -> bool {
    match media_type {
        "image/png" => bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]),
        "image/jpeg" => bytes.starts_with(&[0xff, 0xd8, 0xff]),
        "image/gif" => bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a"),
        "image/webp" => bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP"),
        _ => false,
    }
}

fn invalid(message: &'static str) -> CodeAgentError {
    CodeAgentError::new(CodeAgentErrorCode::InvalidInput, message, None)
}

fn capacity(message: &'static str) -> CodeAgentError {
    CodeAgentError::new(CodeAgentErrorCode::CapacityExceeded, message, None)
}
