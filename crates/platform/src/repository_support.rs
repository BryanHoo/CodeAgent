use code_agent_core::CodeAgentError;
use code_agent_protocol::Project;
use rusqlite::OptionalExtension;
use sha2::{Digest, Sha256};
use unicode_normalization::UnicodeNormalization;

use crate::PlatformError;

pub(crate) fn serialize_protocol<T: serde::Serialize>(value: &T) -> Result<String, CodeAgentError> {
    serde_json::to_string(value).map_err(|error| CodeAgentError::internal(error.to_string()))
}

pub(crate) fn deserialize_protocol_json<T: serde::de::DeserializeOwned>(
    value: String,
) -> rusqlite::Result<T> {
    serde_json::from_str(&value).map_err(protocol_row_error)
}

fn protocol_row_error(error: serde_json::Error) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error))
}

pub(crate) fn project_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Project> {
    let value = serde_json::json!({
        "id": row.get::<_, String>(0)?,
        "name": row.get::<_, String>(1)?,
        "rootPath": row.get::<_, String>(2)?,
        "createdAt": row.get::<_, String>(3)?,
    });
    serde_json::from_value(value).map_err(protocol_row_error)
}

pub(crate) fn read_project_by_root(
    connection: &rusqlite::Connection,
    root_path: &str,
) -> Result<Option<Project>, PlatformError> {
    connection
        .query_row(
            "SELECT id, name, root_path, created_at FROM projects WHERE root_path = ?1",
            [root_path],
            project_from_row,
        )
        .optional()
        .map_err(PlatformError::from)
}

pub(crate) fn create_project_id(name: &str, root_path: &str) -> String {
    let slug = name
        .nfkd()
        .flat_map(char::to_lowercase)
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    let slug = slug.chars().take(48).collect::<String>();
    let hash = format!("{:x}", Sha256::digest(root_path.as_bytes()));
    format!(
        "{}-{}",
        if slug.is_empty() { "project" } else { &slug },
        &hash[..12]
    )
}

pub(crate) fn normalized_name(name: &str, root_path: &str) -> String {
    let trimmed = name.trim();
    if !trimmed.is_empty() {
        return trimmed.to_owned();
    }
    std::path::Path::new(root_path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(root_path)
        .to_owned()
}
