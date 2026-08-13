use async_trait::async_trait;
use chrono::{DateTime, Utc};
use code_agent_core::{
    AgentMutationErrorCode, CodeAgentError, CodeAgentErrorCode, PortRequestContext, RepositoryPort,
};
use code_agent_protocol::{
    AgentGlobalSettings, AgentProjectDefaults, AgentProviderConnectionRecord, AgentTaskSettings,
    Project, ProjectId, TaskId,
};
use rusqlite::{OptionalExtension, params};
use serde_json::Value;
use sha2::{Digest, Sha256};
use unicode_normalization::UnicodeNormalization;

use crate::{PlatformDatabase, PlatformError};

#[derive(Clone)]
pub struct SqliteRepository {
    database: PlatformDatabase,
}

impl SqliteRepository {
    #[must_use]
    pub fn new(database: PlatformDatabase) -> Self {
        Self { database }
    }
}

#[async_trait]
impl RepositoryPort for SqliteRepository {
    async fn close(&self) -> Result<(), CodeAgentError> {
        let database = self.database.clone();
        tokio::task::spawn_blocking(move || database.close())
            .await
            .map_err(|_| CodeAgentError::internal("database close task failed"))?
            .map_err(map_platform_error)
    }

    async fn read_project(
        &self,
        project_id: &ProjectId,
        context: &PortRequestContext,
    ) -> Result<Option<Value>, CodeAgentError> {
        ensure_active(context)?;
        let project_id = project_id.to_string();
        self.database
            .call(move |connection| {
                let project = connection
                    .query_row(
                        "SELECT id, name, root_path, created_at FROM projects WHERE id = ?1",
                        [project_id],
                        project_from_row,
                    )
                    .optional()?;
                project
                    .map(|project| serde_json::to_value(project).map_err(PlatformError::from))
                    .transpose()
            })
            .map_err(map_platform_error)
    }

    async fn list_projects(
        &self,
        context: &PortRequestContext,
    ) -> Result<Vec<Project>, CodeAgentError> {
        ensure_active(context)?;
        self.database
            .call(|connection| {
                let mut statement = connection.prepare(
                    "SELECT id, name, root_path, created_at FROM projects
                     WHERE kind = 'user' ORDER BY sort_order, created_at, id",
                )?;
                let projects = statement
                    .query_map([], project_from_row)?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(projects)
            })
            .map_err(map_platform_error)
    }

    async fn register_project(
        &self,
        root_path: &str,
        name: &str,
        created_at: DateTime<Utc>,
        context: &PortRequestContext,
    ) -> Result<Project, CodeAgentError> {
        ensure_active(context)?;
        let root_path = root_path.to_owned();
        let name = normalized_name(name, &root_path);
        let project_id = create_project_id(&name, &root_path);
        self.database
            .call(move |connection| {
                connection.execute(
                    "INSERT OR IGNORE INTO projects
                     (id, name, root_path, created_at, sort_order, kind)
                     VALUES (?1, ?2, ?3, ?4,
                       (SELECT COALESCE(MAX(sort_order) + 1, 0) FROM projects WHERE kind = 'user'),
                       'user')",
                    params![project_id, name, root_path, created_at.to_rfc3339()],
                )?;
                read_project_by_root(connection, &root_path)?.ok_or_else(|| {
                    PlatformError::Worker("project identity conflicts with another root".to_owned())
                })
            })
            .map_err(map_platform_error)
    }

    async fn ensure_temporary_project(
        &self,
        root_path: &str,
        created_at: DateTime<Utc>,
        context: &PortRequestContext,
    ) -> Result<Project, CodeAgentError> {
        ensure_active(context)?;
        let root_path = root_path.to_owned();
        let project_id = create_project_id("Temporary", &root_path);
        self.database
            .call(move |connection| {
                connection.execute(
                    "INSERT OR IGNORE INTO projects
                     (id, name, root_path, created_at, sort_order, kind)
                     VALUES (?1, 'Temporary', ?2, ?3, 0, 'temporary')",
                    params![project_id, root_path, created_at.to_rfc3339()],
                )?;
                read_project_by_root(connection, &root_path)?.ok_or_else(|| {
                    PlatformError::Worker("temporary project identity conflict".to_owned())
                })
            })
            .map_err(map_platform_error)
    }

    async fn reorder_projects(
        &self,
        project_ids: &[ProjectId],
        context: &PortRequestContext,
    ) -> Result<Vec<Project>, CodeAgentError> {
        ensure_active(context)?;
        let project_ids = project_ids
            .iter()
            .map(|project_id| project_id.to_string())
            .collect::<Vec<_>>();
        self.database
            .call(move |connection| {
                let transaction = connection.transaction()?;
                let stored_ids = {
                    let mut statement = transaction.prepare(
                        "SELECT id FROM projects WHERE kind = 'user' ORDER BY sort_order, created_at, id",
                    )?;
                    statement
                        .query_map([], |row| row.get::<_, String>(0))?
                        .collect::<Result<Vec<_>, _>>()?
                };
                let mut requested = project_ids.clone();
                requested.sort();
                requested.dedup();
                let mut stored = stored_ids.clone();
                stored.sort();
                if requested != stored || project_ids.len() != stored_ids.len() {
                    return Err(PlatformError::Worker(
                        "project order must contain every project exactly once".to_owned(),
                    ));
                }
                for (sort_order, project_id) in project_ids.iter().enumerate() {
                    transaction.execute(
                        "UPDATE projects SET sort_order = ?1 WHERE id = ?2 AND kind = 'user'",
                        params![sort_order, project_id],
                    )?;
                }
                transaction.commit()?;
                let mut statement = connection.prepare(
                    "SELECT id, name, root_path, created_at FROM projects
                     WHERE kind = 'user' ORDER BY sort_order, created_at, id",
                )?;
                let data = statement
                    .query_map([], project_from_row)?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(data)
            })
            .map_err(map_platform_error)
    }

    async fn remove_project(
        &self,
        project_id: &ProjectId,
        context: &PortRequestContext,
    ) -> Result<(), CodeAgentError> {
        ensure_active(context)?;
        let project_id = project_id.to_string();
        self.database
            .call(move |connection| {
                let changed = connection.execute(
                    "DELETE FROM projects WHERE id = ?1 AND kind = 'user'",
                    [project_id],
                )?;
                if changed == 0 {
                    return Err(PlatformError::Worker("project not found".to_owned()));
                }
                Ok(())
            })
            .map_err(map_platform_error)
    }

    async fn rename_project(
        &self,
        project_id: &ProjectId,
        name: &str,
        context: &PortRequestContext,
    ) -> Result<Project, CodeAgentError> {
        ensure_active(context)?;
        let project_id = project_id.to_string();
        let name = name.trim().to_owned();
        if name.is_empty() || name.chars().count() > 200 {
            return Err(CodeAgentError::new(
                code_agent_protocol::CodeAgentErrorCode::InvalidInput,
                "project name must contain 1 to 200 characters",
                None,
            ));
        }
        self.database
            .call(move |connection| {
                let changed = connection.execute(
                    "UPDATE projects SET name = ?1 WHERE id = ?2 AND kind = 'user'",
                    params![name, project_id],
                )?;
                if changed == 0 {
                    return Err(PlatformError::Worker("project not found".to_owned()));
                }
                connection
                    .query_row(
                        "SELECT id, name, root_path, created_at FROM projects WHERE id = ?1",
                        [project_id],
                        project_from_row,
                    )
                    .map_err(PlatformError::from)
            })
            .map_err(map_platform_error)
    }

    async fn read_global_settings(
        &self,
        context: &PortRequestContext,
    ) -> Result<Option<AgentGlobalSettings>, CodeAgentError> {
        ensure_active(context)?;
        self.database
            .call(|connection| {
                connection
                    .query_row(
                        "SELECT approval_policy, approvals_reviewer, commit_message_model,
                                commit_message_prompt, commit_message_reasoning_effort, model,
                                reasoning_effort, sandbox_mode, default_open_app_id, follow_up_behavior
                         FROM global_settings WHERE id = 1",
                        [],
                        global_settings_from_row,
                    )
                    .optional()
                    .map_err(PlatformError::from)
            })
            .map_err(map_platform_error)
    }

    async fn write_global_settings(
        &self,
        settings: &AgentGlobalSettings,
        updated_at: DateTime<Utc>,
        context: &PortRequestContext,
    ) -> Result<AgentGlobalSettings, CodeAgentError> {
        ensure_active(context)?;
        let value = serde_json::to_value(settings)
            .map_err(|error| CodeAgentError::internal(error.to_string()))?;
        let stored = serde_json::from_value(value.clone())
            .map_err(|error| CodeAgentError::internal(error.to_string()))?;
        self.database
            .call(move |connection| {
                connection.execute(
                    "INSERT INTO global_settings (
                       id, approval_policy, approvals_reviewer, commit_message_model,
                       commit_message_prompt, commit_message_reasoning_effort, model,
                       reasoning_effort, sandbox_mode, default_open_app_id, follow_up_behavior, updated_at
                     ) VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
                     ON CONFLICT(id) DO UPDATE SET
                       approval_policy=excluded.approval_policy,
                       approvals_reviewer=excluded.approvals_reviewer,
                       commit_message_model=excluded.commit_message_model,
                       commit_message_prompt=excluded.commit_message_prompt,
                       commit_message_reasoning_effort=excluded.commit_message_reasoning_effort,
                       model=excluded.model, reasoning_effort=excluded.reasoning_effort,
                       sandbox_mode=excluded.sandbox_mode, default_open_app_id=excluded.default_open_app_id,
                       follow_up_behavior=excluded.follow_up_behavior, updated_at=excluded.updated_at",
                    params![
                        required_string(&value, "approvalPolicy")?, required_string(&value, "approvalsReviewer")?,
                        required_string(&value, "commitMessageModel")?, required_string(&value, "commitMessagePrompt")?,
                        required_string(&value, "commitMessageReasoningEffort")?, required_string(&value, "model")?,
                        required_string(&value, "reasoningEffort")?, required_string(&value, "sandboxMode")?,
                        optional_string(&value, "defaultOpenAppId")?, required_string(&value, "followUpBehavior")?,
                        updated_at.to_rfc3339(),
                    ],
                )?;
                Ok(stored)
            })
            .map_err(map_platform_error)
    }

    async fn read_project_defaults(
        &self,
        project_id: &ProjectId,
        context: &PortRequestContext,
    ) -> Result<Option<AgentProjectDefaults>, CodeAgentError> {
        ensure_active(context)?;
        let project_id = project_id.to_string();
        self.database
            .call(move |connection| {
                connection
                    .query_row(
                        "SELECT model, reasoning_effort, sandbox_mode FROM project_defaults WHERE project_id = ?1",
                        [project_id],
                        |row| deserialize_protocol(serde_json::json!({
                            "model": row.get::<_, String>(0)?,
                            "reasoningEffort": row.get::<_, String>(1)?,
                            "sandboxMode": row.get::<_, String>(2)?,
                        })),
                    )
                    .optional()
                    .map_err(PlatformError::from)
            })
            .map_err(map_platform_error)
    }

    async fn write_project_defaults(
        &self,
        project_id: &ProjectId,
        settings: &AgentProjectDefaults,
        updated_at: DateTime<Utc>,
        context: &PortRequestContext,
    ) -> Result<AgentProjectDefaults, CodeAgentError> {
        ensure_active(context)?;
        let project_id = project_id.to_string();
        let value = serde_json::to_value(settings)
            .map_err(|error| CodeAgentError::internal(error.to_string()))?;
        let stored = serde_json::from_value(value.clone())
            .map_err(|error| CodeAgentError::internal(error.to_string()))?;
        self.database.call(move |connection| {
            connection.execute(
                "INSERT INTO project_defaults (project_id, model, reasoning_effort, sandbox_mode, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(project_id) DO UPDATE SET
                 model=excluded.model, reasoning_effort=excluded.reasoning_effort,
                 sandbox_mode=excluded.sandbox_mode, updated_at=excluded.updated_at",
                params![project_id, required_string(&value, "model")?, required_string(&value, "reasoningEffort")?, required_string(&value, "sandboxMode")?, updated_at.to_rfc3339()],
            )?;
            Ok(stored)
        }).map_err(map_platform_error)
    }

    async fn read_task_settings(
        &self,
        project_id: &ProjectId,
        task_id: &TaskId,
        context: &PortRequestContext,
    ) -> Result<Option<AgentTaskSettings>, CodeAgentError> {
        ensure_active(context)?;
        let project_id = project_id.to_string();
        let task_id = task_id.to_string();
        self.database
            .call(move |connection| {
                connection.query_row(
                "SELECT approval_policy, approvals_reviewer, model, reasoning_effort, sandbox_mode
                 FROM task_settings WHERE project_id = ?1 AND task_id = ?2",
                params![project_id, task_id],
                |row| deserialize_protocol(serde_json::json!({
                    "approvalPolicy": row.get::<_, String>(0)?,
                    "approvalsReviewer": row.get::<_, String>(1)?,
                    "model": row.get::<_, String>(2)?,
                    "reasoningEffort": row.get::<_, String>(3)?,
                    "sandboxMode": row.get::<_, String>(4)?,
                })),
            ).optional().map_err(PlatformError::from)
            })
            .map_err(map_platform_error)
    }

    async fn write_task_settings(
        &self,
        project_id: &ProjectId,
        task_id: &TaskId,
        settings: &AgentTaskSettings,
        updated_at: DateTime<Utc>,
        context: &PortRequestContext,
    ) -> Result<AgentTaskSettings, CodeAgentError> {
        ensure_active(context)?;
        let project_id = project_id.to_string();
        let task_id = task_id.to_string();
        let value = serde_json::to_value(settings)
            .map_err(|error| CodeAgentError::internal(error.to_string()))?;
        let stored = serde_json::from_value(value.clone())
            .map_err(|error| CodeAgentError::internal(error.to_string()))?;
        self.database.call(move |connection| {
            connection.execute(
                "INSERT INTO task_settings (project_id, task_id, approval_policy, approvals_reviewer, model, reasoning_effort, sandbox_mode, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) ON CONFLICT(project_id, task_id) DO UPDATE SET
                 approval_policy=excluded.approval_policy, approvals_reviewer=excluded.approvals_reviewer,
                 model=excluded.model, reasoning_effort=excluded.reasoning_effort,
                 sandbox_mode=excluded.sandbox_mode, updated_at=excluded.updated_at",
                params![project_id, task_id, required_string(&value, "approvalPolicy")?, required_string(&value, "approvalsReviewer")?, required_string(&value, "model")?, required_string(&value, "reasoningEffort")?, required_string(&value, "sandboxMode")?, updated_at.to_rfc3339()],
            )?;
            Ok(stored)
        }).map_err(map_platform_error)
    }

    async fn read_provider_connection(
        &self,
        context: &PortRequestContext,
    ) -> Result<Option<AgentProviderConnectionRecord>, CodeAgentError> {
        ensure_active(context)?;
        self.database.call(|connection| {
            connection.query_row(
                "SELECT mode, custom_base_url, custom_models_json, updated_at FROM provider_connection WHERE id = 1",
                [], provider_connection_from_row,
            ).optional().map_err(PlatformError::from)
        }).map_err(map_platform_error)
    }

    async fn write_provider_connection(
        &self,
        record: &AgentProviderConnectionRecord,
        context: &PortRequestContext,
    ) -> Result<AgentProviderConnectionRecord, CodeAgentError> {
        ensure_active(context)?;
        let value = serde_json::to_value(record)
            .map_err(|error| CodeAgentError::internal(error.to_string()))?;
        let stored = serde_json::from_value(value.clone())
            .map_err(|error| CodeAgentError::internal(error.to_string()))?;
        let custom_models_json = match value.get("customModels") {
            Some(Value::Null) | None => None,
            Some(models) => Some(
                serde_json::to_string(models)
                    .map_err(|error| CodeAgentError::internal(error.to_string()))?,
            ),
        };
        self.database.call(move |connection| {
            connection.execute(
                "INSERT INTO provider_connection (id, mode, custom_base_url, custom_models_json, updated_at)
                 VALUES (1, ?1, ?2, ?3, ?4) ON CONFLICT(id) DO UPDATE SET
                 mode=excluded.mode, custom_base_url=excluded.custom_base_url,
                 custom_models_json=excluded.custom_models_json, updated_at=excluded.updated_at",
                params![required_string(&value, "mode")?, optional_string(&value, "customBaseUrl")?, custom_models_json, required_string(&value, "updatedAt")?],
            )?;
            Ok(stored)
        }).map_err(map_platform_error)
    }
}

fn global_settings_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AgentGlobalSettings> {
    deserialize_protocol(serde_json::json!({
        "approvalPolicy": row.get::<_, String>(0)?,
        "approvalsReviewer": row.get::<_, String>(1)?,
        "commitMessageModel": row.get::<_, String>(2)?,
        "commitMessagePrompt": row.get::<_, String>(3)?,
        "commitMessageReasoningEffort": row.get::<_, String>(4)?,
        "model": row.get::<_, String>(5)?,
        "reasoningEffort": row.get::<_, String>(6)?,
        "sandboxMode": row.get::<_, String>(7)?,
        "defaultOpenAppId": row.get::<_, Option<String>>(8)?,
        "followUpBehavior": row.get::<_, String>(9)?,
    }))
}

fn provider_connection_from_row(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<AgentProviderConnectionRecord> {
    let models: Option<Value> = row
        .get::<_, Option<String>>(2)?
        .map(|value| serde_json::from_str(&value))
        .transpose()
        .map_err(protocol_row_error)?;
    deserialize_protocol(serde_json::json!({
        "mode": row.get::<_, String>(0)?,
        "customBaseUrl": row.get::<_, Option<String>>(1)?,
        "customModels": models,
        "updatedAt": row.get::<_, String>(3)?,
    }))
}

fn deserialize_protocol<T: serde::de::DeserializeOwned>(value: Value) -> rusqlite::Result<T> {
    serde_json::from_value(value).map_err(protocol_row_error)
}

fn protocol_row_error(error: serde_json::Error) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error))
}

fn required_string(value: &Value, key: &str) -> Result<String, PlatformError> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| PlatformError::Worker(format!("protocol field {key} must be a string")))
}

fn optional_string(value: &Value, key: &str) -> Result<Option<String>, PlatformError> {
    match value.get(key) {
        Some(Value::String(value)) => Ok(Some(value.clone())),
        Some(Value::Null) | None => Ok(None),
        Some(_) => Err(PlatformError::Worker(format!(
            "protocol field {key} must be a string or null"
        ))),
    }
}

fn project_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Project> {
    let value = serde_json::json!({
        "id": row.get::<_, String>(0)?,
        "name": row.get::<_, String>(1)?,
        "rootPath": row.get::<_, String>(2)?,
        "createdAt": row.get::<_, String>(3)?,
    });
    serde_json::from_value(value).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error))
    })
}

fn read_project_by_root(
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

fn create_project_id(name: &str, root_path: &str) -> String {
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

fn normalized_name(name: &str, root_path: &str) -> String {
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

fn ensure_active(context: &PortRequestContext) -> Result<(), CodeAgentError> {
    if context.is_cancelled() {
        return Err(CodeAgentError::new(
            code_agent_protocol::CodeAgentErrorCode::Cancelled,
            "operation was cancelled",
            None,
        ));
    }
    Ok(())
}

fn map_platform_error(error: PlatformError) -> CodeAgentError {
    match error {
        PlatformError::Worker(message) if message == "project not found" => {
            CodeAgentError::new(CodeAgentErrorCode::NotFound, "project was not found", None)
                .with_mutation_code(AgentMutationErrorCode::ProjectNotFound)
        }
        PlatformError::InvalidOptions(message) => {
            CodeAgentError::new(CodeAgentErrorCode::InvalidInput, message, None)
        }
        PlatformError::Timeout => CodeAgentError::new(
            CodeAgentErrorCode::Timeout,
            "database request timed out",
            None,
        ),
        PlatformError::Closed => {
            CodeAgentError::new(CodeAgentErrorCode::ShuttingDown, "database is closed", None)
        }
        PlatformError::Worker(message) if message == "database queue is full" => {
            CodeAgentError::new(CodeAgentErrorCode::CapacityExceeded, message, None)
        }
        other => CodeAgentError::internal(other.to_string()),
    }
}
