use std::time::Duration;

use code_agent_core::{
    CodeAgentError, CodeAgentErrorCode, PortRequestContext, ProjectProviderPort,
};
use code_agent_protocol::{ValueDefinition, parse_protocol_value};
use serde_json::{Value, json};

use super::CodexProjectProvider;
use crate::{
    map_codex_turn,
    prompt::{map_prompt, map_turn_options},
    review::map_review_target,
};

const GOAL_TURN_TIMEOUT: Duration = Duration::from_secs(30);

impl CodexProjectProvider {
    pub(super) async fn start_turn_impl(
        &self,
        task_id: &str,
        mut input: Value,
        context: &PortRequestContext,
    ) -> Result<Value, CodeAgentError> {
        let lifecycle = self.lifecycle_lock(task_id)?;
        let _guard = lifecycle.lock().await;
        self.assert_task(task_id)?;
        self.resume(task_id).await?;
        if input["options"]["goalMode"] == true {
            return self.start_goal_impl(task_id, &input).await;
        }
        if let Some(prompt) = input.get("prompt").cloned() {
            let native = self.map_prompt_with_skills(&prompt, context).await?;
            input = map_turn_options(&input["options"])?;
            input["input"] = Value::Array(native);
        }
        input["threadId"] = Value::String(task_id.to_owned());
        let response = self.rpc("turn/start", Some(input)).await?;
        let turn = map_turn(&response["turn"])?;
        if turn["status"] == "running" {
            self.task_state.mark_running(task_id);
        }
        Ok(turn)
    }

    async fn start_goal_impl(&self, task_id: &str, input: &Value) -> Result<Value, CodeAgentError> {
        let objective = input["prompt"]["text"]
            .as_str()
            .map(str::trim)
            .filter(|value| !value.is_empty() && value.chars().count() <= 4_000)
            .ok_or_else(|| invalid("goal objective must contain between 1 and 4000 characters"))?;
        let started = self.goals.wait(task_id)?;
        let result = async {
            let mut settings = map_turn_options(&input["options"])?;
            settings["threadId"] = Value::String(task_id.to_owned());
            self.rpc("thread/settings/update", Some(settings)).await?;
            let response = self
                .rpc(
                    "thread/goal/set",
                    Some(
                        json!({ "objective": objective, "status": "active", "threadId": task_id }),
                    ),
                )
                .await?;
            if response["goal"]["threadId"] != task_id || response["goal"]["objective"] != objective
            {
                return Err(CodeAgentError::internal(
                    "thread/goal/set returned an unexpected goal",
                ));
            }
            let turn = tokio::time::timeout(GOAL_TURN_TIMEOUT, started)
                .await
                .map_err(|_| CodeAgentError::internal("thread/goal/set did not start a turn"))?
                .map_err(|_| CodeAgentError::internal("goal turn waiter was cancelled"))?;
            let turn = map_turn(&turn)?;
            if turn["status"] == "running" {
                self.task_state.mark_running(task_id);
            }
            Ok(turn)
        }
        .await;
        if result.is_err() {
            self.goals.cancel(task_id);
        }
        result
    }

    pub(super) async fn steer_turn_impl(
        &self,
        task_id: &str,
        turn_id: &str,
        input: Value,
        context: &PortRequestContext,
    ) -> Result<(), CodeAgentError> {
        self.assert_task(task_id)?;
        let native = if let Some(prompt) = input.get("prompt") {
            self.map_prompt_with_skills(prompt, context).await?
        } else {
            input["input"]
                .as_array()
                .cloned()
                .ok_or_else(|| invalid("turn/steer input is invalid"))?
        };
        let response = self
            .rpc(
                "turn/steer",
                Some(json!({ "expectedTurnId": turn_id, "input": native, "threadId": task_id })),
            )
            .await?;
        if response["turnId"].as_str().is_some_and(|id| id != turn_id) {
            return Err(CodeAgentError::internal(
                "turn/steer returned an unexpected turn id",
            ));
        }
        Ok(())
    }

    async fn map_prompt_with_skills(
        &self,
        prompt: &Value,
        context: &PortRequestContext,
    ) -> Result<Vec<Value>, CodeAgentError> {
        let uses_skills = prompt["skills"]
            .as_array()
            .is_some_and(|skills| !skills.is_empty());
        if uses_skills
            && self
                .skills
                .lock()
                .map(|skills| skills.is_empty())
                .unwrap_or(true)
        {
            self.list_skills(context).await?;
        }
        let skills = self
            .skills
            .lock()
            .map_err(|_| CodeAgentError::internal("skill catalog is poisoned"))?
            .clone();
        map_prompt(prompt, &skills).await
    }

    pub(super) async fn interrupt_turn_impl(
        &self,
        task_id: &str,
        turn_id: &str,
    ) -> Result<(), CodeAgentError> {
        self.assert_task(task_id)?;
        let (interrupt_task, interrupt_turn) = self
            .reviews
            .interrupt_target(task_id)
            .unwrap_or_else(|| (task_id.to_owned(), turn_id.to_owned()));
        self.rpc(
            "turn/interrupt",
            Some(json!({ "threadId": interrupt_task, "turnId": interrupt_turn })),
        )
        .await
        .map(|_| ())
    }

    pub(super) async fn start_review_impl(
        &self,
        task_id: &str,
        target: Value,
    ) -> Result<Value, CodeAgentError> {
        let lifecycle = self.lifecycle_lock(task_id)?;
        let _guard = lifecycle.lock().await;
        self.assert_task(task_id)?;
        parse_protocol_value(
            ValueDefinition::ReviewAgentTaskRequest,
            json!({ "target": target }),
        )
        .map_err(|error| invalid_owned(error.to_string()))?;
        self.reviews.begin(task_id, target.clone())?;
        let result = async {
            let response = self
                .rpc(
                    "review/start",
                    Some(json!({
                        "delivery": "inline",
                        "target": map_review_target(&target)?,
                        "threadId": task_id
                    })),
                )
                .await?;
            if response["reviewThreadId"] != task_id {
                return Err(CodeAgentError::internal(
                    "review/start returned a different thread",
                ));
            }
            let mut turn = map_turn(&response["turn"])?;
            let turn_id = turn["id"]
                .as_str()
                .ok_or_else(|| CodeAgentError::internal("review turn id is invalid"))?;
            self.reviews.set_outer_turn(task_id, turn_id);
            if let Some(item) = self.reviews.target_item(task_id, turn_id) {
                turn["items"] = json!([item]);
            }
            if turn["status"] == "running" {
                self.task_state.mark_running(task_id);
            }
            Ok(turn)
        }
        .await;
        if result.is_err() {
            self.reviews.clear(task_id);
        }
        result
    }
}

fn map_turn(turn: &Value) -> Result<Value, CodeAgentError> {
    map_codex_turn(turn).map_err(|error| CodeAgentError::internal(error.to_string()))
}

fn invalid(message: &'static str) -> CodeAgentError {
    CodeAgentError::new(CodeAgentErrorCode::InvalidInput, message, None)
}

fn invalid_owned(message: String) -> CodeAgentError {
    CodeAgentError::new(CodeAgentErrorCode::InvalidInput, message, None)
}
