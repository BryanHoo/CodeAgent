use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use code_agent_core::{AttachmentBytes, CodeAgentError, PortRequestContext, ProjectProviderPort};
use code_agent_protocol::{
    AgentBackgroundTerminalPage, AgentMcpServerPage, AgentSkillPage, AgentTaskPage, Project,
    RawProviderEvent,
};
use serde_json::{Value, json};
use tokio::sync::mpsc;

use crate::{
    JsonlRpcClient,
    historical_attachments::HistoricalAttachmentStore,
    mcp::McpState,
    pagination::PaginationGuard,
    pending_requests::{PendingRequestRegistry, PrepareOutcome},
    rpc_error_to_code_agent_error,
    skill_mapping::{NativeSkill, map_skill_catalog},
    task_state::TaskState,
};
use crate::{goal::GoalRegistry, review::ReviewRegistry};

mod events;
mod requests;
mod tasks;
mod turns;

const EVENT_SUBSCRIBER_CAPACITY: usize = 256;
const EVENT_CHANNEL_CAPACITY: usize = EVENT_SUBSCRIBER_CAPACITY + 1;

struct Subscriber {
    include_ephemeral: bool,
    sender: mpsc::Sender<RawProviderEvent>,
}

pub(crate) struct CodexProjectProvider {
    client: JsonlRpcClient,
    ephemeral: Mutex<HashSet<String>>,
    historical_attachments: HistoricalAttachmentStore,
    lifecycle_locks: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
    mcp: McpState,
    owners: Arc<Mutex<HashMap<String, String>>>,
    pending: PendingRequestRegistry,
    project: Project,
    resolution_lock: tokio::sync::Mutex<()>,
    goals: Arc<GoalRegistry>,
    reviews: Arc<ReviewRegistry>,
    resume_locks: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
    resumed: Mutex<HashSet<String>>,
    skills: Mutex<HashMap<String, NativeSkill>>,
    subscribers: Mutex<Vec<Subscriber>>,
    task_state: TaskState,
    tasks: Mutex<HashSet<String>>,
    transcript_skills: Arc<crate::transcript_skills::TranscriptSkillStore>,
}

impl CodexProjectProvider {
    pub(crate) fn new(
        client: JsonlRpcClient,
        project: Project,
        owners: Arc<Mutex<HashMap<String, String>>>,
        goals: Arc<GoalRegistry>,
        reviews: Arc<ReviewRegistry>,
        transcript_skills: Arc<crate::transcript_skills::TranscriptSkillStore>,
    ) -> Self {
        Self {
            client,
            ephemeral: Mutex::new(HashSet::new()),
            historical_attachments: HistoricalAttachmentStore::default(),
            lifecycle_locks: Mutex::new(HashMap::new()),
            mcp: McpState::default(),
            goals,
            owners,
            pending: PendingRequestRegistry::default(),
            project,
            resolution_lock: tokio::sync::Mutex::new(()),
            reviews,
            resume_locks: Mutex::new(HashMap::new()),
            resumed: Mutex::new(HashSet::new()),
            skills: Mutex::new(HashMap::new()),
            subscribers: Mutex::new(Vec::new()),
            task_state: TaskState::default(),
            tasks: Mutex::new(HashSet::new()),
            transcript_skills,
        }
    }

    pub(crate) fn root_path(&self) -> &str {
        self.project.root_path.as_str()
    }

    async fn rpc(&self, method: &str, params: Option<Value>) -> Result<Value, CodeAgentError> {
        self.client
            .request(method, params)
            .await
            .map_err(|error| rpc_error_to_code_agent_error(&error))
    }

    fn claim_task(&self, task_id: &str, ephemeral: bool) -> Result<(), CodeAgentError> {
        let project_id = self.project.id.to_string();
        let mut owners = self
            .owners
            .lock()
            .map_err(|_| CodeAgentError::internal("provider owner registry is poisoned"))?;
        if let Some(owner) = owners.get(task_id)
            && owner != &project_id
        {
            return Err(CodeAgentError::internal(
                "Codex thread belongs to another project",
            ));
        }
        owners.insert(task_id.to_string(), project_id);
        self.tasks
            .lock()
            .map_err(|_| CodeAgentError::internal("provider task registry is poisoned"))?
            .insert(task_id.to_string());
        if ephemeral {
            self.ephemeral
                .lock()
                .map_err(|_| CodeAgentError::internal("provider task registry is poisoned"))?
                .insert(task_id.to_string());
        }
        Ok(())
    }

    fn assert_task(&self, task_id: &str) -> Result<(), CodeAgentError> {
        if self
            .tasks
            .lock()
            .map(|tasks| tasks.contains(task_id))
            .unwrap_or(false)
        {
            Ok(())
        } else {
            Err(CodeAgentError::internal(
                "Codex thread does not belong to the active project",
            ))
        }
    }

    fn has_task(&self, task_id: &str) -> bool {
        self.tasks.lock().is_ok_and(|tasks| tasks.contains(task_id))
    }

    fn lifecycle_lock(&self, task_id: &str) -> Result<Arc<tokio::sync::Mutex<()>>, CodeAgentError> {
        Ok(self
            .lifecycle_locks
            .lock()
            .map_err(|_| CodeAgentError::internal("task lifecycle registry is poisoned"))?
            .entry(task_id.to_owned())
            .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
            .clone())
    }

    fn has_lifecycle_obligations(&self, task_id: &str) -> bool {
        self.task_state.is_running(task_id)
            || self.pending.contains_task(task_id)
            || self.goals.contains(task_id)
            || self.reviews.contains(task_id)
    }

    pub(crate) async fn resume(&self, task_id: &str) -> Result<(), CodeAgentError> {
        if self
            .resumed
            .lock()
            .map(|tasks| tasks.contains(task_id))
            .unwrap_or(false)
        {
            return Ok(());
        }
        let lock = self
            .resume_locks
            .lock()
            .map_err(|_| CodeAgentError::internal("resume registry is poisoned"))?
            .entry(task_id.to_string())
            .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
            .clone();
        let _guard = lock.lock().await;
        if self
            .resumed
            .lock()
            .map(|tasks| tasks.contains(task_id))
            .unwrap_or(false)
        {
            return Ok(());
        }
        let response = self
            .rpc("thread/resume", Some(json!({ "threadId": task_id })))
            .await?;
        if response["thread"]["id"] != task_id {
            return Err(CodeAgentError::internal(
                "thread/resume returned a different thread",
            ));
        }
        self.resumed
            .lock()
            .map_err(|_| CodeAgentError::internal("resume registry is poisoned"))?
            .insert(task_id.to_string());
        Ok(())
    }
}

#[async_trait]
impl ProjectProviderPort for CodexProjectProvider {
    async fn start_task(
        &self,
        input: Value,
        _context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        self.start_task_impl(input).await
    }

    async fn list_tasks(
        &self,
        input: Value,
        _context: &PortRequestContext,
    ) -> Result<AgentTaskPage, CodeAgentError> {
        self.list_tasks_impl(input).await
    }

    async fn read_task(
        &self,
        task_id: &str,
        _context: &PortRequestContext,
    ) -> Result<Option<Value>, CodeAgentError> {
        self.read_task_impl(task_id).await
    }

    async fn pin_task(
        &self,
        task_id: &str,
        pinned: bool,
        _context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        self.pin_task_impl(task_id, pinned).await
    }
    async fn read_task_attachment(
        &self,
        task_id: &str,
        attachment_id: &str,
        _context: &PortRequestContext,
    ) -> Result<Option<AttachmentBytes>, CodeAgentError> {
        Ok(self.read_task_attachment_impl(task_id, attachment_id).await)
    }
    async fn rename_task(
        &self,
        task_id: &str,
        title: &str,
        _context: &PortRequestContext,
    ) -> Result<(), CodeAgentError> {
        self.rename_task_impl(task_id, title).await
    }
    async fn archive_task(
        &self,
        task_id: &str,
        _context: &PortRequestContext,
    ) -> Result<(), CodeAgentError> {
        self.archive_task_impl(task_id).await
    }
    async fn fork_task(
        &self,
        task_id: &str,
        _context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        self.fork_task_impl(task_id).await
    }
    async fn compact_task(
        &self,
        task_id: &str,
        _context: &PortRequestContext,
    ) -> Result<(), CodeAgentError> {
        self.compact_task_impl(task_id).await
    }
    async fn unsubscribe_task(
        &self,
        task_id: &str,
        _context: &PortRequestContext,
    ) -> Result<String, CodeAgentError> {
        self.unsubscribe_task_impl(task_id).await
    }

    async fn start_turn(
        &self,
        task_id: &str,
        input: Value,
        context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        self.start_turn_impl(task_id, input, context).await
    }
    async fn steer_turn(
        &self,
        task_id: &str,
        turn_id: &str,
        input: Value,
        context: &PortRequestContext,
    ) -> Result<(), CodeAgentError> {
        self.steer_turn_impl(task_id, turn_id, input, context).await
    }
    async fn interrupt_turn(
        &self,
        task_id: &str,
        turn_id: &str,
        _context: &PortRequestContext,
    ) -> Result<(), CodeAgentError> {
        self.interrupt_turn_impl(task_id, turn_id).await
    }
    async fn start_review(
        &self,
        task_id: &str,
        target: Value,
        _context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        self.start_review_impl(task_id, target).await
    }

    async fn resolve_pending_request(
        &self,
        input: Value,
        _context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        let request_id = input
            .get("requestId")
            .and_then(Value::as_str)
            .ok_or_else(|| CodeAgentError::internal("pending request id is invalid"))?
            .to_owned();
        let _resolution_guard = self.resolution_lock.lock().await;
        let mut validated_body = input.clone();
        validated_body
            .as_object_mut()
            .ok_or_else(|| CodeAgentError::internal("pending request input is invalid"))?
            .remove("requestId");
        code_agent_protocol::parse_protocol_value(
            code_agent_protocol::ValueDefinition::ResolvePendingRequestRequest,
            validated_body,
        )
        .map_err(|error| {
            CodeAgentError::new(
                code_agent_core::CodeAgentErrorCode::InvalidInput,
                error.to_string(),
                None,
            )
        })?;
        let prepared = match self.pending.prepare(&input, self.project.id.as_str())? {
            PrepareOutcome::Ready(prepared) => prepared,
            PrepareOutcome::Reused(request) => return Ok(request),
        };
        if let Err(error) = self
            .client
            .respond_to_server_request(
                prepared.entry.provider_request_id.clone(),
                prepared.native.clone(),
            )
            .await
        {
            self.pending.rollback(&request_id, &prepared.fingerprint);
            return Err(rpc_error_to_code_agent_error(&error));
        }
        let events = self.pending.complete(prepared, "resolved")?;
        let resolved = events
            .first()
            .and_then(|event| event.pointer("/payload/request"))
            .cloned()
            .ok_or_else(|| CodeAgentError::internal("pending request result is invalid"))?;
        for event in events {
            self.publish_value(event);
        }
        Ok(resolved)
    }

    async fn list_skills(
        &self,
        _context: &PortRequestContext,
    ) -> Result<AgentSkillPage, CodeAgentError> {
        let response = self
            .rpc(
                "skills/list",
                Some(json!({ "cwds": [self.project.root_path.as_str()], "forceReload": false })),
            )
            .await?;
        let (page, catalog) = map_skill_catalog(&response, self.project.root_path.as_str())?;
        *self
            .skills
            .lock()
            .map_err(|_| CodeAgentError::internal("skill catalog is poisoned"))? = catalog;
        Ok(page)
    }
    async fn list_mcp_servers(
        &self,
        task_id: &str,
        _context: &PortRequestContext,
    ) -> Result<AgentMcpServerPage, CodeAgentError> {
        self.assert_task(task_id)?;
        self.resume(task_id).await?;
        let mut data = Vec::new();
        let mut cursor = None::<String>;
        let mut pagination = PaginationGuard::new("mcpServerStatus/list", 10_000);
        loop {
            let mut params = json!({ "detail": "toolsAndAuthOnly", "threadId": task_id });
            if let Some(value) = &cursor {
                params["cursor"] = Value::String(value.clone());
            }
            let response = self.rpc("mcpServerStatus/list", Some(params)).await?;
            data.extend(response["data"].as_array().cloned().ok_or_else(|| {
                CodeAgentError::internal("mcpServerStatus/list data must be an array")
            })?);
            cursor = pagination.advance(&response, data.len())?;
            if cursor.is_none() {
                break;
            }
        }
        self.mcp.merge_page(task_id, data)
    }
    async fn reload_mcp_servers(
        &self,
        task_id: &str,
        context: &PortRequestContext,
    ) -> Result<AgentMcpServerPage, CodeAgentError> {
        self.assert_task(task_id)?;
        self.resume(task_id).await?;
        let previous = self.mcp.snapshot(task_id);
        self.mcp.mark_reloading(task_id);
        if let Err(error) = self.rpc("config/mcpServer/reload", None).await {
            self.mcp.restore(task_id, previous);
            return Err(error);
        }
        self.list_mcp_servers(task_id, context).await
    }
    async fn list_background_terminals(
        &self,
        task_id: &str,
        _context: &PortRequestContext,
    ) -> Result<AgentBackgroundTerminalPage, CodeAgentError> {
        self.assert_task(task_id)?;
        self.list_background_terminals_impl(task_id).await
    }
    async fn terminate_background_terminal(
        &self,
        task_id: &str,
        terminal_id: &str,
        _context: &PortRequestContext,
    ) -> Result<bool, CodeAgentError> {
        self.assert_task(task_id)?;
        let response = self
            .rpc(
                "thread/backgroundTerminals/terminate",
                Some(json!({ "processId": terminal_id, "threadId": task_id })),
            )
            .await?;
        Ok(response["terminated"].as_bool().unwrap_or(false))
    }
    async fn upload_feedback(
        &self,
        task_id: &str,
        mut input: Value,
        _context: &PortRequestContext,
    ) -> Result<(), CodeAgentError> {
        self.assert_task(task_id)?;
        input["threadId"] = Value::String(task_id.to_string());
        self.rpc("feedback/upload", Some(input)).await.map(|_| ())
    }
    async fn subscribe_events(
        &self,
        include_ephemeral: bool,
        _context: &PortRequestContext,
    ) -> Result<mpsc::Receiver<RawProviderEvent>, CodeAgentError> {
        let (sender, receiver) = mpsc::channel(EVENT_CHANNEL_CAPACITY);
        self.subscribers
            .lock()
            .map_err(|_| CodeAgentError::internal("event subscriber registry is poisoned"))?
            .push(Subscriber {
                include_ephemeral,
                sender,
            });
        Ok(receiver)
    }
}
