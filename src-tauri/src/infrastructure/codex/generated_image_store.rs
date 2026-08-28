use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};

pub(super) const IMAGE_ATTACHMENT_FIELD: &str = "codeagentAttachment";
const IMAGE_GENERATION_MARKER: &[u8] = b"\"imageGeneration\"";
const MAX_GENERATED_IMAGE_BYTES: usize = 50 * 1024 * 1024;
static NEXT_TEMP_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Clone)]
pub(super) struct GeneratedImageStore {
    directory: PathBuf,
}

impl GeneratedImageStore {
    pub(super) fn new(app_data: &Path) -> Self {
        Self {
            directory: app_data.join("attachments/generated"),
        }
    }

    pub(super) fn contains_image_generation(frame: &[u8]) -> bool {
        frame
            .windows(IMAGE_GENERATION_MARKER.len())
            .any(|window| window == IMAGE_GENERATION_MARKER)
    }

    pub(super) fn sanitize_frame(&self, frame: Vec<u8>) -> Result<Vec<u8>, serde_json::Error> {
        let mut value: Value = serde_json::from_slice(&frame)?;
        if !self.sanitize_value(&mut value) {
            return Ok(frame);
        }
        serde_json::to_vec(&value)
    }

    fn sanitize_value(&self, value: &mut Value) -> bool {
        match value {
            Value::Array(values) => {
                let mut changed = false;
                for value in values {
                    changed |= self.sanitize_value(value);
                }
                changed
            }
            Value::Object(object) => {
                let mut changed = false;
                if object.get("type").and_then(Value::as_str) == Some("imageGeneration") {
                    self.sanitize_image_generation(object);
                    changed = true;
                }
                for value in object.values_mut() {
                    changed |= self.sanitize_value(value);
                }
                changed
            }
            _ => false,
        }
    }

    fn sanitize_image_generation(&self, object: &mut Map<String, Value>) {
        let encoded = object
            .remove("result")
            .and_then(|value| value.as_str().map(str::to_owned));
        // 无论落盘是否成功，Base64 都不能继续进入事件映射和 WebView。
        object.insert("result".to_owned(), Value::Null);
        if object.get("status").and_then(Value::as_str) != Some("completed") {
            return;
        }
        let content = object
            .get("savedPath")
            .and_then(Value::as_str)
            .and_then(read_saved_image)
            .or_else(|| encoded.as_deref().and_then(decode_image));
        let Some((content, media_type, extension)) = content else {
            return;
        };
        let Some(path) = self.store_content(&content, extension) else {
            return;
        };
        object.insert(
            IMAGE_ATTACHMENT_FIELD.to_owned(),
            json!({
                "id": path.to_string_lossy(),
                "kind": "image",
                "mediaType": media_type,
                "name": format!("generated-image.{extension}"),
                "size": content.len(),
            }),
        );
    }

    fn store_content(&self, content: &[u8], extension: &str) -> Option<PathBuf> {
        fs::create_dir_all(&self.directory).ok()?;
        let digest = Sha256::digest(content)
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        let destination = self.directory.join(format!("{digest}.{extension}"));
        if destination.is_file() {
            return Some(destination);
        }
        let temp = self.directory.join(format!(
            ".{digest}.{}.tmp",
            NEXT_TEMP_ID.fetch_add(1, Ordering::Relaxed)
        ));
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temp)
            .ok()?;
        if file.write_all(content).is_err() || file.sync_all().is_err() {
            let _ = fs::remove_file(&temp);
            return None;
        }
        drop(file);
        if fs::rename(&temp, &destination).is_err() {
            let _ = fs::remove_file(&temp);
            if !destination.is_file() {
                return None;
            }
        }
        Some(destination)
    }
}

fn read_saved_image(path: &str) -> Option<(Vec<u8>, &'static str, &'static str)> {
    let metadata = fs::metadata(path).ok()?;
    let size = usize::try_from(metadata.len()).ok()?;
    if !metadata.is_file() || size == 0 || size > MAX_GENERATED_IMAGE_BYTES {
        return None;
    }
    let content = fs::read(path).ok()?;
    detect_image(&content).map(|(media_type, extension)| (content, media_type, extension))
}

fn decode_image(encoded: &str) -> Option<(Vec<u8>, &'static str, &'static str)> {
    if encoded.is_empty() || encoded.len() > MAX_GENERATED_IMAGE_BYTES * 4 / 3 + 4 {
        return None;
    }
    let content = STANDARD.decode(encoded).ok()?;
    if content.is_empty() || content.len() > MAX_GENERATED_IMAGE_BYTES {
        return None;
    }
    detect_image(&content).map(|(media_type, extension)| (content, media_type, extension))
}

fn detect_image(content: &[u8]) -> Option<(&'static str, &'static str)> {
    if content.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some(("image/png", "png"))
    } else if content.starts_with(&[0xff, 0xd8, 0xff]) {
        Some(("image/jpeg", "jpg"))
    } else if content.starts_with(b"GIF87a") || content.starts_with(b"GIF89a") {
        Some(("image/gif", "gif"))
    } else if content.starts_with(b"RIFF") && content.get(8..12) == Some(b"WEBP") {
        Some(("image/webp", "webp"))
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use std::time::SystemTime;

    use super::*;

    #[test]
    fn image_generation_frame_should_store_body_and_keep_only_metadata() {
        let unique = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("codeagent-generated-image-{unique}"));
        let store = GeneratedImageStore::new(&root);
        let encoded = "iVBORw0KGgo=";
        let frame = format!(
            r#"{{"method":"item/completed","params":{{"item":{{"id":"image-a","result":"{encoded}","status":"completed","type":"imageGeneration"}}}}}}"#
        );

        let sanitized = store
            .sanitize_frame(frame.into_bytes())
            .expect("frame should remain valid JSON");
        let value: Value = serde_json::from_slice(&sanitized).unwrap();
        let attachment = &value["params"]["item"][IMAGE_ATTACHMENT_FIELD];

        assert_eq!(value["params"]["item"]["result"], Value::Null);
        assert_eq!(attachment["mediaType"], "image/png");
        assert_eq!(attachment["size"], 8);
        assert!(!String::from_utf8(sanitized).unwrap().contains(encoded));
        assert!(Path::new(attachment["id"].as_str().unwrap()).is_file());
        fs::remove_dir_all(root).unwrap();
    }
}
