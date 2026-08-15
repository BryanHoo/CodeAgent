use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, Instant, SystemTime},
};

use code_agent_core::AttachmentBytes;
use data_encoding::BASE64;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tokio::io::AsyncReadExt;
use uuid::Uuid;

const ATTACHMENT_TTL: Duration = Duration::from_secs(30 * 60);
const MAX_ENTRIES: usize = 1_500;
const MAX_IMAGE_BYTES: usize = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES: usize = 512 * 1024 * 1024;

#[derive(Clone)]
struct AttachmentMetadata {
    kind: &'static str,
    media_type: &'static str,
    name: String,
    size: usize,
}

enum StoredSource {
    Inline(Arc<[u8]>),
    Local { modified: SystemTime, path: PathBuf },
}

struct StoredAttachment {
    expires_at: Instant,
    last_access: u64,
    metadata: AttachmentMetadata,
    source: StoredSource,
    source_key: String,
    task_id: String,
}

#[derive(Default)]
struct StoreState {
    access_sequence: u64,
    entries: HashMap<String, StoredAttachment>,
    total_bytes: usize,
}

pub(crate) struct HistoricalAttachmentStore {
    max_entries: usize,
    max_total_bytes: usize,
    state: Mutex<StoreState>,
    ttl: Duration,
}

impl Default for HistoricalAttachmentStore {
    fn default() -> Self {
        Self {
            max_entries: MAX_ENTRIES,
            max_total_bytes: MAX_TOTAL_BYTES,
            state: Mutex::new(StoreState::default()),
            ttl: ATTACHMENT_TTL,
        }
    }
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
        if !valid_local_file(&metadata) {
            return None;
        }
        let modified = metadata.modified().ok()?;
        let media_type = read_image_media_type(path).await?;
        let source_key = format!("local:{}:{}:{modified:?}", path.display(), metadata.len());
        self.add_entry(
            task_id,
            source_key,
            AttachmentMetadata {
                kind: "image",
                media_type,
                name: local_image_name(path, media_type, image_index),
                size: usize::try_from(metadata.len()).ok()?,
            },
            StoredSource::Local {
                modified,
                path: path.to_owned(),
            },
        )
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
        if !is_image_media_type(declared_media_type) {
            return None;
        }
        let bytes = decode_base64_image(encoded)?;
        let detected_media_type = detect_image_media_type(&bytes)?;
        if detected_media_type != declared_media_type {
            return None;
        }
        self.add_inline(
            task_id,
            source_digest("inline", declared_media_type.as_bytes(), &bytes),
            "image",
            detected_media_type,
            normalized_name(name, &format!("图片-{}", image_index + 1)),
            bytes,
        )
    }

    pub(crate) fn add_base64_image(
        &self,
        task_id: &str,
        encoded: &str,
        image_index: usize,
    ) -> Option<Value> {
        let bytes = decode_base64_image(encoded)?;
        let media_type = detect_image_media_type(&bytes)?;
        let extension = image_extension(media_type)?;
        self.add_inline(
            task_id,
            source_digest("generated", media_type.as_bytes(), &bytes),
            "image",
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
        self.add_inline(
            task_id,
            source_digest("text", name.as_bytes(), text),
            "text",
            "text/plain",
            name,
            text.to_vec(),
        )
    }

    pub(crate) async fn read(&self, task_id: &str, attachment_id: &str) -> Option<AttachmentBytes> {
        let local = {
            let mut state = self.state.lock().ok()?;
            let now = Instant::now();
            prune_expired(&mut state, now);
            let sequence = next_access_sequence(&mut state);
            let entry = state
                .entries
                .get_mut(attachment_id)
                .filter(|entry| entry.task_id == task_id)?;
            entry.last_access = sequence;
            entry.expires_at = now + self.ttl;
            match &entry.source {
                StoredSource::Inline(bytes) => return Some(AttachmentBytes::Shared(bytes.clone())),
                StoredSource::Local { modified, path } => {
                    (path.clone(), *modified, entry.metadata.clone())
                }
            }
        };
        let bytes = read_valid_local_image(&local.0, local.1, &local.2).await;
        if bytes.is_none() {
            self.remove(attachment_id);
        }
        bytes.map(AttachmentBytes::Owned)
    }

    pub(crate) fn clear_task(&self, task_id: &str) {
        if let Ok(mut state) = self.state.lock() {
            let ids = state
                .entries
                .iter()
                .filter(|(_, entry)| entry.task_id == task_id)
                .map(|(id, _)| id.clone())
                .collect::<Vec<_>>();
            for id in ids {
                remove_entry(&mut state, &id);
            }
        }
    }

    fn add_inline(
        &self,
        task_id: &str,
        source_key: String,
        kind: &'static str,
        media_type: &'static str,
        name: String,
        bytes: Vec<u8>,
    ) -> Option<Value> {
        if bytes.is_empty() || (kind == "image" && bytes.len() > MAX_IMAGE_BYTES) {
            return None;
        }
        let size = bytes.len();
        self.add_entry(
            task_id,
            source_key,
            AttachmentMetadata {
                kind,
                media_type,
                name,
                size,
            },
            StoredSource::Inline(bytes.into()),
        )
    }

    fn add_entry(
        &self,
        task_id: &str,
        source_key: String,
        metadata: AttachmentMetadata,
        source: StoredSource,
    ) -> Option<Value> {
        let now = Instant::now();
        let mut state = self.state.lock().ok()?;
        prune_expired(&mut state, now);
        let sequence = next_access_sequence(&mut state);
        if let Some((id, entry)) = state.entries.iter_mut().find(|(_, entry)| {
            entry.task_id == task_id
                && entry.source_key == source_key
                && entry.metadata.kind == metadata.kind
                && entry.metadata.media_type == metadata.media_type
                && entry.metadata.name == metadata.name
                && entry.metadata.size == metadata.size
        }) {
            entry.expires_at = now + self.ttl;
            entry.last_access = sequence;
            return Some(metadata_value(id, &entry.metadata));
        }
        if metadata.size > self.max_total_bytes {
            return None;
        }
        while state.entries.len() >= self.max_entries
            || state.total_bytes.saturating_add(metadata.size) > self.max_total_bytes
        {
            let oldest = state
                .entries
                .iter()
                .min_by_key(|(_, entry)| entry.last_access)
                .map(|(id, _)| id.clone())?;
            remove_entry(&mut state, &oldest);
        }
        let id = Uuid::new_v4().to_string();
        state.total_bytes += metadata.size;
        let value = metadata_value(&id, &metadata);
        state.entries.insert(
            id,
            StoredAttachment {
                expires_at: now + self.ttl,
                last_access: sequence,
                metadata,
                source,
                source_key,
                task_id: task_id.to_owned(),
            },
        );
        Some(value)
    }

    fn remove(&self, attachment_id: &str) {
        if let Ok(mut state) = self.state.lock() {
            remove_entry(&mut state, attachment_id);
        }
    }

    #[cfg(test)]
    fn with_limits(ttl: Duration, max_entries: usize, max_total_bytes: usize) -> Self {
        Self {
            max_entries,
            max_total_bytes,
            state: Mutex::new(StoreState::default()),
            ttl,
        }
    }
}

fn next_access_sequence(state: &mut StoreState) -> u64 {
    state.access_sequence = state.access_sequence.wrapping_add(1);
    state.access_sequence
}

fn prune_expired(state: &mut StoreState, now: Instant) {
    let expired = state
        .entries
        .iter()
        .filter(|(_, entry)| entry.expires_at <= now)
        .map(|(id, _)| id.clone())
        .collect::<Vec<_>>();
    for id in expired {
        remove_entry(state, &id);
    }
}

fn remove_entry(state: &mut StoreState, attachment_id: &str) {
    if let Some(entry) = state.entries.remove(attachment_id) {
        state.total_bytes = state.total_bytes.saturating_sub(entry.metadata.size);
    }
}

fn valid_local_file(metadata: &std::fs::Metadata) -> bool {
    metadata.is_file() && metadata.len() > 0 && metadata.len() <= MAX_IMAGE_BYTES as u64
}

async fn read_image_media_type(path: &Path) -> Option<&'static str> {
    let mut file = tokio::fs::File::open(path).await.ok()?;
    let mut header = [0_u8; 12];
    let length = file.read(&mut header).await.ok()?;
    detect_image_media_type(&header[..length])
}

async fn read_valid_local_image(
    path: &Path,
    modified: SystemTime,
    expected: &AttachmentMetadata,
) -> Option<Vec<u8>> {
    let before = tokio::fs::metadata(path).await.ok()?;
    if !valid_local_file(&before)
        || before.len() != expected.size as u64
        || before.modified().ok()? != modified
    {
        return None;
    }
    let bytes = tokio::fs::read(path).await.ok()?;
    let after = tokio::fs::metadata(path).await.ok()?;
    if after.len() != before.len()
        || after.modified().ok()? != modified
        || bytes.len() != expected.size
        || detect_image_media_type(&bytes) != Some(expected.media_type)
    {
        return None;
    }
    Some(bytes)
}

fn local_image_name(path: &Path, media_type: &str, image_index: usize) -> String {
    let native_name = path.file_name().and_then(|name| name.to_str());
    let matching_extension = native_name.is_some_and(|name| {
        let extension = Path::new(name)
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        matches!(
            (extension.as_str(), media_type),
            ("png", "image/png")
                | ("jpg" | "jpeg", "image/jpeg")
                | ("gif", "image/gif")
                | ("webp", "image/webp")
        )
    });
    normalized_name(
        matching_extension.then_some(native_name).flatten(),
        &format!("图片-{}", image_index + 1),
    )
}

fn decode_base64_image(encoded: &str) -> Option<Vec<u8>> {
    if encoded.is_empty() || encoded.len() > MAX_IMAGE_BYTES.saturating_mul(4).div_ceil(3) + 4 {
        return None;
    }
    let bytes = BASE64.decode(encoded.as_bytes()).ok()?;
    (!bytes.is_empty() && bytes.len() <= MAX_IMAGE_BYTES).then_some(bytes)
}

fn metadata_value(id: &str, metadata: &AttachmentMetadata) -> Value {
    json!({
        "id": id,
        "kind": metadata.kind,
        "mediaType": metadata.media_type,
        "name": metadata.name,
        "size": metadata.size
    })
}

fn normalized_name(value: Option<&str>, fallback: &str) -> String {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map_or_else(
            || fallback.to_owned(),
            |value| value.chars().take(255).collect(),
        )
}

fn source_digest(kind: &str, metadata: &[u8], bytes: &[u8]) -> String {
    // 来源指纹只保留摘要，避免重复持有 Base64 或粘贴正文。
    let mut digest = Sha256::new();
    digest.update(kind.as_bytes());
    digest.update([0]);
    digest.update(metadata);
    digest.update([0]);
    digest.update(bytes);
    format!("{kind}:{:x}", digest.finalize())
}

fn image_extension(media_type: &str) -> Option<&'static str> {
    match media_type {
        "image/gif" => Some(".gif"),
        "image/jpeg" => Some(".jpg"),
        "image/png" => Some(".png"),
        "image/webp" => Some(".webp"),
        _ => None,
    }
}

fn is_image_media_type(media_type: &str) -> bool {
    matches!(
        media_type,
        "image/gif" | "image/jpeg" | "image/png" | "image/webp"
    )
}

fn detect_image_media_type(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[137, 80, 78, 71, 13, 10, 26, 10]) {
        Some("image/png")
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("image/gif")
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        Some("image/webp")
    } else {
        None
    }
}

#[cfg(test)]
#[path = "historical_attachments_tests.rs"]
mod tests;
