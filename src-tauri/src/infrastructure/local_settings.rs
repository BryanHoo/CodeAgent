use std::{
    collections::BTreeMap,
    io,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use thiserror::Error;
use tokio::{fs, sync::Mutex};

const SETTINGS_VERSION: u8 = 1;
const GLOBAL_FIELDS: [&str; 11] = [
    "approvalPolicy",
    "approvalsReviewer",
    "commitMessageModel",
    "commitMessagePrompt",
    "defaultOpenAppId",
    "fastMode",
    "followUpBehavior",
    "model",
    "pet",
    "reasoningEffort",
    "sandboxMode",
];
const PROJECT_FIELDS: [&str; 6] = [
    "approvalPolicy",
    "approvalsReviewer",
    "fastMode",
    "model",
    "reasoningEffort",
    "sandboxMode",
];
static SETTINGS_LOCK: Mutex<()> = Mutex::const_new(());
static TEMP_FILE_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Error)]
pub enum LocalSettingsError {
    #[error("invalid local settings data")]
    InvalidData,
    #[error(transparent)]
    Io(#[from] io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

#[derive(Debug)]
pub struct SettingsUpdate {
    pub changed_fields: Vec<String>,
    pub settings: Value,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SettingsFile {
    global: Value,
    projects: BTreeMap<String, Value>,
    version: u8,
}

impl Default for SettingsFile {
    fn default() -> Self {
        Self {
            global: default_global_settings(),
            projects: BTreeMap::new(),
            version: SETTINGS_VERSION,
        }
    }
}

pub async fn read_global_settings(app_data: &Path) -> Result<Value, LocalSettingsError> {
    let _guard = SETTINGS_LOCK.lock().await;
    Ok(read_settings_file(app_data).await?.global)
}

pub async fn update_global_settings(
    app_data: &Path,
    settings: Value,
) -> Result<SettingsUpdate, LocalSettingsError> {
    validate_global_settings(&settings)?;
    let _guard = SETTINGS_LOCK.lock().await;
    let mut stored = read_settings_file(app_data).await?;
    let changed_fields = changed_fields(&stored.global, &settings, &GLOBAL_FIELDS);
    if !changed_fields.is_empty() {
        stored.global = settings.clone();
        write_settings_file(app_data, &stored).await?;
    }
    Ok(SettingsUpdate {
        changed_fields,
        settings,
    })
}

pub async fn read_project_defaults(
    app_data: &Path,
    project_id: &str,
) -> Result<Value, LocalSettingsError> {
    validate_identifier(project_id)?;
    let _guard = SETTINGS_LOCK.lock().await;
    let stored = read_settings_file(app_data).await?;
    Ok(stored
        .projects
        .get(project_id)
        .cloned()
        .unwrap_or_else(|| project_defaults_from_global(&stored.global)))
}

pub async fn update_project_defaults(
    app_data: &Path,
    project_id: &str,
    settings: Value,
) -> Result<SettingsUpdate, LocalSettingsError> {
    validate_identifier(project_id)?;
    validate_project_defaults(&settings)?;
    let _guard = SETTINGS_LOCK.lock().await;
    let mut stored = read_settings_file(app_data).await?;
    let current = stored
        .projects
        .get(project_id)
        .cloned()
        .unwrap_or_else(|| project_defaults_from_global(&stored.global));
    let changed_fields = changed_fields(&current, &settings, &PROJECT_FIELDS);
    if !changed_fields.is_empty() {
        stored
            .projects
            .insert(project_id.to_owned(), settings.clone());
        write_settings_file(app_data, &stored).await?;
    }
    Ok(SettingsUpdate {
        changed_fields,
        settings,
    })
}

async fn read_settings_file(app_data: &Path) -> Result<SettingsFile, LocalSettingsError> {
    let bytes = match fs::read(settings_path(app_data)).await {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(SettingsFile::default()),
        Err(error) => return Err(error.into()),
    };
    let stored: SettingsFile = serde_json::from_slice(&bytes)?;
    if stored.version != SETTINGS_VERSION {
        return Err(LocalSettingsError::InvalidData);
    }
    validate_global_settings(&stored.global)?;
    for (project_id, settings) in &stored.projects {
        validate_identifier(project_id)?;
        validate_project_defaults(settings)?;
    }
    Ok(stored)
}

async fn write_settings_file(
    app_data: &Path,
    settings: &SettingsFile,
) -> Result<(), LocalSettingsError> {
    fs::create_dir_all(app_data).await?;
    let target = settings_path(app_data);
    let temporary = app_data.join(format!(
        ".agent-settings-{}-{}.tmp",
        std::process::id(),
        TEMP_FILE_ID.fetch_add(1, Ordering::Relaxed)
    ));
    fs::write(&temporary, serde_json::to_vec(settings)?).await?;
    if let Err(error) = super::app_storage::replace_file_atomic(&temporary, &target).await {
        let _ = fs::remove_file(&temporary).await;
        return Err(error.into());
    }
    Ok(())
}

fn changed_fields(current: &Value, next: &Value, fields: &[&str]) -> Vec<String> {
    fields
        .iter()
        .filter(|field| current.get(**field) != next.get(**field))
        .map(|field| (*field).to_owned())
        .collect()
}

fn default_global_settings() -> Value {
    json!({
        "approvalPolicy": "on-request",
        "approvalsReviewer": "user",
        "commitMessageModel": "gpt-5.6-luna",
        "commitMessagePrompt": "",
        "defaultOpenAppId": null,
        "fastMode": false,
        "followUpBehavior": "queue",
        "model": "gpt-5.6-sol",
        "pet": {"enabled": false, "selectedPetId": null},
        "reasoningEffort": "high",
        "sandboxMode": "workspace-write",
    })
}

fn project_defaults_from_global(global: &Value) -> Value {
    json!({
        "approvalPolicy": global["approvalPolicy"],
        "approvalsReviewer": global["approvalsReviewer"],
        "fastMode": global["fastMode"],
        "model": global["model"],
        "reasoningEffort": global["reasoningEffort"],
        "sandboxMode": global["sandboxMode"],
    })
}

fn validate_global_settings(settings: &Value) -> Result<(), LocalSettingsError> {
    validate_exact_fields(settings, &GLOBAL_FIELDS)?;
    validate_common_settings(settings, false)?;
    required_string(settings, "commitMessageModel", 256)?;
    required_string_allow_empty(settings, "commitMessagePrompt", 4_000)?;
    let valid = matches!(
        settings.get("defaultOpenAppId"),
        Some(Value::Null) | Some(Value::String(_))
    ) && matches!(
        settings.get("followUpBehavior").and_then(Value::as_str),
        Some("queue" | "steer")
    ) && valid_pet(settings.get("pet"));
    valid.then_some(()).ok_or(LocalSettingsError::InvalidData)
}

fn validate_project_defaults(settings: &Value) -> Result<(), LocalSettingsError> {
    validate_exact_fields(settings, &PROJECT_FIELDS)?;
    validate_common_settings(settings, true)
}

fn validate_exact_fields(settings: &Value, expected: &[&str]) -> Result<(), LocalSettingsError> {
    let object = settings
        .as_object()
        .ok_or(LocalSettingsError::InvalidData)?;
    (object.len() == expected.len() && expected.iter().all(|field| object.contains_key(*field)))
        .then_some(())
        .ok_or(LocalSettingsError::InvalidData)
}

fn validate_common_settings(
    settings: &Value,
    allow_untrusted: bool,
) -> Result<(), LocalSettingsError> {
    required_string(settings, "model", 256)?;
    required_string(settings, "reasoningEffort", 64)?;
    let approval = settings
        .get("approvalPolicy")
        .ok_or(LocalSettingsError::InvalidData)?;
    let approval_valid = matches!(approval.as_str(), Some("on-request" | "never"))
        || (allow_untrusted && approval.as_str() == Some("untrusted"))
        || approval.get("granular").is_some_and(Value::is_object);
    let valid = approval_valid
        && matches!(
            settings.get("approvalsReviewer").and_then(Value::as_str),
            Some("user" | "auto_review")
        )
        && matches!(
            settings.get("sandboxMode").and_then(Value::as_str),
            Some("read-only" | "workspace-write" | "danger-full-access")
        )
        && settings.get("fastMode").is_some_and(Value::is_boolean);
    valid.then_some(()).ok_or(LocalSettingsError::InvalidData)
}

fn required_string(settings: &Value, key: &str, max: usize) -> Result<(), LocalSettingsError> {
    let value = settings
        .get(key)
        .and_then(Value::as_str)
        .ok_or(LocalSettingsError::InvalidData)?;
    (!value.trim().is_empty() && value.len() <= max)
        .then_some(())
        .ok_or(LocalSettingsError::InvalidData)
}

fn required_string_allow_empty(
    settings: &Value,
    key: &str,
    max: usize,
) -> Result<(), LocalSettingsError> {
    let value = settings
        .get(key)
        .and_then(Value::as_str)
        .ok_or(LocalSettingsError::InvalidData)?;
    (value.len() <= max)
        .then_some(())
        .ok_or(LocalSettingsError::InvalidData)
}

fn valid_pet(value: Option<&Value>) -> bool {
    value.is_some_and(|pet| {
        pet.as_object().is_some_and(|object| object.len() == 2)
            && pet.get("enabled").is_some_and(Value::is_boolean)
            && matches!(
                pet.get("selectedPetId"),
                Some(Value::Null) | Some(Value::String(_))
            )
    })
}

fn validate_identifier(value: &str) -> Result<(), LocalSettingsError> {
    let valid = !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'));
    valid.then_some(()).ok_or(LocalSettingsError::InvalidData)
}

fn settings_path(app_data: &Path) -> PathBuf {
    app_data.join("agent-settings.json")
}
