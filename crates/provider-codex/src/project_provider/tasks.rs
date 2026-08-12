use code_agent_core::CodeAgentError;
use code_agent_protocol::AgentTaskPage;
use serde_json::{Value, json};

use super::CodexProjectProvider;
use crate::{
    history_mapping::map_history_turns,
    rpc_error_to_code_agent_error,
    task_state::{
        CODEX_PINNED_THREAD_SECTION_ID, empty_snapshot, is_thread_not_loaded,
        is_thread_not_materialized, map_task, same_canonical_path,
    },
};

impl CodexProjectProvider {
    pub(super) async fn start_task_impl(&self, input: Value) -> Result<Value, CodeAgentError> {
        let ephemeral = input
            .get("ephemeral")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let response = self
            .rpc(
                "thread/start",
                Some(json!({ "cwd": self.project.root_path.as_str(), "ephemeral": ephemeral })),
            )
            .await?;
        let task = map_task(&response["thread"], self.project.id.as_str())?;
        self.claim_task(task["id"].as_str().unwrap_or_default(), ephemeral)?;
        self.resumed
            .lock()
            .map_err(|_| CodeAgentError::internal("resume registry is poisoned"))?
            .insert(task["id"].as_str().unwrap_or_default().to_string());
        if !ephemeral {
            self.task_state.remember_unmaterialized(task.clone())?;
        }
        Ok(task)
    }

    pub(super) async fn list_tasks_impl(
        &self,
        input: Value,
    ) -> Result<AgentTaskPage, CodeAgentError> {
        let mut params = json!({
            "cwd": self.project.root_path.as_str(),
            "sortDirection": "desc",
            "sortKey": "updated_at"
        });
        if let Some(cursor) = input.get("cursor") {
            params["cursor"] = cursor.clone();
        }
        if let Some(limit) = input.get("limit") {
            params["limit"] = limit.clone();
        }
        let response = self.rpc("thread/list", Some(params)).await?;
        let threads = response
            .get("data")
            .and_then(Value::as_array)
            .ok_or_else(|| CodeAgentError::internal("thread/list data is invalid"))?;
        let mut native_data = Vec::with_capacity(threads.len());
        for thread in threads {
            let cwd = thread["cwd"]
                .as_str()
                .ok_or_else(|| CodeAgentError::internal("Codex thread cwd is invalid"))?;
            if !same_canonical_path(cwd, self.project.root_path.as_str()).await {
                return Err(CodeAgentError::internal(
                    "Codex thread does not belong to the active project",
                ));
            }
            native_data.push(map_task(thread, self.project.id.as_str())?);
        }
        for task in &native_data {
            self.claim_task(task["id"].as_str().unwrap_or_default(), false)?;
            self.task_state
                .materialized(task["id"].as_str().unwrap_or_default());
        }
        let mut data = if input.get("cursor").is_none() {
            self.task_state.pending_tasks()
        } else {
            Vec::new()
        };
        data.extend(native_data);
        serde_json::from_value(json!({
            "data": data,
            "nextCursor": response.get("nextCursor").cloned().unwrap_or(Value::Null)
        }))
        .map_err(|error| CodeAgentError::internal(error.to_string()))
    }

    pub(super) async fn read_task_impl(
        &self,
        task_id: &str,
    ) -> Result<Option<Value>, CodeAgentError> {
        let response = match self
            .client
            .request(
                "thread/read",
                Some(json!({ "includeTurns": true, "threadId": task_id })),
            )
            .await
        {
            Ok(response) => response,
            Err(error) if is_thread_not_loaded(&error) => return Ok(None),
            Err(error) if is_thread_not_materialized(&error) => {
                if let Some(task) = self.task_state.unmaterialized(task_id) {
                    return Ok(Some(empty_snapshot(task)));
                }
                return Err(rpc_error_to_code_agent_error(&error));
            }
            Err(error) => return Err(rpc_error_to_code_agent_error(&error)),
        };
        let thread = &response["thread"];
        let cwd = thread["cwd"]
            .as_str()
            .ok_or_else(|| CodeAgentError::internal("Codex thread cwd is invalid"))?;
        if !same_canonical_path(cwd, self.project.root_path.as_str()).await {
            return Ok(None);
        }
        self.claim_task(task_id, false)?;
        self.task_state.materialized(task_id);
        let native_turns = thread["turns"]
            .as_array()
            .ok_or_else(|| CodeAgentError::internal("Codex thread turns are invalid"))?;
        let turns = map_history_turns(
            &self.client,
            &self.historical_attachments,
            task_id,
            native_turns,
        )
        .await?;
        let mut snapshot = map_task(thread, self.project.id.as_str())?;
        snapshot["turns"] = json!(turns);
        let pending = self
            .pending
            .lock()
            .map_err(|_| CodeAgentError::internal("pending registry is poisoned"))?;
        self.task_state.enrich_snapshot(
            task_id,
            &mut snapshot,
            thread.get("status"),
            &turns,
            &pending,
        );
        Ok(Some(snapshot))
    }

    pub(super) async fn pin_task_impl(
        &self,
        task_id: &str,
        pinned: bool,
    ) -> Result<Value, CodeAgentError> {
        self.assert_task(task_id)?;
        self.rpc(
            "thread/section/move",
            Some(json!({
                "sectionId": if pinned {
                    Value::String(CODEX_PINNED_THREAD_SECTION_ID.to_string())
                } else {
                    Value::Null
                },
                "threadId": task_id
            })),
        )
        .await?;
        let response = self
            .rpc(
                "thread/read",
                Some(json!({ "includeTurns": false, "threadId": task_id })),
            )
            .await?;
        let task = map_task(&response["thread"], self.project.id.as_str())?;
        if task["id"] != task_id || task["pinned"] != pinned {
            return Err(CodeAgentError::internal(
                "Codex thread pin state did not update",
            ));
        }
        Ok(task)
    }

    pub(super) fn read_task_attachment_impl(
        &self,
        task_id: &str,
        attachment_id: &str,
    ) -> Option<Vec<u8>> {
        self.tasks
            .lock()
            .ok()
            .filter(|tasks| tasks.contains(task_id))
            .and_then(|_| self.historical_attachments.read(task_id, attachment_id))
    }

    pub(super) async fn rename_task_impl(
        &self,
        task_id: &str,
        title: &str,
    ) -> Result<(), CodeAgentError> {
        self.assert_task(task_id)?;
        self.rpc(
            "thread/name/set",
            Some(json!({ "name": title, "threadId": task_id })),
        )
        .await
        .map(|_| ())
    }

    pub(super) async fn archive_task_impl(&self, task_id: &str) -> Result<(), CodeAgentError> {
        self.assert_task(task_id)?;
        self.rpc("thread/archive", Some(json!({ "threadId": task_id })))
            .await
            .map(|_| ())
    }

    pub(super) async fn fork_task_impl(&self, task_id: &str) -> Result<Value, CodeAgentError> {
        self.assert_task(task_id)?;
        let response = self
            .rpc("thread/fork", Some(json!({ "threadId": task_id })))
            .await?;
        let task = map_task(&response["thread"], self.project.id.as_str())?;
        self.claim_task(task["id"].as_str().unwrap_or_default(), false)?;
        self.task_state.remember_unmaterialized(task.clone())?;
        Ok(task)
    }

    pub(super) async fn compact_task_impl(&self, task_id: &str) -> Result<(), CodeAgentError> {
        self.assert_task(task_id)?;
        self.rpc("thread/compact/start", Some(json!({ "threadId": task_id })))
            .await
            .map(|_| ())
    }

    pub(super) async fn unsubscribe_task_impl(
        &self,
        task_id: &str,
    ) -> Result<String, CodeAgentError> {
        self.assert_task(task_id)?;
        let response = self
            .rpc("thread/unsubscribe", Some(json!({ "threadId": task_id })))
            .await?;
        let status = response["status"]
            .as_str()
            .unwrap_or("notLoaded")
            .to_string();
        self.historical_attachments.clear_task(task_id);
        self.task_state.clear_task(task_id);
        if let Ok(mut pending) = self.pending.lock() {
            pending.retain(|_, request| request.request["taskId"].as_str() != Some(task_id));
        }
        if let Ok(mut tasks) = self.tasks.lock() {
            tasks.remove(task_id);
        }
        if let Ok(mut tasks) = self.resumed.lock() {
            tasks.remove(task_id);
        }
        if let Ok(mut locks) = self.resume_locks.lock() {
            locks.remove(task_id);
        }
        if let Ok(mut tasks) = self.ephemeral.lock() {
            tasks.remove(task_id);
        }
        if let Ok(mut owners) = self.owners.lock() {
            owners.remove(task_id);
        }
        Ok(status)
    }
}
