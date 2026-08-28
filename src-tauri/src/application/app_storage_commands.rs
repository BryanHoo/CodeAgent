use std::collections::BTreeMap;

use serde::Serialize;
use tauri::{AppHandle, Manager};

use super::error::AppError;
use crate::infrastructure::app_storage::{self, CustomBackgroundInput, CustomBackgroundMetadata};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomBackgroundContent {
    bytes: Vec<u8>,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn initialize_app_storage(
    app: AppHandle,
    legacy_preferences: BTreeMap<String, String>,
    legacy_backgrounds: Vec<CustomBackgroundInput>,
) -> Result<BTreeMap<String, String>, AppError> {
    app_storage::initialize_storage(&app_data_dir(&app)?, legacy_preferences, legacy_backgrounds)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn update_app_preferences(
    app: AppHandle,
    updates: BTreeMap<String, Option<String>>,
) -> Result<(), AppError> {
    app_storage::update_preferences(&app_data_dir(&app)?, updates)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn list_custom_backgrounds(
    app: AppHandle,
) -> Result<Vec<CustomBackgroundMetadata>, AppError> {
    app_storage::list_custom_backgrounds(&app_data_dir(&app)?)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn read_custom_background(
    app: AppHandle,
    id: String,
) -> Result<CustomBackgroundContent, AppError> {
    let bytes = app_storage::read_custom_background(&app_data_dir(&app)?, &id)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    Ok(CustomBackgroundContent { bytes })
}

#[tauri::command(rename_all = "camelCase")]
pub async fn update_custom_backgrounds(
    app: AppHandle,
    deleted_ids: Vec<String>,
    images: Vec<CustomBackgroundInput>,
) -> Result<(), AppError> {
    app_storage::update_custom_backgrounds(&app_data_dir(&app)?, &deleted_ids, images)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)
}

fn app_data_dir(app: &AppHandle) -> Result<std::path::PathBuf, AppError> {
    app.path()
        .app_data_dir()
        .map_err(|_| AppError::FilesystemRequestFailed)
}
