use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime};

use serde_json::Value;
use tokio::io::{AsyncReadExt, AsyncSeekExt};

use crate::mapping::message_skills::extract_text_skills;

const MAX_CACHED_THREADS: usize = 256;
const MAX_CACHED_TURNS_PER_FILE: usize = 2_048;
const MAX_CACHED_SKILL_NAME_BYTES_PER_FILE: usize = 1024 * 1024;
const MAX_TRANSCRIPT_BYTES_PER_READ: usize = 8 * 1024 * 1024;
const MAX_TRANSCRIPT_FILES_PER_THREAD: usize = 8;
const MAX_TRANSCRIPT_LINE_BYTES: usize = 1024 * 1024;
const MAX_TRANSCRIPT_TREE_ENTRIES: usize = 10_000;
const TRANSCRIPT_DISCOVERY_INTERVAL: Duration = Duration::from_secs(5);

#[derive(Default)]
struct FileCache {
    cached_skill_name_bytes: usize,
    discard_until_newline: bool,
    modified: Option<SystemTime>,
    offset: u64,
    pending_line: Vec<u8>,
    size: u64,
    skill_turn_order: VecDeque<String>,
    skills_by_turn: HashMap<String, Vec<String>>,
}

#[derive(Default)]
struct ThreadCache {
    files: HashMap<PathBuf, FileCache>,
    last_discovery: Option<Instant>,
    paths: Vec<PathBuf>,
}

#[derive(Default)]
struct CacheState {
    order: VecDeque<String>,
    threads: HashMap<String, Arc<tokio::sync::Mutex<ThreadCache>>>,
}

pub(crate) struct TranscriptSkillStore {
    codex_home: Option<PathBuf>,
    state: tokio::sync::Mutex<CacheState>,
}

impl TranscriptSkillStore {
    pub(crate) fn new(codex_home: Option<PathBuf>) -> Self {
        Self {
            codex_home,
            state: tokio::sync::Mutex::new(CacheState::default()),
        }
    }

    pub(crate) async fn read(&self, task_id: &str) -> HashMap<String, Vec<String>> {
        let Some(codex_home) = &self.codex_home else {
            return HashMap::new();
        };
        if !task_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
        {
            return HashMap::new();
        }

        let cache = {
            let mut state = self.state.lock().await;
            touch_thread(&mut state, task_id)
        };
        let mut cache = cache.lock().await;
        if cache.paths.is_empty()
            && cache
                .last_discovery
                .is_none_or(|last| last.elapsed() >= TRANSCRIPT_DISCOVERY_INTERVAL)
        {
            cache.paths = discover_transcripts(codex_home, task_id).await;
            cache.last_discovery = Some(Instant::now());
        }
        let mut remaining = MAX_TRANSCRIPT_BYTES_PER_READ;
        for path in cache.paths.clone() {
            if remaining == 0 {
                break;
            }
            let file_cache = cache.files.entry(path.clone()).or_default();
            if let Ok(read) = parse_appended_bytes(&path, file_cache, remaining).await {
                remaining -= read;
            }
        }
        merge_thread_skills(&cache)
    }
}

fn touch_thread(state: &mut CacheState, task_id: &str) -> Arc<tokio::sync::Mutex<ThreadCache>> {
    state.order.retain(|current| current != task_id);
    state.order.push_back(task_id.to_string());
    while state.order.len() > MAX_CACHED_THREADS {
        if let Some(expired) = state.order.pop_front() {
            state.threads.remove(&expired);
        }
    }
    Arc::clone(
        state
            .threads
            .entry(task_id.to_string())
            .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(ThreadCache::default()))),
    )
}

async fn discover_transcripts(codex_home: &Path, task_id: &str) -> Vec<PathBuf> {
    let root = codex_home.join("sessions");
    let mut pending = vec![root];
    let mut paths = Vec::new();
    let mut visited = 0;
    while let Some(directory) = pending.pop() {
        let Ok(mut entries) = tokio::fs::read_dir(directory).await else {
            continue;
        };
        while let Ok(Some(entry)) = entries.next_entry().await {
            visited += 1;
            if visited > MAX_TRANSCRIPT_TREE_ENTRIES {
                return paths;
            }
            let Ok(file_type) = entry.file_type().await else {
                continue;
            };
            if file_type.is_dir() {
                pending.push(entry.path());
                continue;
            }
            if !file_type.is_file() {
                continue;
            }
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name.starts_with("rollout-") && name.ends_with(&format!("-{task_id}.jsonl")) {
                paths.push(entry.path());
                if paths.len() == MAX_TRANSCRIPT_FILES_PER_THREAD {
                    return paths;
                }
            }
        }
    }
    paths
}

async fn parse_appended_bytes(
    path: &Path,
    cache: &mut FileCache,
    byte_budget: usize,
) -> std::io::Result<usize> {
    let metadata = tokio::fs::metadata(path).await?;
    let modified = metadata.modified().ok();
    let can_continue = metadata.len() >= cache.size
        && metadata.len() >= cache.offset
        && (metadata.len() > cache.size || modified == cache.modified);
    if cache.size > 0 && !can_continue {
        cache.offset = 0;
        cache.pending_line.clear();
        cache.discard_until_newline = false;
        cache.cached_skill_name_bytes = 0;
        cache.skill_turn_order.clear();
        cache.skills_by_turn.clear();
    }
    let available = metadata.len().saturating_sub(cache.offset) as usize;
    let bytes_to_read = available.min(byte_budget);
    if bytes_to_read == 0 {
        return Ok(0);
    }
    let mut file = tokio::fs::File::open(path).await?;
    file.seek(std::io::SeekFrom::Start(cache.offset)).await?;
    let mut bytes = vec![0; bytes_to_read];
    file.read_exact(&mut bytes).await?;
    cache.offset += bytes_to_read as u64;
    cache.modified = modified;
    cache.size = metadata.len();
    parse_lines(cache, &bytes);
    Ok(bytes_to_read)
}

fn parse_lines(cache: &mut FileCache, bytes: &[u8]) {
    let mut data = Vec::with_capacity(cache.pending_line.len() + bytes.len());
    data.append(&mut cache.pending_line);
    data.extend_from_slice(bytes);
    let mut start = 0;
    for (index, byte) in data.iter().enumerate() {
        if *byte != b'\n' {
            continue;
        }
        let line = &data[start..index];
        if !cache.discard_until_newline && line.len() <= MAX_TRANSCRIPT_LINE_BYTES {
            collect_line_skills(line.strip_suffix(b"\r").unwrap_or(line), cache);
        }
        cache.discard_until_newline = false;
        start = index + 1;
    }
    let incomplete = &data[start..];
    if incomplete.len() <= MAX_TRANSCRIPT_LINE_BYTES && !cache.discard_until_newline {
        cache.pending_line.extend_from_slice(incomplete);
    } else if !incomplete.is_empty() {
        cache.discard_until_newline = true;
    }
}

fn collect_line_skills(line: &[u8], cache: &mut FileCache) {
    let Ok(entry) = serde_json::from_slice::<Value>(line) else {
        return;
    };
    let payload = &entry["payload"];
    if entry["type"] != "response_item" || payload["type"] != "message" || payload["role"] != "user"
    {
        return;
    }
    let Some(turn_id) = payload
        .pointer("/internal_chat_message_metadata_passthrough/turn_id")
        .and_then(Value::as_str)
    else {
        return;
    };
    let Some(content) = payload["content"].as_array() else {
        return;
    };
    for part in content {
        let Some(text) = part["text"].as_str() else {
            continue;
        };
        for name in extract_text_skills(text).skills {
            cache_skill(cache, turn_id, name);
        }
    }
}

fn cache_skill(cache: &mut FileCache, turn_id: &str, name: String) {
    if cache
        .skills_by_turn
        .get(turn_id)
        .is_some_and(|names| names.contains(&name))
        || name.len() > MAX_CACHED_SKILL_NAME_BYTES_PER_FILE
    {
        return;
    }
    while (cache.skills_by_turn.len() >= MAX_CACHED_TURNS_PER_FILE
        && !cache.skills_by_turn.contains_key(turn_id))
        || cache.cached_skill_name_bytes + name.len() > MAX_CACHED_SKILL_NAME_BYTES_PER_FILE
    {
        let Some(expired) = cache.skill_turn_order.pop_front() else {
            return;
        };
        if let Some(names) = cache.skills_by_turn.remove(&expired) {
            cache.cached_skill_name_bytes -= names.iter().map(String::len).sum::<usize>();
        }
    }
    cache.skill_turn_order.retain(|current| current != turn_id);
    cache.skill_turn_order.push_back(turn_id.to_string());
    cache.cached_skill_name_bytes += name.len();
    cache
        .skills_by_turn
        .entry(turn_id.to_string())
        .or_default()
        .push(name);
}

fn merge_thread_skills(cache: &ThreadCache) -> HashMap<String, Vec<String>> {
    let mut merged = HashMap::<String, Vec<String>>::new();
    for path in &cache.paths {
        let Some(file) = cache.files.get(path) else {
            continue;
        };
        for (turn_id, names) in &file.skills_by_turn {
            let merged_names = merged.entry(turn_id.clone()).or_default();
            for name in names {
                if !merged_names.contains(name) {
                    merged_names.push(name.clone());
                }
            }
        }
    }
    merged
}
