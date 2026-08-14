use std::{fs, path::PathBuf, str::FromStr, time::Duration};

use chrono::{TimeZone, Utc};
use code_agent_core::{PortRequestContext, RepositoryPort};
use code_agent_platform::{DatabaseOptions, PlatformDatabase, SqliteRepository};
use code_agent_protocol::{
    AgentGlobalSettings, AgentProjectDefaults, AgentProviderConnectionRecord, AgentTaskSettings,
    ProjectId, TaskId,
};
use rusqlite::{Connection, params};
use serde_json::json;

fn temporary_database_path(name: &str) -> PathBuf {
    let directory = std::env::temp_dir().join(format!(
        "code-agent-settings-{name}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock must follow unix epoch")
            .as_nanos()
    ));
    fs::create_dir_all(&directory).expect("temporary directory must be created");
    directory.join("state.sqlite3")
}

fn parse<T: serde::de::DeserializeOwned>(value: serde_json::Value) -> T {
    serde_json::from_value(value).expect("fixture must match generated protocol")
}

fn create_version_12_fixture(path: &PathBuf) {
    let connection = Connection::open(path).expect("version 12 fixture must open");
    connection
        .execute_batch(
            "PRAGMA foreign_keys = ON;
             CREATE TABLE schema_migrations (
               version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL
             ) STRICT;
             CREATE TABLE projects (
               id TEXT PRIMARY KEY, name TEXT NOT NULL, root_path TEXT NOT NULL UNIQUE,
               created_at TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0,
               kind TEXT NOT NULL DEFAULT 'user' CHECK (kind IN ('user', 'temporary'))
             ) STRICT;
             CREATE TABLE project_defaults (
               backend_id TEXT NOT NULL,
               project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
               settings_json TEXT NOT NULL CHECK (json_valid(settings_json)),
               updated_at TEXT NOT NULL,
               PRIMARY KEY (backend_id, project_id)
             ) STRICT;
             CREATE TABLE global_settings (
               backend_id TEXT PRIMARY KEY,
               settings_json TEXT NOT NULL CHECK (json_valid(settings_json)),
               updated_at TEXT NOT NULL
             ) STRICT;
             CREATE TABLE task_settings (
               backend_id TEXT NOT NULL,
               project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
               task_id TEXT NOT NULL,
               settings_json TEXT NOT NULL CHECK (json_valid(settings_json)),
               updated_at TEXT NOT NULL,
               PRIMARY KEY (backend_id, project_id, task_id)
             ) STRICT;
             CREATE TABLE provider_connection (
               backend_id TEXT PRIMARY KEY,
               connection_json TEXT NOT NULL CHECK (json_valid(connection_json)),
               updated_at TEXT NOT NULL
             ) STRICT;
             WITH RECURSIVE versions(version) AS (
               VALUES(1) UNION ALL SELECT version + 1 FROM versions WHERE version < 12
             )
             INSERT INTO schema_migrations (version, name, applied_at)
             SELECT version, 'fixture', '2026-01-01T00:00:00.000Z' FROM versions;",
        )
        .expect("version 12 schema must be created");
    connection
        .execute(
            "INSERT INTO projects (id, name, root_path, created_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![
                "shared-project",
                "Shared",
                "/workspace/shared",
                "2026-01-01T00:00:00.000Z"
            ],
        )
        .expect("fixture project must be inserted");
    connection
        .execute(
            "INSERT INTO project_defaults (backend_id, project_id, settings_json, updated_at)
             VALUES ('codex', 'shared-project', ?1, '2026-01-01T00:00:00.000Z')",
            [r#"{"model":"gpt-5","reasoningEffort":"high","sandboxMode":"workspace-write"}"#],
        )
        .expect("Codex settings must be inserted");
}

#[tokio::test(flavor = "current_thread")]
async fn repository_should_read_project_defaults_after_version_12_migration() {
    let path = temporary_database_path("version-12");
    create_version_12_fixture(&path);
    let database = PlatformDatabase::open(DatabaseOptions {
        path: path.clone(),
        queue_capacity: 8,
        request_timeout: Duration::from_secs(2),
    })
    .expect("version 12 database must migrate");
    let repository = SqliteRepository::new(database.clone());
    let project_id = ProjectId::from_str("shared-project").expect("project id must parse");

    let defaults = repository
        .read_project_defaults(
            &project_id,
            &PortRequestContext::new("version-12-settings-test"),
        )
        .await
        .expect("migrated Codex settings must read");

    assert_eq!(
        serde_json::to_value(defaults).expect("serialize"),
        json!({
            "model": "gpt-5",
            "reasoningEffort": "high",
            "sandboxMode": "workspace-write"
        })
    );
    database.close().expect("database close");
    fs::remove_dir_all(path.parent().expect("parent")).expect("temporary directory remove");
}

#[tokio::test(flavor = "current_thread")]
async fn repository_should_round_trip_all_persisted_settings() {
    let path = temporary_database_path("round-trip");
    let database = PlatformDatabase::open(DatabaseOptions {
        path: path.clone(),
        queue_capacity: 8,
        request_timeout: Duration::from_secs(2),
    })
    .expect("database must open");
    let repository = SqliteRepository::new(database.clone());
    let context = PortRequestContext::new("settings-test");
    let now = Utc
        .with_ymd_and_hms(2026, 8, 12, 0, 0, 0)
        .single()
        .expect("valid time");
    let project = repository
        .register_project("/workspace/settings", "Settings", now, &context)
        .await
        .expect("project must register");
    let task_id = TaskId::from_str("task-1").expect("task id must parse");

    let task: AgentTaskSettings = parse(json!({
        "approvalPolicy": "on-request", "approvalsReviewer": "auto_review",
        "model": "gpt-5", "reasoningEffort": "high", "sandboxMode": "workspace-write"
    }));
    let project_defaults: AgentProjectDefaults = parse(json!({
        "model": "gpt-5", "reasoningEffort": "high", "sandboxMode": "workspace-write"
    }));
    let global: AgentGlobalSettings = parse(json!({
        "approvalPolicy": "never", "approvalsReviewer": "user",
        "commitMessageModel": "gpt-5", "commitMessagePrompt": "提交",
        "commitMessageReasoningEffort": "medium", "defaultOpenAppId": null,
        "followUpBehavior": "queue", "model": "gpt-5", "reasoningEffort": "high",
        "sandboxMode": "workspace-write"
    }));
    let provider: AgentProviderConnectionRecord = parse(json!({
        "customBaseUrl": null, "customModels": null, "mode": "official",
        "updatedAt": "2026-08-12T00:00:00Z"
    }));

    repository
        .write_task_settings(&project.id, &task_id, &task, now, &context)
        .await
        .expect("task settings write");
    repository
        .write_project_defaults(&project.id, &project_defaults, now, &context)
        .await
        .expect("project defaults write");
    repository
        .write_global_settings(&global, now, &context)
        .await
        .expect("global settings write");
    repository
        .write_provider_connection(&provider, &context)
        .await
        .expect("provider write");

    let stored_task = repository
        .read_task_settings(&project.id, &task_id, &context)
        .await
        .expect("task read");
    let stored_defaults = repository
        .read_project_defaults(&project.id, &context)
        .await
        .expect("defaults read");
    let stored_global = repository
        .read_global_settings(&context)
        .await
        .expect("global read");
    let stored_provider = repository
        .read_provider_connection(&context)
        .await
        .expect("provider read");

    assert_eq!(
        serde_json::to_value(stored_task).expect("serialize"),
        json!(task)
    );
    assert_eq!(
        serde_json::to_value(stored_defaults).expect("serialize"),
        json!(project_defaults)
    );
    assert_eq!(
        serde_json::to_value(stored_global).expect("serialize"),
        json!(global)
    );
    assert_eq!(
        serde_json::to_value(stored_provider).expect("serialize"),
        json!(provider)
    );

    database.close().expect("database close");
    fs::remove_dir_all(path.parent().expect("parent")).expect("temporary directory remove");
}
