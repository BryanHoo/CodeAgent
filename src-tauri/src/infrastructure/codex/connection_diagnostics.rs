use std::{collections::BTreeMap, time::Duration};

use serde_json::{Value, json};

use super::connection::ConnectionError;
use crate::infrastructure::diagnostics::{self, DiagnosticLevel};

type RpcDiagnostic = (
    DiagnosticLevel,
    &'static str,
    Option<String>,
    BTreeMap<String, Value>,
);

pub(super) fn record_rpc_result<T>(
    method: &str,
    result: &Result<T, ConnectionError>,
    elapsed: Duration,
    retry_count: u32,
) {
    if let Some((level, event, message, context)) =
        rpc_diagnostic(method, result.as_ref().err(), elapsed, retry_count)
    {
        diagnostics::record(level, event, message, context);
    }
}

fn rpc_diagnostic(
    method: &str,
    error: Option<&ConnectionError>,
    elapsed: Duration,
    retry_count: u32,
) -> Option<RpcDiagnostic> {
    // 高频读取成功不落盘；只保留关键操作、重试恢复和所有最终失败。
    let key_operation = matches!(
        method,
        "initialize"
            | "thread/start"
            | "thread/resume"
            | "thread/fork"
            | "thread/archive"
            | "turn/start"
            | "turn/interrupt"
            | "turn/steer"
    );
    if error.is_none() && retry_count == 0 && !key_operation {
        return None;
    }
    let mut context = BTreeMap::from([
        ("rpcMethod".to_owned(), json!(method)),
        (
            "elapsedMs".to_owned(),
            json!(elapsed.as_millis().min(u64::MAX as u128) as u64),
        ),
        ("retryCount".to_owned(), json!(retry_count)),
    ]);
    if let Some(error) = error {
        let kind = match error {
            ConnectionError::Json(_) => "json",
            ConnectionError::Write(_) => "write",
            ConnectionError::Request { code, .. } => {
                context.insert("rpcCode".to_owned(), json!(code));
                "rpc"
            }
            ConnectionError::ConnectionClosed => "connection_closed",
            ConnectionError::InvalidMessage => "invalid_message",
            ConnectionError::Timeout => "timeout",
            ConnectionError::StateUnavailable => "state_unavailable",
        };
        context.insert("errorKind".to_owned(), json!(kind));
        let message = match error {
            ConnectionError::Request { message, .. } => message.clone(),
            _ => error.to_string(),
        };
        return Some((
            DiagnosticLevel::Error,
            "codex_rpc_request_failed",
            Some(message),
            context,
        ));
    }
    let event = if retry_count > 0 {
        "codex_rpc_request_recovered"
    } else {
        "codex_rpc_request_completed"
    };
    Some((DiagnosticLevel::Info, event, None, context))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rpc_error_preserves_protocol_details() {
        let error = ConnectionError::Request {
            code: -32600,
            message: "invalid value: expected TOML value".to_owned(),
        };
        let (_, _, message, context) =
            rpc_diagnostic("config/batchWrite", Some(&error), Duration::ZERO, 0).unwrap();
        assert_eq!(context["rpcCode"], json!(-32600));
        assert_eq!(context["rpcMethod"], json!("config/batchWrite"));
        assert_eq!(
            message.as_deref(),
            Some("invalid value: expected TOML value")
        );
    }

    #[test]
    fn rpc_diagnostics_cover_transport_errors_and_timing() {
        for error in [
            ConnectionError::Timeout,
            ConnectionError::ConnectionClosed,
            ConnectionError::InvalidMessage,
            ConnectionError::StateUnavailable,
            ConnectionError::Write(std::io::Error::other("broken pipe")),
        ] {
            let (level, event, message, context) =
                rpc_diagnostic("turn/start", Some(&error), Duration::from_millis(150), 2).unwrap();
            assert_eq!(level, DiagnosticLevel::Error);
            assert_eq!(event, "codex_rpc_request_failed");
            assert_eq!(message, Some(error.to_string()));
            assert_eq!(context["elapsedMs"], json!(150));
            assert_eq!(context["retryCount"], json!(2));
            assert!(context.contains_key("errorKind"));
        }
    }

    #[test]
    fn rpc_diagnostics_keep_key_operations_and_recovery_without_read_noise() {
        assert!(rpc_diagnostic("thread/read", None, Duration::from_millis(20), 0).is_none());
        for method in [
            "initialize",
            "thread/start",
            "thread/resume",
            "turn/start",
            "turn/interrupt",
        ] {
            assert_eq!(
                rpc_diagnostic(method, None, Duration::from_millis(20), 0)
                    .unwrap()
                    .0,
                DiagnosticLevel::Info
            );
        }
        assert_eq!(
            rpc_diagnostic("thread/read", None, Duration::from_millis(20), 1)
                .unwrap()
                .1,
            "codex_rpc_request_recovered"
        );
    }
}
