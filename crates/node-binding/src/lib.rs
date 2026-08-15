//! Node N-API Delivery 适配边界。

mod composition;
mod engine;
mod errors;
mod events;
mod operations;
mod types;

use napi_derive::napi;

pub use engine::NodeEngine;
pub use types::{NodeEngineDiagnostic, NodeEngineOptions, NodeProcessExit};

/// 返回 native addon 与 npm 产品保持一致的版本。
#[napi]
#[must_use]
pub fn addon_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}
