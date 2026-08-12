use std::collections::HashMap;
use std::sync::Mutex;

use code_agent_core::CodeAgentError;
use serde_json::Value;
use tokio::sync::oneshot;

#[derive(Default)]
pub(crate) struct GoalRegistry {
    waiters: Mutex<HashMap<String, oneshot::Sender<Value>>>,
}

impl GoalRegistry {
    pub(crate) fn wait(&self, task_id: &str) -> Result<oneshot::Receiver<Value>, CodeAgentError> {
        let (sender, receiver) = oneshot::channel();
        let mut waiters = self
            .waiters
            .lock()
            .map_err(|_| CodeAgentError::internal("goal registry is poisoned"))?;
        if waiters.contains_key(task_id) {
            return Err(CodeAgentError::internal("goal turn is already pending"));
        }
        waiters.insert(task_id.to_owned(), sender);
        Ok(receiver)
    }

    pub(crate) fn started(&self, task_id: &str, turn: Value) {
        if let Ok(mut waiters) = self.waiters.lock()
            && let Some(waiter) = waiters.remove(task_id)
        {
            let _ = waiter.send(turn);
        }
    }

    pub(crate) fn cancel(&self, task_id: &str) {
        if let Ok(mut waiters) = self.waiters.lock() {
            waiters.remove(task_id);
        }
    }

    pub(crate) fn contains(&self, task_id: &str) -> bool {
        self.waiters
            .lock()
            .is_ok_and(|waiters| waiters.contains_key(task_id))
    }
}
