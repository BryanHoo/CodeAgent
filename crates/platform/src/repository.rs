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

use crate::{
    PlatformDatabase, PlatformError,
    repository_support::{
        create_project_id, deserialize_protocol_json, normalized_name, project_from_row,
        read_project_by_root, serialize_protocol,
    },
};

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
                        "SELECT settings_json FROM global_settings WHERE id = 1",
                        [],
                        |row| deserialize_protocol_json(row.get(0)?),
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
        let settings_json = serialize_protocol(settings)?;
        let stored = settings.clone();
        self.database
            .call(move |connection| {
                connection.execute(
                    "INSERT INTO global_settings (id, settings_json, updated_at)
                     VALUES (1, ?1, ?2) ON CONFLICT(id) DO UPDATE SET
                     settings_json=excluded.settings_json, updated_at=excluded.updated_at",
                    params![settings_json, updated_at.to_rfc3339()],
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
                        "SELECT settings_json FROM project_defaults
                         WHERE project_id = ?1",
                        [project_id],
                        |row| deserialize_protocol_json(row.get(0)?),
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
        let settings_json = serialize_protocol(settings)?;
        let stored = settings.clone();
        self.database
            .call(move |connection| {
                connection.execute(
                    "INSERT INTO project_defaults (project_id, settings_json, updated_at)
                 VALUES (?1, ?2, ?3) ON CONFLICT(project_id) DO UPDATE SET
                 settings_json=excluded.settings_json, updated_at=excluded.updated_at",
                    params![project_id, settings_json, updated_at.to_rfc3339()],
                )?;
                Ok(stored)
            })
            .map_err(map_platform_error)
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
                connection
                    .query_row(
                        "SELECT settings_json FROM task_settings
                 WHERE project_id = ?1 AND task_id = ?2",
                        params![project_id, task_id],
                        |row| deserialize_protocol_json(row.get(0)?),
                    )
                    .optional()
                    .map_err(PlatformError::from)
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
        let settings_json = serialize_protocol(settings)?;
        let stored = settings.clone();
        self.database
            .call(move |connection| {
                connection.execute(
                    "INSERT INTO task_settings (project_id, task_id, settings_json, updated_at)
                 VALUES (?1, ?2, ?3, ?4) ON CONFLICT(project_id, task_id) DO UPDATE SET
                 settings_json=excluded.settings_json, updated_at=excluded.updated_at",
                    params![project_id, task_id, settings_json, updated_at.to_rfc3339()],
                )?;
                Ok(stored)
            })
            .map_err(map_platform_error)
    }

    async fn read_provider_connection(
        &self,
        context: &PortRequestContext,
    ) -> Result<Option<AgentProviderConnectionRecord>, CodeAgentError> {
        ensure_active(context)?;
        self.database
            .call(|connection| {
                connection
                    .query_row(
                        "SELECT connection_json FROM provider_connection WHERE id = 1",
                        [],
                        |row| deserialize_protocol_json(row.get(0)?),
                    )
                    .optional()
                    .map_err(PlatformError::from)
            })
            .map_err(map_platform_error)
    }

    async fn write_provider_connection(
        &self,
        record: &AgentProviderConnectionRecord,
        context: &PortRequestContext,
    ) -> Result<AgentProviderConnectionRecord, CodeAgentError> {
        ensure_active(context)?;
        let connection_json = serialize_protocol(record)?;
        let stored = record.clone();
        let updated_at = record.updated_at.to_rfc3339();
        self.database
            .call(move |connection| {
                connection.execute(
                    "INSERT INTO provider_connection (id, connection_json, updated_at)
                 VALUES (1, ?1, ?2) ON CONFLICT(id) DO UPDATE SET
                 connection_json=excluded.connection_json, updated_at=excluded.updated_at",
                    params![connection_json, updated_at],
                )?;
                Ok(stored)
            })
            .map_err(map_platform_error)
    }
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
