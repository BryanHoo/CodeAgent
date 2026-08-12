//! Codex App Server Provider 适配边界。

mod binary;
mod connection;
mod mapping;
mod process;
mod project_provider;
mod provider;
mod rpc;

pub use binary::{
    CodexBinary, CodexBinarySource, CodexVersionInfo, LocateCodexBinaryOptions,
    SUPPORTED_CODEX_VERSION, check_codex_version, locate_codex_binary,
};
pub use mapping::{
    CODEX_IGNORED_NOTIFICATION_METHODS, CODEX_MAPPED_NOTIFICATION_METHODS,
    CODEX_SPECIAL_NOTIFICATION_METHODS, CodexMappingError, MAX_COMMAND_OUTPUT_BYTES,
    MAX_COMMAND_OUTPUT_LINES, PendingCodexRequest, map_codex_item, map_codex_notification,
    map_codex_server_request, map_codex_turn, map_context_usage,
};
pub use process::{
    CodexAppServerOptions, CodexAppServerProcess, CodexProcessExit, rpc_error_to_code_agent_error,
    start_codex_app_server,
};
pub use provider::CodexRuntimeProvider;
pub use rpc::{
    DEFAULT_MAX_JSONL_BYTES, JsonlRpcClient, JsonlRpcClientOptions, OverloadRetryPolicy,
    RpcClientError, RpcIncoming, RpcNotification, RpcServerRequest, RpcWorkers,
};
