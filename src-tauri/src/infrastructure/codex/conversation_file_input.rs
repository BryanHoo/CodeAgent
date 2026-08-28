use std::path::Path;

use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

use super::connection::ConnectionError;

const FILE_PLACEHOLDER_PREFIX: &str = "codexly-file:";
const MAX_FILE_BYTES: usize = 1024 * 1024;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileMetadata {
    kind: String,
    media_type: String,
    name: String,
    size: usize,
}

pub(super) fn create_file_text_input(attachment: &Value) -> Result<Value, ConnectionError> {
    let object = attachment
        .as_object()
        .ok_or(ConnectionError::InvalidMessage)?;
    let path = required_string(object, "id")?;
    let metadata = FileMetadata {
        kind: required_string(object, "kind")?.to_owned(),
        media_type: required_string(object, "mediaType")?.to_owned(),
        name: required_string(object, "name")?.to_owned(),
        size: required_size(object)?,
    };
    validate_metadata(&metadata)?;
    if !Path::new(path).is_absolute() {
        return Err(ConnectionError::InvalidMessage);
    }
    let encoded = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&metadata)?);
    Ok(json!({
        "text": path,
        "text_elements": [{
            "byteRange": {"start": 0, "end": path.len()},
            "placeholder": format!("{FILE_PLACEHOLDER_PREFIX}{encoded}"),
        }],
        "type": "text",
    }))
}

pub(super) fn read_file_text_input(
    object: &Map<String, Value>,
) -> Result<Option<Value>, ConnectionError> {
    let text = required_string(object, "text")?;
    let Some(elements) = object.get("text_elements").and_then(Value::as_array) else {
        return Ok(None);
    };
    let [element] = elements.as_slice() else {
        return Ok(None);
    };
    let Some(element) = element.as_object() else {
        return Ok(None);
    };
    let Some(range) = element.get("byteRange").and_then(Value::as_object) else {
        return Ok(None);
    };
    if range.get("start").and_then(Value::as_u64) != Some(0)
        || range.get("end").and_then(Value::as_u64) != u64::try_from(text.len()).ok()
    {
        return Ok(None);
    }
    let Some(encoded) = element
        .get("placeholder")
        .and_then(Value::as_str)
        .and_then(|value| value.strip_prefix(FILE_PLACEHOLDER_PREFIX))
    else {
        return Ok(None);
    };
    let metadata: FileMetadata = URL_SAFE_NO_PAD
        .decode(encoded)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .ok_or(ConnectionError::InvalidMessage)?;
    validate_metadata(&metadata)?;
    if !Path::new(text).is_absolute() {
        return Err(ConnectionError::InvalidMessage);
    }
    Ok(Some(json!({
        "id": text,
        "kind": metadata.kind,
        "mediaType": metadata.media_type,
        "name": metadata.name,
        "size": metadata.size,
    })))
}

fn validate_metadata(metadata: &FileMetadata) -> Result<(), ConnectionError> {
    if !matches!(metadata.kind.as_str(), "file" | "text")
        || metadata.media_type.is_empty()
        || metadata.media_type.len() > 255
        || metadata.name.is_empty()
        || metadata.name.len() > 255
        || metadata.name.contains(['/', '\\', '\0', '\r', '\n'])
        || metadata.size == 0
        || metadata.size > MAX_FILE_BYTES
    {
        return Err(ConnectionError::InvalidMessage);
    }
    Ok(())
}

fn required_string<'a>(
    object: &'a Map<String, Value>,
    key: &str,
) -> Result<&'a str, ConnectionError> {
    object
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or(ConnectionError::InvalidMessage)
}

fn required_size(object: &Map<String, Value>) -> Result<usize, ConnectionError> {
    object
        .get("size")
        .and_then(Value::as_u64)
        .and_then(|value| usize::try_from(value).ok())
        .ok_or(ConnectionError::InvalidMessage)
}
