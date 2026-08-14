use std::path::Path;

use napi_derive::napi;
use serde_json::{Value, json};

use crate::{NodeEngine, errors::to_napi_error, operations::project_id};

#[napi]
impl NodeEngine {
    #[napi]
    pub async fn project_list(&self, request_id: String) -> napi::Result<Value> {
        let projects = self
            .runtime()
            .list_projects(&request_id)
            .await
            .map_err(to_napi_error)?;
        Ok(json!({ "data": projects, "nextCursor": null }))
    }

    #[napi]
    pub async fn project_read(
        &self,
        request_id: String,
        project_id_value: String,
    ) -> napi::Result<Option<Value>> {
        let project = self
            .runtime()
            .read_project(&request_id, &project_id(&project_id_value)?)
            .await
            .map_err(to_napi_error)?;
        project
            .map(serde_json::to_value)
            .transpose()
            .map_err(napi::Error::from)
    }

    #[napi]
    pub async fn project_add(&self, request_id: String, root_path: String) -> napi::Result<Value> {
        let name = Path::new(&root_path)
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or(&root_path);
        let project = self
            .runtime()
            .register_project(&request_id, &request_id, &root_path, name)
            .await
            .map_err(to_napi_error)?;
        serde_json::to_value(project).map_err(napi::Error::from)
    }

    #[napi]
    pub async fn project_reorder(
        &self,
        request_id: String,
        project_ids: Vec<String>,
    ) -> napi::Result<Value> {
        let ids = project_ids
            .iter()
            .map(|value| project_id(value))
            .collect::<napi::Result<Vec<_>>>()?;
        let projects = self
            .runtime()
            .reorder_projects(&request_id, &request_id, &ids)
            .await
            .map_err(to_napi_error)?;
        Ok(json!({ "data": projects, "nextCursor": null }))
    }

    #[napi]
    pub async fn project_rename(
        &self,
        request_id: String,
        project_id_value: String,
        name: String,
    ) -> napi::Result<Value> {
        let project = self
            .runtime()
            .rename_project(
                &request_id,
                &request_id,
                &project_id(&project_id_value)?,
                &name,
            )
            .await
            .map_err(to_napi_error)?;
        serde_json::to_value(project).map_err(napi::Error::from)
    }

    #[napi]
    pub async fn project_remove(
        &self,
        request_id: String,
        project_id_value: String,
    ) -> napi::Result<()> {
        self.runtime()
            .remove_project(&request_id, &request_id, &project_id(&project_id_value)?)
            .await
            .map_err(to_napi_error)
    }
}
