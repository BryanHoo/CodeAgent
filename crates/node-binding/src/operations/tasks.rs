use napi_derive::napi;
use serde_json::{Value, json};

use crate::{NodeEngine, errors::to_napi_error, operations::project_id};

#[napi]
impl NodeEngine {
    #[napi]
    pub async fn task_list(
        &self,
        request_id: String,
        project: String,
        input: Value,
    ) -> napi::Result<Value> {
        serde_json::to_value(
            self.runtime()
                .list_agent_tasks(&request_id, &project_id(&project)?, input)
                .await
                .map_err(to_napi_error)?,
        )
        .map_err(napi::Error::from)
    }

    #[napi]
    pub async fn task_start(
        &self,
        request_id: String,
        project: String,
        input: Value,
    ) -> napi::Result<Value> {
        self.runtime()
            .start_agent_task(&request_id, &request_id, &project_id(&project)?, input)
            .await
            .map_err(to_napi_error)
    }

    #[napi]
    pub async fn task_read(
        &self,
        request_id: String,
        project: String,
        task: String,
    ) -> napi::Result<Option<Value>> {
        self.runtime()
            .read_agent_task(&request_id, &project_id(&project)?, &task)
            .await
            .map_err(to_napi_error)
    }

    #[napi]
    pub async fn turn_start(
        &self,
        request_id: String,
        project: String,
        task: String,
        input: Value,
    ) -> napi::Result<Value> {
        self.runtime()
            .start_agent_turn(
                &request_id,
                &request_id,
                &project_id(&project)?,
                &task,
                input,
            )
            .await
            .map_err(to_napi_error)
    }

    #[napi]
    pub async fn turn_steer(
        &self,
        request_id: String,
        project: String,
        task: String,
        turn: String,
        input: Value,
    ) -> napi::Result<()> {
        self.runtime()
            .steer_agent_turn(
                &request_id,
                &request_id,
                &project_id(&project)?,
                &task,
                &turn,
                input,
            )
            .await
            .map_err(to_napi_error)
    }

    #[napi]
    pub async fn turn_interrupt(
        &self,
        request_id: String,
        project: String,
        task: String,
        turn: String,
    ) -> napi::Result<()> {
        self.runtime()
            .interrupt_agent_turn(
                &request_id,
                &request_id,
                &project_id(&project)?,
                &task,
                &turn,
            )
            .await
            .map_err(to_napi_error)
    }

    #[napi]
    pub async fn turn_review_start(
        &self,
        request_id: String,
        project: String,
        task: String,
        target: Value,
    ) -> napi::Result<Value> {
        self.runtime()
            .start_agent_review(
                &request_id,
                &request_id,
                &project_id(&project)?,
                &task,
                target,
            )
            .await
            .map_err(to_napi_error)
    }

    #[napi]
    pub async fn pending_request_resolve(
        &self,
        request_id: String,
        project: String,
        input: Value,
    ) -> napi::Result<Value> {
        let request = self
            .runtime()
            .resolve_agent_pending_request(&request_id, &request_id, &project_id(&project)?, input)
            .await
            .map_err(to_napi_error)?;
        Ok(json!({ "request": request }))
    }

    #[napi]
    pub async fn task_pin(
        &self,
        request_id: String,
        project: String,
        task: String,
        pinned: bool,
    ) -> napi::Result<Value> {
        self.runtime()
            .pin_agent_task(
                &request_id,
                &request_id,
                &project_id(&project)?,
                &task,
                pinned,
            )
            .await
            .map_err(to_napi_error)
    }

    #[napi]
    pub async fn task_rename(
        &self,
        request_id: String,
        project: String,
        task: String,
        title: String,
    ) -> napi::Result<Value> {
        self.runtime()
            .rename_agent_task(
                &request_id,
                &request_id,
                &project_id(&project)?,
                &task,
                &title,
            )
            .await
            .map_err(to_napi_error)?;
        let response = self
            .runtime()
            .read_agent_task(&format!("{request_id}:read"), &project_id(&project)?, &task)
            .await
            .map_err(to_napi_error)?
            .ok_or_else(|| crate::errors::invalid_input("renamed task was not found"))?;
        let snapshot = &response["snapshot"];
        Ok(serde_json::json!({
            "id": snapshot["id"], "pinned": snapshot["pinned"],
            "projectId": snapshot["projectId"], "title": snapshot["title"],
            "updatedAt": snapshot["updatedAt"]
        }))
    }

    #[napi]
    pub async fn task_archive(
        &self,
        request_id: String,
        project: String,
        task: String,
    ) -> napi::Result<()> {
        self.runtime()
            .archive_agent_task(&request_id, &request_id, &project_id(&project)?, &task)
            .await
            .map_err(to_napi_error)
    }

    #[napi]
    pub async fn task_fork(
        &self,
        request_id: String,
        project: String,
        task: String,
    ) -> napi::Result<Value> {
        self.runtime()
            .fork_agent_task(&request_id, &request_id, &project_id(&project)?, &task)
            .await
            .map_err(to_napi_error)
    }

    #[napi]
    pub async fn task_compact(
        &self,
        request_id: String,
        project: String,
        task: String,
    ) -> napi::Result<()> {
        self.runtime()
            .compact_agent_task(&request_id, &request_id, &project_id(&project)?, &task)
            .await
            .map_err(to_napi_error)
    }

    #[napi]
    pub async fn task_unsubscribe(
        &self,
        request_id: String,
        project: String,
        task: String,
    ) -> napi::Result<String> {
        self.runtime()
            .unsubscribe_agent_task(&request_id, &request_id, &project_id(&project)?, &task)
            .await
            .map_err(to_napi_error)
    }

    #[napi]
    pub async fn task_mcp_servers(
        &self,
        request_id: String,
        project: String,
        task: String,
    ) -> napi::Result<Value> {
        serde_json::to_value(
            self.runtime()
                .agent_mcp_servers(&request_id, &project_id(&project)?, &task)
                .await
                .map_err(to_napi_error)?,
        )
        .map_err(napi::Error::from)
    }

    #[napi]
    pub async fn task_mcp_reload(
        &self,
        request_id: String,
        project: String,
        task: String,
    ) -> napi::Result<Value> {
        serde_json::to_value(
            self.runtime()
                .reload_agent_mcp_servers(&request_id, &request_id, &project_id(&project)?, &task)
                .await
                .map_err(to_napi_error)?,
        )
        .map_err(napi::Error::from)
    }

    #[napi]
    pub async fn task_terminals(
        &self,
        request_id: String,
        project: String,
        task: String,
    ) -> napi::Result<Value> {
        serde_json::to_value(
            self.runtime()
                .agent_background_terminals(&request_id, &project_id(&project)?, &task)
                .await
                .map_err(to_napi_error)?,
        )
        .map_err(napi::Error::from)
    }

    #[napi]
    pub async fn task_terminal_terminate(
        &self,
        request_id: String,
        project: String,
        task: String,
        terminal: String,
    ) -> napi::Result<bool> {
        self.runtime()
            .terminate_agent_terminal(
                &request_id,
                &request_id,
                &project_id(&project)?,
                &task,
                &terminal,
            )
            .await
            .map_err(to_napi_error)
    }

    #[napi]
    pub async fn task_feedback_upload(
        &self,
        request_id: String,
        project: String,
        task: String,
        input: Value,
    ) -> napi::Result<()> {
        self.runtime()
            .upload_agent_feedback(
                &request_id,
                &request_id,
                &project_id(&project)?,
                &task,
                input,
            )
            .await
            .map_err(to_napi_error)
    }
}
