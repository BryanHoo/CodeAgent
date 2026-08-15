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

const TASK_TURN_PAGE_SIZE: u32 = 20;

struct MappedTurnPage {
    next_cursor: Option<String>,
    turns: Vec<Value>,
}

impl CodexProjectProvider {
    fn rollback_task_claim(&self, task_id: &str) {
        if let Ok(mut tasks) = self.tasks.lock() {
            tasks.remove(task_id);
        }
        let project_id = self.project.id.as_str();
        if let Ok(mut owners) = self.owners.lock()
            && owners.get(task_id).map(String::as_str) == Some(project_id)
        {
            owners.remove(task_id);
        }
    }

    pub(super) async fn restore_task_subscription_impl(
        &self,
        task_id: &str,
    ) -> Result<bool, CodeAgentError> {
        // resume 可能在响应前立即推送通知，必须先恢复路由归属以免丢失首批事件。
        let already_claimed = self.has_task(task_id);
        self.claim_task(task_id, false)?;
        let response = match self
            .client
            .request("thread/resume", Some(json!({ "threadId": task_id })))
            .await
        {
            Ok(response) => response,
            Err(error) if is_thread_not_loaded(&error) || is_thread_not_materialized(&error) => {
                self.rollback_task_claim(task_id);
                return Ok(false);
            }
            Err(error) => {
                if !already_claimed {
                    self.rollback_task_claim(task_id);
                }
                return Err(rpc_error_to_code_agent_error(&error));
            }
        };
        let thread = &response["thread"];
        if thread["id"] != task_id {
            if !already_claimed {
                self.rollback_task_claim(task_id);
            }
            return Err(CodeAgentError::internal(
                "thread/resume returned a different thread",
            ));
        }
        let Some(cwd) = thread["cwd"].as_str() else {
            if !already_claimed {
                self.rollback_task_claim(task_id);
            }
            return Err(CodeAgentError::internal("Codex thread cwd is invalid"));
        };
        if !same_canonical_path(cwd, self.project.root_path.as_str()).await {
            if !already_claimed {
                self.rollback_task_claim(task_id);
            }
            return Ok(false);
        }
        self.resumed
            .lock()
            .map_err(|_| CodeAgentError::internal("resume registry is poisoned"))?
            .insert(task_id.to_owned());
        Ok(true)
    }

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
        let pinned_only = input
            .get("pinnedOnly")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        if pinned_only {
            // Codex 固定任务拥有独立 section，直接过滤避免扫描普通历史。
            params["sectionId"] = Value::String(CODEX_PINNED_THREAD_SECTION_ID.to_string());
            params["useStateDbOnly"] = Value::Bool(true);
        }
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
        let mut data = if input.get("cursor").is_none() && !pinned_only {
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
                Some(json!({ "includeTurns": false, "threadId": task_id })),
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
        let page = self.read_mapped_task_turns(task_id, None).await?;
        let turns = page.turns;
        let mut snapshot = map_task(thread, self.project.id.as_str())?;
        snapshot["turns"] = json!(turns);
        snapshot["turnsNextCursor"] = page.next_cursor.map_or(Value::Null, Value::String);
        let pending = self.pending.snapshot();
        self.task_state.enrich_snapshot(
            task_id,
            &mut snapshot,
            thread.get("status"),
            &turns,
            &pending,
        );
        self.task_state
            .sync_running(task_id, snapshot["status"] == "running");
        Ok(Some(snapshot))
    }

    pub(super) async fn list_task_turns_impl(
        &self,
        task_id: &str,
        cursor: Option<&str>,
    ) -> Result<Value, CodeAgentError> {
        self.assert_task(task_id)?;
        let page = self.read_mapped_task_turns(task_id, cursor).await?;
        Ok(json!({
            "data": page.turns,
            "nextCursor": page.next_cursor
        }))
    }

    async fn read_mapped_task_turns(
        &self,
        task_id: &str,
        cursor: Option<&str>,
    ) -> Result<MappedTurnPage, CodeAgentError> {
        let mut params = json!({
            "itemsView": "full",
            "limit": TASK_TURN_PAGE_SIZE,
            "sortDirection": "desc",
            "threadId": task_id
        });
        if let Some(cursor) = cursor {
            params["cursor"] = Value::String(cursor.to_owned());
        }
        let response = self.rpc("thread/turns/list", Some(params)).await?;
        let native_turns = response["data"]
            .as_array()
            .ok_or_else(|| CodeAgentError::internal("thread/turns/list data is invalid"))?;
        let mut turns = map_history_turns(
            &self.client,
            &self.historical_attachments,
            task_id,
            native_turns,
        )
        .await?;
        // Codex 向后分页返回倒序页；公共时间线始终保持从旧到新的稳定顺序。
        turns.reverse();
        let transcript_skills = self.transcript_skills.read(task_id).await;
        for turn in &mut turns {
            if let Some(turn_id) = turn["id"].as_str()
                && let Some(names) = transcript_skills.get(turn_id)
            {
                crate::mapping::message_skills::attach_turn_skills(turn, names);
            }
        }
        let next_cursor = match response.get("nextCursor") {
            None | Some(Value::Null) => None,
            Some(Value::String(cursor)) => Some(cursor.clone()),
            Some(_) => {
                return Err(CodeAgentError::internal(
                    "thread/turns/list nextCursor is invalid",
                ));
            }
        };
        Ok(MappedTurnPage { next_cursor, turns })
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

    pub(super) async fn read_task_attachment_impl(
        &self,
        task_id: &str,
        attachment_id: &str,
    ) -> Option<code_agent_core::AttachmentBytes> {
        let authorized = self
            .tasks
            .lock()
            .ok()
            .is_some_and(|tasks| tasks.contains(task_id));
        if !authorized {
            return None;
        }
        self.historical_attachments
            .read(task_id, attachment_id)
            .await
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
        let lifecycle = self.lifecycle_lock(task_id)?;
        let _guard = lifecycle.lock().await;
        if !self.has_task(task_id) {
            return Ok("notLoaded".to_owned());
        }
        if self.has_lifecycle_obligations(task_id) {
            return Ok("busy".to_owned());
        }
        let terminals = self.list_background_terminals_impl(task_id).await?;
        if !terminals.data.is_empty() || self.has_lifecycle_obligations(task_id) {
            return Ok("busy".to_owned());
        }
        let response = self
            .rpc("thread/unsubscribe", Some(json!({ "threadId": task_id })))
            .await?;
        let status = response["status"]
            .as_str()
            .filter(|status| matches!(*status, "notLoaded" | "notSubscribed" | "unsubscribed"))
            .ok_or_else(|| {
                CodeAgentError::internal("thread/unsubscribe returned an unknown status")
            })?
            .to_string();
        self.historical_attachments.clear_task(task_id);
        self.task_state.clear_task(task_id);
        self.pending.clear_task(task_id);
        self.mcp.clear_task(task_id);
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
        if let Ok(mut locks) = self.lifecycle_locks.lock() {
            locks.remove(task_id);
        }
        Ok(status)
    }

    pub(super) async fn list_background_terminals_impl(
        &self,
        task_id: &str,
    ) -> Result<code_agent_protocol::AgentBackgroundTerminalPage, CodeAgentError> {
        let mut data = Vec::new();
        let mut cursor = None::<String>;
        let mut pagination =
            crate::pagination::PaginationGuard::new("thread/backgroundTerminals/list", 10_000);
        loop {
            let mut params = json!({ "limit": 100, "threadId": task_id });
            if let Some(value) = &cursor {
                params["cursor"] = Value::String(value.clone());
            }
            let response = match self
                .client
                .request("thread/backgroundTerminals/list", Some(params))
                .await
            {
                Ok(response) => response,
                Err(error) if crate::task_state::is_background_terminal_thread_missing(&error) => {
                    return serde_json::from_value(json!({ "data": [] }))
                        .map_err(|error| CodeAgentError::internal(error.to_string()));
                }
                Err(error) => return Err(rpc_error_to_code_agent_error(&error)),
            };
            let page = response["data"].as_array().ok_or_else(|| {
                CodeAgentError::internal("background terminal list data must be an array")
            })?;
            data.extend(page.iter().map(|terminal| {
                json!({
                    "command": terminal["command"], "cwd": terminal["cwd"],
                    "id": terminal["processId"], "itemId": terminal["itemId"]
                })
            }));
            cursor = pagination.advance(&response, data.len())?;
            if cursor.is_none() {
                break;
            }
        }
        serde_json::from_value(json!({ "data": data }))
            .map_err(|error| CodeAgentError::internal(error.to_string()))
    }
}
