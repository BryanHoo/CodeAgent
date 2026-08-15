use std::collections::HashMap;
use std::sync::Mutex;

use code_agent_core::CodeAgentError;
use serde_json::{Value, json};

#[derive(Clone, Debug)]
struct ReviewSession {
    has_worker_output: bool,
    outer_turn_id: Option<String>,
    target: Value,
    worker_task_id: Option<String>,
    worker_turn_id: Option<String>,
}

#[derive(Default)]
pub(crate) struct ReviewRegistry {
    sessions: Mutex<HashMap<String, ReviewSession>>,
}

pub(crate) struct ReviewRoute {
    pub is_worker: bool,
    pub parent_task_id: String,
    pub outer_turn_id: Option<String>,
    pub suppress: bool,
}

impl ReviewRegistry {
    pub(crate) fn begin(&self, task_id: &str, target: Value) -> Result<(), CodeAgentError> {
        self.sessions
            .lock()
            .map_err(|_| CodeAgentError::internal("review registry is poisoned"))?
            .insert(
                task_id.to_owned(),
                ReviewSession {
                    has_worker_output: false,
                    outer_turn_id: None,
                    target,
                    worker_task_id: None,
                    worker_turn_id: None,
                },
            );
        Ok(())
    }

    pub(crate) fn set_outer_turn(&self, task_id: &str, turn_id: &str) {
        if let Ok(mut sessions) = self.sessions.lock()
            && let Some(session) = sessions.get_mut(task_id)
        {
            session.outer_turn_id = Some(turn_id.to_owned());
        }
    }

    pub(crate) fn register_worker(&self, parent_id: &str, worker_id: &str) {
        if let Ok(mut sessions) = self.sessions.lock()
            && let Some(session) = sessions.get_mut(parent_id)
        {
            session.worker_task_id = Some(worker_id.to_owned());
        }
    }

    pub(crate) fn route(
        &self,
        native_task_id: &str,
        native_turn_id: Option<&str>,
        method: &str,
        item_type: Option<&str>,
        item_phase: Option<&str>,
    ) -> Option<ReviewRoute> {
        let mut sessions = self.sessions.lock().ok()?;
        let (parent_id, session) = sessions.iter_mut().find(|(parent, session)| {
            parent.as_str() == native_task_id
                || session.worker_task_id.as_deref() == Some(native_task_id)
        })?;
        let is_worker = session.worker_task_id.as_deref() == Some(native_task_id);
        if is_worker && method == "turn/started" {
            session.worker_turn_id = native_turn_id.map(str::to_owned);
        }
        if is_worker
            && method == "item/completed"
            && item_type == Some("agentMessage")
            && item_phase == Some("final_answer")
        {
            session.has_worker_output = true;
        }
        let outer_internal_item = !is_worker
            && method.starts_with("item/")
            && (item_type == Some("userMessage")
                || (item_type == Some("agentMessage") && item_phase != Some("commentary"))
                || (item_type == Some("exitedReviewMode") && session.has_worker_output));
        let suppress = (is_worker
            && (method == "turn/completed" || item_type == Some("userMessage")))
            || outer_internal_item;
        Some(ReviewRoute {
            is_worker,
            parent_task_id: parent_id.clone(),
            outer_turn_id: is_worker.then(|| session.outer_turn_id.clone()).flatten(),
            suppress,
        })
    }

    pub(crate) fn interrupt_target(&self, task_id: &str) -> Option<(String, String)> {
        let sessions = self.sessions.lock().ok()?;
        let session = sessions.get(task_id)?;
        Some((
            session
                .worker_task_id
                .clone()
                .unwrap_or_else(|| task_id.to_owned()),
            session
                .worker_turn_id
                .clone()
                .or_else(|| session.outer_turn_id.clone())?,
        ))
    }

    pub(crate) fn target_item(&self, task_id: &str, turn_id: &str) -> Option<Value> {
        let sessions = self.sessions.lock().ok()?;
        let target = sessions.get(task_id)?.target.clone();
        Some(json!({ "id": format!("review-mode-{turn_id}"), "target": target, "type": "review" }))
    }

    pub(crate) fn clear(&self, task_id: &str) {
        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.remove(task_id);
        }
    }

    pub(crate) fn contains(&self, task_id: &str) -> bool {
        self.sessions
            .lock()
            .is_ok_and(|sessions| sessions.contains_key(task_id))
    }
}

pub(crate) fn map_review_target(target: &Value) -> Result<Value, CodeAgentError> {
    match target["type"].as_str() {
        Some("uncommitted_changes") => Ok(json!({ "type": "uncommittedChanges" })),
        Some("base_branch") => Ok(json!({ "branch": target["branch"], "type": "baseBranch" })),
        Some("commit") => Ok(
            json!({ "sha": target["sha"], "title": target.get("title").cloned().unwrap_or(Value::Null), "type": "commit" }),
        ),
        Some("custom") => Ok(json!({ "instructions": target["instructions"], "type": "custom" })),
        _ => Err(CodeAgentError::internal("review target is invalid")),
    }
}
