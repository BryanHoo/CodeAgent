use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

use data_encoding::BASE64;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use uuid::Uuid;

const MAX_ENTRIES: usize = 1_500;
const MAX_TOTAL_BYTES: usize = 512 * 1024 * 1024;

struct StoredAttachment {
    bytes: Vec<u8>,
    source_key: String,
    task_id: String,
}

#[derive(Default)]
pub(crate) struct HistoricalAttachmentStore {
    entries: Mutex<HashMap<String, StoredAttachment>>,
}

impl HistoricalAttachmentStore {
    pub(crate) async fn add_local_image(
        &self,
        task_id: &str,
        path: &str,
        image_index: usize,
    ) -> Option<Value> {
        let path = Path::new(path);
        if !path.is_absolute() {
            return None;
        }
        let metadata = tokio::fs::metadata(path).await.ok()?;
        if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_TOTAL_BYTES as u64 {
            return None;
        }
        let bytes = tokio::fs::read(path).await.ok()?;
        let media_type = detect_image_media_type(&bytes)?;
        let name = path
            .file_name()
            .and_then(|name| name.to_str())
            .filter(|name| !name.is_empty())
            .map_or_else(
                || format!("图片-{}", image_index + 1),
                |name| name.chars().take(255).collect(),
            );
        let source_key = format!(
            "local:{path}:{}:{}",
            metadata.len(),
            metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .map_or(0, |duration| duration.as_nanos()),
            path = path.display()
        );
        self.add(task_id, source_key, media_type, name, bytes)
    }

    pub(crate) fn add_data_url(
        &self,
        task_id: &str,
        url: &str,
        name: Option<&str>,
        image_index: usize,
    ) -> Option<Value> {
        let (header, encoded) = url.split_once(',')?;
        let declared_media_type = header.strip_prefix("data:")?.strip_suffix(";base64")?;
        if !matches!(
            declared_media_type,
            "image/gif" | "image/jpeg" | "image/png" | "image/webp"
        ) {
            return None;
        }
        if encoded.len() > MAX_TOTAL_BYTES.saturating_mul(4).div_ceil(3) + 4 {
            return None;
        }
        let bytes = BASE64.decode(encoded.as_bytes()).ok()?;
        let detected_media_type = detect_image_media_type(&bytes)?;
        if detected_media_type != declared_media_type {
            return None;
        }
        let name = normalized_name(name, &format!("图片-{}", image_index + 1));
        self.add(
            task_id,
            source_digest("inline", declared_media_type.as_bytes(), &bytes),
            declared_media_type,
            name,
            bytes,
        )
    }

    pub(crate) fn add_base64_image(
        &self,
        task_id: &str,
        encoded: &str,
        image_index: usize,
    ) -> Option<Value> {
        if encoded.len() > MAX_TOTAL_BYTES.saturating_mul(4).div_ceil(3) + 4 {
            return None;
        }
        let bytes = BASE64.decode(encoded.as_bytes()).ok()?;
        let media_type = detect_image_media_type(&bytes)?;
        let extension = match media_type {
            "image/gif" => ".gif",
            "image/jpeg" => ".jpg",
            "image/png" => ".png",
            "image/webp" => ".webp",
            _ => return None,
        };
        self.add(
            task_id,
            source_digest("generated", media_type.as_bytes(), &bytes),
            media_type,
            format!("生成图片-{}{extension}", image_index + 1),
            bytes,
        )
    }

    pub(crate) fn add_text(
        &self,
        task_id: &str,
        name: &str,
        text: &[u8],
        text_index: usize,
    ) -> Option<Value> {
        if text.is_empty() || text.len() > 1024 * 1024 {
            return None;
        }
        let name = normalized_name(Some(name), &format!("粘贴文本-{}.txt", text_index + 1));
        self.add_with_kind(
            task_id,
            source_digest("text", name.as_bytes(), text),
            "text",
            "text/plain",
            name,
            text.to_vec(),
        )
    }

    pub(crate) fn read(&self, task_id: &str, attachment_id: &str) -> Option<Vec<u8>> {
        self.entries.lock().ok().and_then(|entries| {
            entries
                .get(attachment_id)
                .filter(|entry| entry.task_id == task_id)
                .map(|entry| entry.bytes.clone())
        })
    }

    pub(crate) fn clear_task(&self, task_id: &str) {
        if let Ok(mut entries) = self.entries.lock() {
            entries.retain(|_, entry| entry.task_id != task_id);
        }
    }

    fn add(
        &self,
        task_id: &str,
        source_key: String,
        media_type: &str,
        name: String,
        bytes: Vec<u8>,
    ) -> Option<Value> {
        self.add_with_kind(task_id, source_key, "image", media_type, name, bytes)
    }

    fn add_with_kind(
        &self,
        task_id: &str,
        source_key: String,
        kind: &str,
        media_type: &str,
        name: String,
        bytes: Vec<u8>,
    ) -> Option<Value> {
        let mut entries = self.entries.lock().ok()?;
        if let Some((id, entry)) = entries
            .iter()
            .find(|(_, entry)| entry.task_id == task_id && entry.source_key == source_key)
        {
            return Some(metadata(id, kind, media_type, &name, entry.bytes.len()));
        }
        let total_bytes = entries
            .values()
            .map(|entry| entry.bytes.len())
            .sum::<usize>();
        if entries.len() >= MAX_ENTRIES || total_bytes.saturating_add(bytes.len()) > MAX_TOTAL_BYTES
        {
            return None;
        }
        let size = bytes.len();
        let id = Uuid::new_v4().to_string();
        entries.insert(
            id.clone(),
            StoredAttachment {
                bytes,
                source_key,
                task_id: task_id.to_string(),
            },
        );
        Some(metadata(&id, kind, media_type, &name, size))
    }
}

fn metadata(id: &str, kind: &str, media_type: &str, name: &str, size: usize) -> Value {
    json!({
        "id": id,
        "kind": kind,
        "mediaType": media_type,
        "name": name,
        "size": size
    })
}

fn normalized_name(value: Option<&str>, fallback: &str) -> String {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map_or_else(
            || fallback.to_string(),
            |value| value.chars().take(255).collect(),
        )
}

fn source_digest(kind: &str, metadata: &[u8], bytes: &[u8]) -> String {
    // 来源指纹用于重复 Snapshot 复用授权 ID，且不能再次持有 Base64 或粘贴正文。
    let mut digest = Sha256::new();
    digest.update(kind.as_bytes());
    digest.update([0]);
    digest.update(metadata);
    digest.update([0]);
    digest.update(bytes);
    format!("{kind}:{:x}", digest.finalize())
}

fn detect_image_media_type(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[137, 80, 78, 71, 13, 10, 26, 10]) {
        return Some("image/png");
    }
    if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        return Some("image/jpeg");
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Some("image/gif");
    }
    if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        return Some("image/webp");
    }
    None
}
