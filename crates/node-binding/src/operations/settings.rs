use code_agent_protocol::{AgentGlobalSettings, AgentProjectDefaults, AgentTaskSettings};
use napi_derive::napi;
use serde_json::{Value, json};

use crate::{
    NodeEngine,
    errors::{invalid_input, to_napi_error},
    operations::{project_id, task_id},
};

fn parse<T: serde::de::DeserializeOwned>(value: Value) -> napi::Result<T> {
    serde_json::from_value(value).map_err(|error| invalid_input(error.to_string()))
}

#[napi]
impl NodeEngine {
    #[napi]
    pub async fn global_settings_get(&self, request_id: String) -> napi::Result<Value> {
        let settings = self
            .runtime()
            .effective_global_settings(&request_id)
            .await
            .map_err(to_napi_error)?;
        Ok(json!({ "settings": settings }))
    }

    #[napi]
    pub async fn global_settings_update(
        &self,
        request_id: String,
        settings: Value,
    ) -> napi::Result<Value> {
        let settings: AgentGlobalSettings = parse(settings)?;
        let settings = self
            .runtime()
            .update_global_settings(&request_id, &settings)
            .await
            .map_err(to_napi_error)?;
        Ok(json!({ "settings": settings }))
    }

    #[napi]
    pub async fn project_defaults_get(
        &self,
        request_id: String,
        project: String,
    ) -> napi::Result<Value> {
        let settings = self
            .runtime()
            .effective_project_defaults(&request_id, &project_id(&project)?)
            .await
            .map_err(to_napi_error)?;
        Ok(json!({ "settings": settings }))
    }

    #[napi]
    pub async fn project_defaults_update(
        &self,
        request_id: String,
        project: String,
        settings: Value,
    ) -> napi::Result<Value> {
        let settings: AgentProjectDefaults = parse(settings)?;
        let settings = self
            .runtime()
            .update_project_defaults(&request_id, &project_id(&project)?, &settings)
            .await
            .map_err(to_napi_error)?;
        Ok(json!({ "settings": settings }))
    }

    #[napi]
    pub async fn task_settings_get(
        &self,
        request_id: String,
        project: String,
        task: String,
    ) -> napi::Result<Value> {
        let settings = self
            .runtime()
            .task_settings(&request_id, &project_id(&project)?, &task_id(&task)?)
            .await
            .map_err(to_napi_error)?;
        Ok(json!({ "settings": settings }))
    }

    #[napi]
    pub async fn task_settings_update(
        &self,
        request_id: String,
        project: String,
        task: String,
        settings: Value,
    ) -> napi::Result<Value> {
        let settings: AgentTaskSettings = parse(settings)?;
        let settings = self
            .runtime()
            .update_task_settings(
                &request_id,
                &project_id(&project)?,
                &task_id(&task)?,
                &settings,
            )
            .await
            .map_err(to_napi_error)?;
        Ok(json!({ "settings": settings }))
    }
}
