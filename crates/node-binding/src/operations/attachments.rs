use std::str::FromStr;

use code_agent_protocol::AgentAttachmentKind;
use napi::bindgen_prelude::Buffer;
use napi_derive::napi;
use serde_json::Value;

use crate::{
    NodeEngine,
    errors::{invalid_input, to_napi_error},
    operations::{project_id, task_id},
};

fn kind(value: &str) -> napi::Result<AgentAttachmentKind> {
    AgentAttachmentKind::from_str(value).map_err(|_| invalid_input("invalid attachment kind"))
}

#[napi]
impl NodeEngine {
    #[napi]
    pub async fn attachment_upload(
        &self,
        request_id: String,
        project: String,
        kind_value: String,
        media_type: String,
        name: String,
        bytes: Buffer,
    ) -> napi::Result<Value> {
        let attachment = self
            .runtime()
            .upload_attachment(
                &request_id,
                &project_id(&project)?,
                kind(&kind_value)?,
                &media_type,
                &name,
                bytes.to_vec(),
            )
            .await
            .map_err(to_napi_error)?;
        serde_json::to_value(attachment).map_err(napi::Error::from)
    }

    #[napi]
    pub async fn attachment_import_host(
        &self,
        request_id: String,
        project: String,
        kind_value: String,
        path: String,
    ) -> napi::Result<Value> {
        let attachment = self
            .runtime()
            .import_host_attachment(
                &request_id,
                &project_id(&project)?,
                kind(&kind_value)?,
                &path,
            )
            .await
            .map_err(to_napi_error)?;
        serde_json::to_value(attachment).map_err(napi::Error::from)
    }

    #[napi]
    pub async fn attachment_pending_read(
        &self,
        request_id: String,
        project: String,
        attachment: String,
    ) -> napi::Result<Buffer> {
        self.runtime()
            .pending_attachment(&request_id, &project_id(&project)?, &attachment)
            .await
            .map(Buffer::from)
            .map_err(to_napi_error)
    }

    #[napi]
    pub async fn attachment_task_read(
        &self,
        request_id: String,
        project: String,
        task: String,
        attachment: String,
    ) -> napi::Result<Buffer> {
        self.runtime()
            .task_attachment(
                &request_id,
                &project_id(&project)?,
                &task_id(&task)?,
                &attachment,
            )
            .await
            .map(Buffer::from)
            .map_err(to_napi_error)
    }

    #[napi]
    pub async fn attachment_open(
        &self,
        request_id: String,
        project: String,
        task: String,
        attachment: String,
    ) -> napi::Result<()> {
        self.runtime()
            .open_task_attachment(
                &request_id,
                &project_id(&project)?,
                &task_id(&task)?,
                &attachment,
            )
            .await
            .map_err(to_napi_error)
    }
}
