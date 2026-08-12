use napi_derive::napi;
use serde_json::Value;

use crate::{NodeEngine, errors::to_napi_error, operations::project_id};

#[napi]
impl NodeEngine {
    #[napi]
    pub async fn capabilities_get(&self, request_id: String) -> napi::Result<Value> {
        serde_json::to_value(
            self.runtime()
                .capabilities(&request_id)
                .await
                .map_err(to_napi_error)?,
        )
        .map_err(napi::Error::from)
    }

    #[napi]
    pub async fn models_list(&self, request_id: String) -> napi::Result<Value> {
        serde_json::to_value(
            self.runtime()
                .models(&request_id)
                .await
                .map_err(to_napi_error)?,
        )
        .map_err(napi::Error::from)
    }

    #[napi]
    pub async fn skills_list(&self, request_id: String, project: String) -> napi::Result<Value> {
        serde_json::to_value(
            self.runtime()
                .agent_skills(&request_id, &project_id(&project)?)
                .await
                .map_err(to_napi_error)?,
        )
        .map_err(napi::Error::from)
    }

    #[napi]
    pub async fn provider_connection_get(&self, request_id: String) -> napi::Result<Value> {
        self.runtime()
            .provider_connection_status(&request_id)
            .await
            .map_err(to_napi_error)
    }

    #[napi]
    pub async fn provider_login_start(&self, request_id: String) -> napi::Result<Value> {
        self.runtime()
            .start_provider_login(&request_id)
            .await
            .map_err(to_napi_error)
    }

    #[napi]
    pub async fn provider_login_cancel(
        &self,
        request_id: String,
        login_id: String,
    ) -> napi::Result<Value> {
        self.runtime()
            .cancel_provider_login(&request_id, &login_id)
            .await
            .map_err(to_napi_error)
    }

    #[napi]
    pub async fn provider_logout(&self, request_id: String) -> napi::Result<Value> {
        self.runtime()
            .logout_provider(&request_id)
            .await
            .map_err(to_napi_error)
    }

    #[napi]
    pub async fn provider_custom_configure(
        &self,
        request_id: String,
        input: Value,
    ) -> napi::Result<Value> {
        self.runtime()
            .configure_custom_provider(&request_id, input)
            .await
            .map_err(to_napi_error)
    }
}
