use std::sync::Arc;

use napi_derive::napi;

use crate::{
    composition::{NodeRuntimeHost, open_runtime},
    errors::to_napi_error,
    events::EventSubscriptions,
    operations::ShutdownGate,
    types::{NodeEngineDiagnostic, NodeEngineOptions, NodeProcessExit},
};

pub(crate) struct NodeEngineInner {
    events: Arc<EventSubscriptions>,
    gate: ShutdownGate,
    host: NodeRuntimeHost,
    tokio: tokio::runtime::Handle,
}

#[napi]
pub struct NodeEngine {
    pub(crate) inner: Arc<NodeEngineInner>,
}

impl NodeEngine {
    pub(crate) fn event_subscriptions(&self) -> Arc<EventSubscriptions> {
        self.inner.events.clone()
    }

    pub(crate) fn runtime(&self) -> &code_agent_runtime::CodeAgentRuntime {
        &self.inner.host.runtime
    }

    pub(crate) fn runtime_arc(&self) -> Arc<code_agent_runtime::CodeAgentRuntime> {
        self.inner.host.runtime.clone()
    }

    pub(crate) fn tokio_handle(&self) -> &tokio::runtime::Handle {
        &self.inner.tokio
    }
}

#[napi]
impl NodeEngine {
    #[napi(factory)]
    pub async fn open(options: NodeEngineOptions) -> napi::Result<Self> {
        Ok(Self {
            inner: Arc::new(NodeEngineInner {
                events: Arc::new(EventSubscriptions::default()),
                gate: ShutdownGate::default(),
                host: open_runtime(options).await?,
                tokio: tokio::runtime::Handle::current(),
            }),
        })
    }

    #[napi]
    pub async fn diagnose(&self) -> napi::Result<NodeEngineDiagnostic> {
        let database = self.inner.host.database.clone();
        let diagnostics = tokio::task::spawn_blocking(move || database.diagnose())
            .await
            .map_err(|error| napi::Error::from_reason(error.to_string()))?
            .map_err(|error| napi::Error::from_reason(error.to_string()))?;
        Ok(NodeEngineDiagnostic {
            codex_version: self.inner.host.process.version().version.clone(),
            foreign_keys: diagnostics.foreign_keys,
            integrity_check: diagnostics.integrity_check,
            journal_mode: diagnostics.journal_mode,
            migration_version: diagnostics.migration_version,
        })
    }

    #[napi]
    pub async fn cancel_operation(&self, request_id: String) -> bool {
        self.inner.host.runtime.cancel_operation(&request_id).await
    }

    #[napi]
    pub async fn wait_for_exit(&self) -> NodeProcessExit {
        let exit = self.inner.host.process.wait_for_exit().await;
        NodeProcessExit {
            code: exit.code,
            signal: exit.signal,
        }
    }

    #[napi]
    pub async fn close(&self) -> napi::Result<()> {
        if !self.inner.gate.try_begin() {
            self.inner.gate.wait_closed().await;
            return Ok(());
        }
        self.inner.events.close();
        let runtime_result = self.inner.host.runtime.shutdown().await;
        let process_result = self.inner.host.process.close().await;
        self.inner.gate.finish();
        runtime_result.map_err(to_napi_error)?;
        process_result.map_err(to_napi_error)
    }
}
