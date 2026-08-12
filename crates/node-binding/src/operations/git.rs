use code_agent_protocol::GenerateCommitMessageRequest;
use napi_derive::napi;
use serde_json::Value;

use crate::{
    NodeEngine,
    errors::{invalid_input, to_napi_error},
    operations::project_id,
};

#[napi]
impl NodeEngine {
    #[napi]
    pub async fn git_status(
        &self,
        request_id: String,
        project: String,
        repository: Option<String>,
    ) -> napi::Result<Value> {
        self.runtime()
            .git_status(&request_id, &project_id(&project)?, repository.as_deref())
            .await
            .map_err(to_napi_error)
    }

    #[napi]
    pub async fn git_history(
        &self,
        request_id: String,
        project: String,
        query: Value,
    ) -> napi::Result<Value> {
        self.runtime()
            .git_history(&request_id, &project_id(&project)?, &query)
            .await
            .map_err(to_napi_error)
    }

    #[napi]
    pub async fn git_commit_files(
        &self,
        request_id: String,
        project: String,
        query: Value,
    ) -> napi::Result<Value> {
        self.runtime()
            .git_commit_files(&request_id, &project_id(&project)?, &query)
            .await
            .map_err(to_napi_error)
    }

    #[napi]
    pub async fn git_commit_diff(
        &self,
        request_id: String,
        project: String,
        query: Value,
    ) -> napi::Result<Value> {
        self.runtime()
            .git_commit_diff(&request_id, &project_id(&project)?, &query)
            .await
            .map_err(to_napi_error)
    }

    #[napi]
    pub async fn git_branch_switch(
        &self,
        request_id: String,
        project: String,
        branch: String,
        expected_snapshot: String,
    ) -> napi::Result<Value> {
        self.runtime()
            .git_switch_branch(
                &request_id,
                &project_id(&project)?,
                &branch,
                &expected_snapshot,
            )
            .await
            .map_err(to_napi_error)
    }

    #[napi]
    pub async fn git_branch_create(
        &self,
        request_id: String,
        project: String,
        branch: String,
        expected_snapshot: String,
    ) -> napi::Result<Value> {
        self.runtime()
            .git_create_branch(
                &request_id,
                &project_id(&project)?,
                &branch,
                &expected_snapshot,
            )
            .await
            .map_err(to_napi_error)
    }

    #[napi]
    pub async fn git_commit(
        &self,
        request_id: String,
        project: String,
        request: Value,
    ) -> napi::Result<Value> {
        self.runtime()
            .git_commit(&request_id, &project_id(&project)?, &request)
            .await
            .map_err(to_napi_error)
    }

    #[napi]
    pub async fn git_commit_message_generate(
        &self,
        request_id: String,
        project: String,
        request: Value,
    ) -> napi::Result<Value> {
        let request: GenerateCommitMessageRequest =
            serde_json::from_value(request).map_err(|error| invalid_input(error.to_string()))?;
        let response = self
            .runtime()
            .generate_commit_message(&request_id, &project_id(&project)?, &request)
            .await
            .map_err(to_napi_error)?;
        serde_json::to_value(response).map_err(napi::Error::from)
    }
}
