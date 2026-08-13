use std::sync::{
    Arc, Mutex,
    atomic::{AtomicUsize, Ordering},
};

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use code_agent_core::{
    AttachmentPort, ClockPort, CodeAgentError, CodeAgentErrorCode, FilePort, GitPort,
    PortRequestContext, ProjectProviderPort, ProviderPort, RepositoryPort, UpdatePort,
};
use code_agent_protocol::{
    AgentAttachment, AgentBackgroundTerminalPage, AgentCapabilities, AgentGlobalSettings,
    AgentMcpServerPage, AgentModelPage, AgentProjectDefaults, AgentSkillPage, AgentTaskPage,
    AgentTaskSettings, Project, ProjectId, RawProviderEvent, TaskId,
};
use serde_json::{Value, json};
use tokio::sync::mpsc;

#[path = "settings_validation/fixtures.rs"]
mod fixtures;
use fixtures::{global_settings, project_defaults, runtime, task_settings};

#[derive(Default)]
struct FakePorts {
    task_writes: Mutex<Vec<(String, String, Value)>>,
    writes: AtomicUsize,
}

impl FakePorts {
    fn unavailable<T>() -> Result<T, CodeAgentError> {
        Err(CodeAgentError::internal(
            "fake port operation is unavailable",
        ))
    }
}

#[async_trait]
impl RepositoryPort for FakePorts {
    async fn read_project(
        &self,
        project_id: &ProjectId,
        _context: &PortRequestContext,
    ) -> Result<Option<Value>, CodeAgentError> {
        if project_id.as_str() == "missing-project" {
            return Ok(None);
        }
        Ok(Some(json!({
            "createdAt": "2026-08-13T00:00:00Z",
            "id": project_id,
            "name": "Project",
            "rootPath": format!("/workspace/{}", project_id.as_str()),
        })))
    }

    async fn write_global_settings(
        &self,
        settings: &AgentGlobalSettings,
        _updated_at: DateTime<Utc>,
        _context: &PortRequestContext,
    ) -> Result<AgentGlobalSettings, CodeAgentError> {
        self.writes.fetch_add(1, Ordering::SeqCst);
        Ok(settings.clone())
    }

    async fn write_project_defaults(
        &self,
        _project_id: &ProjectId,
        settings: &AgentProjectDefaults,
        _updated_at: DateTime<Utc>,
        _context: &PortRequestContext,
    ) -> Result<AgentProjectDefaults, CodeAgentError> {
        self.writes.fetch_add(1, Ordering::SeqCst);
        Ok(settings.clone())
    }

    async fn write_task_settings(
        &self,
        project_id: &ProjectId,
        task_id: &TaskId,
        settings: &AgentTaskSettings,
        _updated_at: DateTime<Utc>,
        _context: &PortRequestContext,
    ) -> Result<AgentTaskSettings, CodeAgentError> {
        self.writes.fetch_add(1, Ordering::SeqCst);
        self.task_writes.lock().expect("task writes").push((
            project_id.to_string(),
            task_id.to_string(),
            serde_json::to_value(settings).expect("serialized settings"),
        ));
        Ok(settings.clone())
    }
}

#[async_trait]
impl ProviderPort for FakePorts {
    async fn capabilities(
        &self,
        _context: &PortRequestContext,
    ) -> Result<AgentCapabilities, CodeAgentError> {
        serde_json::from_value(json!({
            "feedback": { "upload": true },
            "provider": "fake",
            "skills": { "list": true, "use": true },
            "tasks": { "fork": true, "list": true, "read": true, "start": true },
            "turns": {
                "compact": true, "interrupt": true, "review": true,
                "start": true, "steer": true
            }
        }))
        .map_err(|error| CodeAgentError::internal(error.to_string()))
    }

    async fn models(
        &self,
        _context: &PortRequestContext,
    ) -> Result<AgentModelPage, CodeAgentError> {
        serde_json::from_value(json!({
            "data": [{
                "defaultReasoningEffort": "high",
                "description": "Test model",
                "displayName": "GPT-5.6",
                "id": "gpt-5.6",
                "isDefault": true,
                "supportedReasoningEfforts": [
                    { "description": "Low", "id": "low" },
                    { "description": "High", "id": "high" }
                ]
            }],
            "nextCursor": null
        }))
        .map_err(|error| CodeAgentError::internal(error.to_string()))
    }

    async fn for_project(
        &self,
        project: Project,
        _context: &PortRequestContext,
    ) -> Result<Arc<dyn ProjectProviderPort>, CodeAgentError> {
        Ok(Arc::new(FakeProjectProvider {
            project_id: project.id.to_string(),
        }))
    }
}

struct FakeProjectProvider {
    project_id: String,
}

#[async_trait]
impl ProjectProviderPort for FakeProjectProvider {
    async fn start_task(
        &self,
        _input: Value,
        _context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        FakePorts::unavailable()
    }

    async fn list_tasks(
        &self,
        _input: Value,
        _context: &PortRequestContext,
    ) -> Result<AgentTaskPage, CodeAgentError> {
        FakePorts::unavailable()
    }

    async fn read_task(
        &self,
        task_id: &str,
        _context: &PortRequestContext,
    ) -> Result<Option<Value>, CodeAgentError> {
        let project_id = if task_id == "foreign-task" {
            "other-project"
        } else {
            &self.project_id
        };
        Ok(Some(json!({ "id": task_id, "projectId": project_id })))
    }

    async fn pin_task(
        &self,
        _task_id: &str,
        _pinned: bool,
        _context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        FakePorts::unavailable()
    }

    async fn rename_task(
        &self,
        _task_id: &str,
        _title: &str,
        _context: &PortRequestContext,
    ) -> Result<(), CodeAgentError> {
        FakePorts::unavailable()
    }

    async fn archive_task(
        &self,
        _task_id: &str,
        _context: &PortRequestContext,
    ) -> Result<(), CodeAgentError> {
        FakePorts::unavailable()
    }

    async fn fork_task(
        &self,
        _task_id: &str,
        _context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        FakePorts::unavailable()
    }

    async fn compact_task(
        &self,
        _task_id: &str,
        _context: &PortRequestContext,
    ) -> Result<(), CodeAgentError> {
        FakePorts::unavailable()
    }

    async fn unsubscribe_task(
        &self,
        _task_id: &str,
        _context: &PortRequestContext,
    ) -> Result<String, CodeAgentError> {
        FakePorts::unavailable()
    }

    async fn start_turn(
        &self,
        _task_id: &str,
        _input: Value,
        _context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        FakePorts::unavailable()
    }

    async fn steer_turn(
        &self,
        _task_id: &str,
        _turn_id: &str,
        _input: Value,
        _context: &PortRequestContext,
    ) -> Result<(), CodeAgentError> {
        FakePorts::unavailable()
    }

    async fn interrupt_turn(
        &self,
        _task_id: &str,
        _turn_id: &str,
        _context: &PortRequestContext,
    ) -> Result<(), CodeAgentError> {
        FakePorts::unavailable()
    }

    async fn start_review(
        &self,
        _task_id: &str,
        _target: Value,
        _context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        FakePorts::unavailable()
    }

    async fn resolve_pending_request(
        &self,
        _input: Value,
        _context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        FakePorts::unavailable()
    }

    async fn list_skills(
        &self,
        _context: &PortRequestContext,
    ) -> Result<AgentSkillPage, CodeAgentError> {
        FakePorts::unavailable()
    }

    async fn list_mcp_servers(
        &self,
        _task_id: &str,
        _context: &PortRequestContext,
    ) -> Result<AgentMcpServerPage, CodeAgentError> {
        FakePorts::unavailable()
    }

    async fn reload_mcp_servers(
        &self,
        _task_id: &str,
        _context: &PortRequestContext,
    ) -> Result<AgentMcpServerPage, CodeAgentError> {
        FakePorts::unavailable()
    }

    async fn list_background_terminals(
        &self,
        _task_id: &str,
        _context: &PortRequestContext,
    ) -> Result<AgentBackgroundTerminalPage, CodeAgentError> {
        FakePorts::unavailable()
    }

    async fn terminate_background_terminal(
        &self,
        _task_id: &str,
        _terminal_id: &str,
        _context: &PortRequestContext,
    ) -> Result<bool, CodeAgentError> {
        FakePorts::unavailable()
    }

    async fn upload_feedback(
        &self,
        _task_id: &str,
        _input: Value,
        _context: &PortRequestContext,
    ) -> Result<(), CodeAgentError> {
        FakePorts::unavailable()
    }

    async fn subscribe_events(
        &self,
        _include_ephemeral: bool,
        _context: &PortRequestContext,
    ) -> Result<mpsc::Receiver<RawProviderEvent>, CodeAgentError> {
        let (_sender, receiver) = mpsc::channel(1);
        Ok(receiver)
    }
}

#[async_trait]
impl GitPort for FakePorts {
    async fn status(
        &self,
        _project_id: &ProjectId,
        _context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        Self::unavailable()
    }
}

#[async_trait]
impl FilePort for FakePorts {
    async fn read(
        &self,
        _project_id: &ProjectId,
        _path: &str,
        _context: &PortRequestContext,
    ) -> Result<Vec<u8>, CodeAgentError> {
        Self::unavailable()
    }
}

#[async_trait]
impl AttachmentPort for FakePorts {
    async fn read(
        &self,
        _project_id: &ProjectId,
        _task_id: &TaskId,
        _attachment_id: &str,
        _context: &PortRequestContext,
    ) -> Result<Vec<u8>, CodeAgentError> {
        Self::unavailable()
    }

    async fn upload(
        &self,
        _project_id: &ProjectId,
        _kind: code_agent_protocol::AgentAttachmentKind,
        _media_type: &str,
        _name: &str,
        _bytes: Vec<u8>,
        _context: &PortRequestContext,
    ) -> Result<AgentAttachment, CodeAgentError> {
        Self::unavailable()
    }
}

impl ClockPort for FakePorts {
    fn now(&self) -> DateTime<Utc> {
        DateTime::UNIX_EPOCH
    }
}

#[async_trait]
impl UpdatePort for FakePorts {
    async fn current_version(
        &self,
        _context: &PortRequestContext,
    ) -> Result<String, CodeAgentError> {
        Ok("1.9.0".to_owned())
    }
}

#[tokio::test]
async fn settings_updates_should_validate_capabilities_and_resource_ownership_before_writing() {
    let (ports, runtime) = runtime();
    let project_id = ProjectId::try_from("project-1").expect("project id");
    let missing_project = ProjectId::try_from("missing-project").expect("missing project id");
    let foreign_task = TaskId::try_from("foreign-task").expect("foreign task id");
    let task_id = TaskId::try_from("task-1").expect("task id");

    let invalid_model = runtime
        .update_global_settings("invalid-model", &global_settings("removed-model", "high"))
        .await
        .expect_err("missing model must be rejected");
    assert_eq!(invalid_model.code(), CodeAgentErrorCode::InvalidInput);

    let invalid_effort = runtime
        .update_project_defaults(
            "invalid-effort",
            &project_id,
            &project_defaults("gpt-5.6", "ultra"),
        )
        .await
        .expect_err("unsupported reasoning effort must be rejected");
    assert_eq!(invalid_effort.code(), CodeAgentErrorCode::InvalidInput);

    let project_not_found = runtime
        .update_project_defaults(
            "missing-project",
            &missing_project,
            &project_defaults("gpt-5.6", "high"),
        )
        .await
        .expect_err("missing project must be rejected");
    assert_eq!(project_not_found.code(), CodeAgentErrorCode::NotFound);

    let task_project_not_found = runtime
        .update_task_settings(
            "missing-task-project",
            &missing_project,
            &task_id,
            &task_settings("workspace-write"),
        )
        .await
        .expect_err("task project must exist");
    assert_eq!(task_project_not_found.code(), CodeAgentErrorCode::NotFound);

    let task_not_found = runtime
        .update_task_settings(
            "foreign-task",
            &project_id,
            &foreign_task,
            &task_settings("workspace-write"),
        )
        .await
        .expect_err("foreign task must be rejected");
    assert_eq!(task_not_found.code(), CodeAgentErrorCode::NotFound);
    assert_eq!(ports.writes.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn temporary_task_updates_should_force_danger_full_access_before_writing() {
    let (ports, runtime) = runtime();
    let project_id = ProjectId::try_from("temporary").expect("temporary project id");
    let task_id = TaskId::try_from("task-1").expect("task id");

    let updated = runtime
        .update_task_settings(
            "temporary-task",
            &project_id,
            &task_id,
            &task_settings("read-only"),
        )
        .await
        .expect("temporary settings update");

    assert_eq!(
        serde_json::to_value(updated).expect("updated settings")["sandboxMode"],
        "danger-full-access"
    );
    assert_eq!(
        ports.task_writes.lock().expect("task writes")[0].2["sandboxMode"],
        "danger-full-access"
    );
}
