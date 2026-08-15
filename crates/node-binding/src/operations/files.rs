use napi::bindgen_prelude::Buffer;
use napi_derive::napi;
use serde_json::Value;

use crate::{NodeEngine, errors::to_napi_error, operations::project_id};

#[napi]
impl NodeEngine {
    #[napi]
    pub async fn file_source_read(
        &self,
        request_id: String,
        project: String,
        path: String,
        cursor: Option<i64>,
    ) -> napi::Result<Value> {
        let cursor = u64::try_from(cursor.unwrap_or(0))
            .map_err(|_| crate::errors::invalid_input("cursor must be non-negative"))?;
        self.runtime()
            .source_file(&request_id, &project_id(&project)?, &path, cursor)
            .await
            .map_err(to_napi_error)
    }

    #[napi]
    pub async fn file_tree(
        &self,
        request_id: String,
        project: String,
        path: Option<String>,
    ) -> napi::Result<Value> {
        self.runtime()
            .file_tree(&request_id, &project_id(&project)?, path.as_deref())
            .await
            .map_err(to_napi_error)
    }

    #[napi]
    pub async fn file_search(
        &self,
        request_id: String,
        project: String,
        query: String,
    ) -> napi::Result<Value> {
        self.runtime()
            .file_search(&request_id, &project_id(&project)?, &query)
            .await
            .map_err(to_napi_error)
    }

    #[napi]
    pub async fn project_directories_list(
        &self,
        request_id: String,
        path: Option<String>,
        show_hidden: Option<bool>,
    ) -> napi::Result<Value> {
        self.runtime()
            .project_directories(&request_id, path.as_deref(), show_hidden.unwrap_or(false))
            .await
            .map_err(to_napi_error)
    }

    #[napi]
    pub async fn host_files_list(
        &self,
        request_id: String,
        kind: String,
        path: Option<String>,
        show_hidden: Option<bool>,
    ) -> napi::Result<Value> {
        self.runtime()
            .host_files(
                &request_id,
                &kind,
                path.as_deref(),
                show_hidden.unwrap_or(false),
            )
            .await
            .map_err(to_napi_error)
    }

    #[napi]
    pub async fn project_open_capabilities(&self, request_id: String) -> napi::Result<Value> {
        self.runtime()
            .project_open_capabilities(&request_id)
            .await
            .map_err(to_napi_error)
    }

    #[napi]
    pub async fn project_open(
        &self,
        request_id: String,
        project: String,
        app_id: String,
        path: Option<String>,
    ) -> napi::Result<Value> {
        self.runtime()
            .open_project_path(
                &request_id,
                &request_id,
                &project_id(&project)?,
                &app_id,
                path.as_deref(),
            )
            .await
            .map_err(to_napi_error)
    }

    #[napi]
    pub async fn project_image(
        &self,
        request_id: String,
        project: String,
        path: String,
    ) -> napi::Result<Buffer> {
        self.runtime()
            .project_image(&request_id, &project_id(&project)?, &path)
            .await
            .map(Buffer::from)
            .map_err(to_napi_error)
    }
}
