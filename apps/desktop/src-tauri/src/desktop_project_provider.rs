use std::collections::HashSet;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};

use async_trait::async_trait;
use code_agent_core::{
    AttachmentBytes, CodeAgentError, CodeAgentErrorCode, PortRequestContext, ProjectProviderPort,
};
use code_agent_protocol::{
    AgentBackgroundTerminalPage, AgentMcpServerPage, AgentSkillPage, AgentTaskPage, Project,
    ProviderEvent,
};
use serde_json::Value;
use tokio::sync::{Mutex as AsyncMutex, mpsc};

const EVENT_CHANNEL_CAPACITY: usize = 257;

struct ProjectSubscriber {
    generation: Arc<AtomicU64>,
    include_ephemeral: bool,
    sender: mpsc::Sender<ProviderEvent>,
}

/// Runtime 始终持有该稳定代理；底层 Codex 进程替换时不重建 Project 上下文。
pub(crate) struct DesktopProjectProvider {
    backend: RwLock<Option<Arc<dyn ProjectProviderPort>>>,
    project: Project,
    subscribers: Mutex<Vec<ProjectSubscriber>>,
    tasks: RwLock<HashSet<String>>,
    transition: AsyncMutex<()>,
}

impl DesktopProjectProvider {
    pub(crate) fn new(project: Project) -> Self {
        Self {
            backend: RwLock::new(None),
            project,
            subscribers: Mutex::new(Vec::new()),
            tasks: RwLock::new(HashSet::new()),
            transition: AsyncMutex::new(()),
        }
    }

    pub(crate) fn project(&self) -> &Project {
        &self.project
    }

    fn current(&self) -> Result<Arc<dyn ProjectProviderPort>, CodeAgentError> {
        self.backend
            .read()
            .ok()
            .and_then(|backend| backend.clone())
            .ok_or_else(provider_restarting)
    }

    pub(crate) fn disconnect(&self) {
        if let Ok(mut backend) = self.backend.write() {
            *backend = None;
        }
        if let Ok(subscribers) = self.subscribers.lock() {
            for subscriber in subscribers.iter() {
                subscriber.generation.fetch_add(1, Ordering::AcqRel);
            }
        }
    }

    pub(crate) async fn install(
        &self,
        backend: Arc<dyn ProjectProviderPort>,
    ) -> Result<(), CodeAgentError> {
        let _transition = self.transition.lock().await;
        let subscribers = {
            let mut subscriber_registry = self
                .subscribers
                .lock()
                .map_err(|_| CodeAgentError::internal("event subscriber registry is poisoned"))?;
            subscriber_registry.retain(|subscriber| !subscriber.sender.is_closed());
            subscriber_registry
                .iter()
                .map(|subscriber| {
                    (
                        subscriber.generation.clone(),
                        subscriber.include_ephemeral,
                        subscriber.sender.clone(),
                    )
                })
                .collect::<Vec<_>>()
        };
        let mut recovered = Vec::with_capacity(subscribers.len());
        for (_, include_ephemeral, _) in &subscribers {
            recovered.push(
                backend
                    .subscribe_events(
                        *include_ephemeral,
                        &PortRequestContext::new(format!(
                            "restore-project-events-{}",
                            self.project.id.as_str()
                        )),
                    )
                    .await?,
            );
        }

        // 先建立事件通道再恢复 Task，避免 thread/resume 期间丢失增量通知。
        let tasks = self
            .tasks
            .read()
            .map_err(|_| CodeAgentError::internal("provider task registry is poisoned"))?
            .iter()
            .cloned()
            .collect::<Vec<_>>();
        for task_id in tasks {
            if !backend
                .restore_task_subscription(
                    &task_id,
                    &PortRequestContext::new(format!("restore-task-{task_id}")),
                )
                .await?
                && let Ok(mut tasks) = self.tasks.write()
            {
                tasks.remove(&task_id);
            }
        }

        *self
            .backend
            .write()
            .map_err(|_| CodeAgentError::internal("project provider lock is poisoned"))? =
            Some(backend);
        for ((generation, _, sender), receiver) in subscribers.into_iter().zip(recovered) {
            let current_generation = generation.fetch_add(1, Ordering::AcqRel) + 1;
            forward_events(receiver, sender, generation, current_generation);
        }
        Ok(())
    }

    fn remember_task(&self, task_id: &str) {
        if !task_id.is_empty()
            && let Ok(mut tasks) = self.tasks.write()
        {
            tasks.insert(task_id.to_owned());
        }
    }

    fn remember_value_task(&self, value: &Value) {
        if let Some(task_id) = value.get("id").and_then(Value::as_str) {
            self.remember_task(task_id);
        }
    }
}

fn provider_restarting() -> CodeAgentError {
    CodeAgentError::new(
        CodeAgentErrorCode::ProviderFailure,
        "Codex App Server is restarting",
        None,
    )
}

fn forward_events(
    mut receiver: mpsc::Receiver<ProviderEvent>,
    sender: mpsc::Sender<ProviderEvent>,
    generation: Arc<AtomicU64>,
    current_generation: u64,
) {
    tokio::spawn(async move {
        while let Some(event) = receiver.recv().await {
            if generation.load(Ordering::Acquire) != current_generation
                || sender.send(event).await.is_err()
            {
                break;
            }
        }
    });
}

#[async_trait]
impl ProjectProviderPort for DesktopProjectProvider {
    async fn start_task(
        &self,
        input: Value,
        context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        let value = self.current()?.start_task(input, context).await?;
        self.remember_value_task(&value);
        Ok(value)
    }
    async fn list_tasks(
        &self,
        input: Value,
        context: &PortRequestContext,
    ) -> Result<AgentTaskPage, CodeAgentError> {
        self.current()?.list_tasks(input, context).await
    }
    async fn read_task(
        &self,
        task_id: &str,
        context: &PortRequestContext,
    ) -> Result<Option<Value>, CodeAgentError> {
        let value = self.current()?.read_task(task_id, context).await?;
        if value.is_some() {
            self.remember_task(task_id);
        }
        Ok(value)
    }
    async fn list_task_turns(
        &self,
        task_id: &str,
        cursor: Option<&str>,
        context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        self.current()?
            .list_task_turns(task_id, cursor, context)
            .await
    }
    async fn read_task_attachment(
        &self,
        task_id: &str,
        attachment_id: &str,
        context: &PortRequestContext,
    ) -> Result<Option<AttachmentBytes>, CodeAgentError> {
        self.current()?
            .read_task_attachment(task_id, attachment_id, context)
            .await
    }
    async fn pin_task(
        &self,
        task_id: &str,
        pinned: bool,
        context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        self.current()?.pin_task(task_id, pinned, context).await
    }
    async fn rename_task(
        &self,
        task_id: &str,
        title: &str,
        context: &PortRequestContext,
    ) -> Result<(), CodeAgentError> {
        self.current()?.rename_task(task_id, title, context).await
    }
    async fn archive_task(
        &self,
        task_id: &str,
        context: &PortRequestContext,
    ) -> Result<(), CodeAgentError> {
        self.current()?.archive_task(task_id, context).await
    }
    async fn fork_task(
        &self,
        task_id: &str,
        context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        let value = self.current()?.fork_task(task_id, context).await?;
        self.remember_value_task(&value);
        Ok(value)
    }
    async fn compact_task(
        &self,
        task_id: &str,
        context: &PortRequestContext,
    ) -> Result<(), CodeAgentError> {
        self.current()?.compact_task(task_id, context).await
    }
    async fn unsubscribe_task(
        &self,
        task_id: &str,
        context: &PortRequestContext,
    ) -> Result<String, CodeAgentError> {
        let status = self.current()?.unsubscribe_task(task_id, context).await?;
        if status != "busy"
            && let Ok(mut tasks) = self.tasks.write()
        {
            tasks.remove(task_id);
        }
        Ok(status)
    }
    async fn restore_task_subscription(
        &self,
        task_id: &str,
        context: &PortRequestContext,
    ) -> Result<bool, CodeAgentError> {
        self.current()?
            .restore_task_subscription(task_id, context)
            .await
    }
    async fn start_turn(
        &self,
        task_id: &str,
        input: Value,
        context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        let value = self.current()?.start_turn(task_id, input, context).await?;
        self.remember_task(task_id);
        Ok(value)
    }
    async fn steer_turn(
        &self,
        task_id: &str,
        turn_id: &str,
        input: Value,
        context: &PortRequestContext,
    ) -> Result<(), CodeAgentError> {
        self.current()?
            .steer_turn(task_id, turn_id, input, context)
            .await
    }
    async fn interrupt_turn(
        &self,
        task_id: &str,
        turn_id: &str,
        context: &PortRequestContext,
    ) -> Result<(), CodeAgentError> {
        self.current()?
            .interrupt_turn(task_id, turn_id, context)
            .await
    }
    async fn start_review(
        &self,
        task_id: &str,
        target: Value,
        context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        self.current()?.start_review(task_id, target, context).await
    }
    async fn resolve_pending_request(
        &self,
        input: Value,
        context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        self.current()?
            .resolve_pending_request(input, context)
            .await
    }
    async fn list_skills(
        &self,
        context: &PortRequestContext,
    ) -> Result<AgentSkillPage, CodeAgentError> {
        self.current()?.list_skills(context).await
    }
    async fn list_mcp_servers(
        &self,
        task_id: &str,
        context: &PortRequestContext,
    ) -> Result<AgentMcpServerPage, CodeAgentError> {
        self.current()?.list_mcp_servers(task_id, context).await
    }
    async fn reload_mcp_servers(
        &self,
        task_id: &str,
        context: &PortRequestContext,
    ) -> Result<AgentMcpServerPage, CodeAgentError> {
        self.current()?.reload_mcp_servers(task_id, context).await
    }
    async fn list_background_terminals(
        &self,
        task_id: &str,
        context: &PortRequestContext,
    ) -> Result<AgentBackgroundTerminalPage, CodeAgentError> {
        self.current()?
            .list_background_terminals(task_id, context)
            .await
    }
    async fn terminate_background_terminal(
        &self,
        task_id: &str,
        terminal_id: &str,
        context: &PortRequestContext,
    ) -> Result<bool, CodeAgentError> {
        self.current()?
            .terminate_background_terminal(task_id, terminal_id, context)
            .await
    }
    async fn upload_feedback(
        &self,
        task_id: &str,
        input: Value,
        context: &PortRequestContext,
    ) -> Result<(), CodeAgentError> {
        self.current()?
            .upload_feedback(task_id, input, context)
            .await
    }

    async fn subscribe_events(
        &self,
        include_ephemeral: bool,
        context: &PortRequestContext,
    ) -> Result<mpsc::Receiver<ProviderEvent>, CodeAgentError> {
        let _transition = self.transition.lock().await;
        let receiver = self
            .current()?
            .subscribe_events(include_ephemeral, context)
            .await?;
        let (sender, output) = mpsc::channel(EVENT_CHANNEL_CAPACITY);
        let generation = Arc::new(AtomicU64::new(1));
        forward_events(receiver, sender.clone(), generation.clone(), 1);
        let mut subscribers = self
            .subscribers
            .lock()
            .map_err(|_| CodeAgentError::internal("event subscriber registry is poisoned"))?;
        subscribers.retain(|subscriber| !subscriber.sender.is_closed());
        subscribers.push(ProjectSubscriber {
            generation,
            include_ephemeral,
            sender,
        });
        Ok(output)
    }
}
