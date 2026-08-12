//! Codex 原生协议到 CodeAgent 公共领域协议的纯映射层。

mod common;
mod events;
mod items;
mod server_requests;
mod turns;

pub use common::{
    CODEX_IGNORED_NOTIFICATION_METHODS, CODEX_MAPPED_NOTIFICATION_METHODS,
    CODEX_SPECIAL_NOTIFICATION_METHODS, CodexMappingError, MAX_COMMAND_OUTPUT_BYTES,
    MAX_COMMAND_OUTPUT_LINES,
};
pub use events::map_codex_notification;
pub use items::map_codex_item;
pub(crate) use server_requests::request_id_key;
pub use server_requests::{PendingCodexRequest, map_codex_server_request};
pub use turns::{map_codex_turn, map_context_usage};
