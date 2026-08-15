//! JSONL RPC 客户端行为测试：关联、超时、重试、畸形帧与关闭语义。

use std::time::Duration;

use code_agent_provider_codex::{
    JsonlRpcClient, JsonlRpcClientOptions, OverloadRetryPolicy, RpcClientError, RpcIncoming,
};
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, DuplexStream, ReadHalf, WriteHalf};

struct FakePeer {
    reader: BufReader<ReadHalf<DuplexStream>>,
    writer: WriteHalf<DuplexStream>,
}

impl FakePeer {
    async fn read_frame(&mut self) -> Value {
        let mut line = String::new();
        let read = self
            .reader
            .read_line(&mut line)
            .await
            .expect("read frame from client");
        assert!(read > 0, "client closed output unexpectedly");
        serde_json::from_str(&line).expect("client frame must be JSON")
    }

    async fn write_line(&mut self, line: &str) {
        self.writer
            .write_all(line.as_bytes())
            .await
            .expect("write frame to client");
        self.writer.flush().await.expect("flush frame to client");
    }

    async fn write_frame(&mut self, value: &Value) {
        let mut frame = serde_json::to_string(value).expect("serialize frame");
        frame.push('\n');
        self.write_line(&frame).await;
    }
}

fn fast_retry_policy() -> OverloadRetryPolicy {
    OverloadRetryPolicy {
        base_delay: Duration::from_millis(1),
        max_delay: Duration::from_millis(4),
        max_elapsed: Duration::from_millis(500),
        max_retries: 4,
    }
}

fn connect(options: JsonlRpcClientOptions) -> (JsonlRpcClient, RpcIncoming, FakePeer) {
    let (client_io, server_io) = tokio::io::duplex(256 * 1024);
    let (client_read, client_write) = tokio::io::split(client_io);
    let (server_read, server_write) = tokio::io::split(server_io);
    let (client, incoming, _workers) = JsonlRpcClient::spawn(client_read, client_write, options);
    (
        client,
        incoming,
        FakePeer {
            reader: BufReader::new(server_read),
            writer: server_write,
        },
    )
}

#[tokio::test]
async fn request_should_resolve_out_of_order_responses() {
    let (client, _incoming, mut peer) = connect(JsonlRpcClientOptions::default());

    let first = client.request("alpha", None);
    let second = client.request("beta", Some(json!({ "value": 2 })));
    let ((first_result, second_result), ()) =
        tokio::join!(async { tokio::join!(first, second) }, async {
            let frame_one = peer.read_frame().await;
            let frame_two = peer.read_frame().await;
            assert_eq!(frame_one["method"], "alpha");
            assert_eq!(frame_two["method"], "beta");
            assert_eq!(frame_two["params"], json!({ "value": 2 }));
            // 故意乱序响应，验证按 id 关联。
            peer.write_frame(&json!({ "id": frame_two["id"], "result": { "from": "beta" } }))
                .await;
            peer.write_frame(&json!({ "id": frame_one["id"], "result": { "from": "alpha" } }))
                .await;
        });

    assert_eq!(
        first_result.expect("alpha resolves"),
        json!({ "from": "alpha" })
    );
    assert_eq!(
        second_result.expect("beta resolves"),
        json!({ "from": "beta" })
    );
}

#[tokio::test]
async fn notifications_and_server_requests_should_dispatch() {
    let (client, mut incoming, mut peer) = connect(JsonlRpcClientOptions::default());

    peer.write_frame(&json!({ "method": "turn/started", "params": { "turnId": "t-1" } }))
        .await;
    let notification = incoming
        .notifications
        .recv()
        .await
        .expect("notification delivered");
    assert_eq!(notification.method, "turn/started");
    assert_eq!(notification.params, json!({ "turnId": "t-1" }));

    peer.write_frame(&json!({
        "id": "approval-1",
        "method": "item/commandExecution/requestApproval",
        "params": { "command": "ls" }
    }))
    .await;
    let request = incoming
        .server_requests
        .recv()
        .await
        .expect("server request delivered");
    assert_eq!(request.method, "item/commandExecution/requestApproval");
    assert_eq!(request.id, json!("approval-1"));

    client
        .respond_to_server_request(request.id.clone(), json!({ "decision": "accept" }))
        .await
        .expect("respond to server request");
    let reply = peer.read_frame().await;
    assert_eq!(reply["id"], json!("approval-1"));
    assert_eq!(reply["result"], json!({ "decision": "accept" }));

    client
        .reject_server_request(json!(7), -32601, "unknown method")
        .await
        .expect("reject server request");
    let rejection = peer.read_frame().await;
    assert_eq!(rejection["id"], json!(7));
    assert_eq!(rejection["error"]["code"], json!(-32601));
}

#[tokio::test]
async fn request_should_time_out_and_release_pending() {
    let (client, _incoming, mut peer) = connect(JsonlRpcClientOptions::default());

    let error = client
        .request_with_timeout("slow", None, Duration::from_millis(40))
        .await
        .expect_err("request must time out");
    assert!(matches!(error, RpcClientError::Timeout { .. }));

    // 迟到的响应必须被安全忽略，客户端保持可用。
    let frame = peer.read_frame().await;
    peer.write_frame(&json!({ "id": frame["id"], "result": {} }))
        .await;
    let follow_up = client.request("follow-up", None);
    let ((), result) = tokio::join!(
        async {
            let frame = peer.read_frame().await;
            peer.write_frame(&json!({ "id": frame["id"], "result": { "ok": true } }))
                .await;
        },
        follow_up
    );
    assert_eq!(result.expect("follow-up resolves"), json!({ "ok": true }));
}

#[tokio::test]
async fn overload_should_retry_same_request_until_success() {
    let (client, _incoming, mut peer) = connect(JsonlRpcClientOptions {
        overload_retry: fast_retry_policy(),
        ..JsonlRpcClientOptions::default()
    });

    let request = client.request("busy", Some(json!({ "seq": 1 })));
    let ((), result) = tokio::join!(
        async {
            let first = peer.read_frame().await;
            peer.write_frame(&json!({
                "id": first["id"],
                "error": { "code": -32001, "message": "overloaded", "data": { "retry": true } }
            }))
            .await;
            let second = peer.read_frame().await;
            // 重试必须复用同一 id 与同一参数。
            assert_eq!(second["id"], first["id"]);
            assert_eq!(second["method"], "busy");
            assert_eq!(second["params"], json!({ "seq": 1 }));
            peer.write_frame(&json!({ "id": second["id"], "result": { "ok": true } }))
                .await;
        },
        request
    );

    assert_eq!(
        result.expect("retried request resolves"),
        json!({ "ok": true })
    );
}

#[tokio::test]
async fn overload_should_fail_after_retry_budget() {
    let (client, _incoming, mut peer) = connect(JsonlRpcClientOptions {
        overload_retry: OverloadRetryPolicy {
            max_retries: 1,
            ..fast_retry_policy()
        },
        ..JsonlRpcClientOptions::default()
    });

    let request = client.request("busy", None);
    let ((), result) = tokio::join!(
        async {
            for _ in 0..2 {
                let frame = peer.read_frame().await;
                peer.write_frame(&json!({
                    "id": frame["id"],
                    "error": { "code": -32001, "message": "overloaded", "data": { "retry": true } }
                }))
                .await;
            }
        },
        request
    );

    let error = result.expect_err("retry budget must be enforced");
    assert!(matches!(
        error,
        RpcClientError::Response { code: -32001, .. }
    ));
}

#[tokio::test]
async fn non_retryable_error_should_reject_immediately() {
    let (client, _incoming, mut peer) = connect(JsonlRpcClientOptions::default());

    let request = client.request("bad", None);
    let ((), result) = tokio::join!(
        async {
            let frame = peer.read_frame().await;
            peer.write_frame(&json!({
                "id": frame["id"],
                "error": { "code": -32602, "message": "invalid params" }
            }))
            .await;
        },
        request
    );

    let error = result.expect_err("error response rejects request");
    match error {
        RpcClientError::Response { code, message, .. } => {
            assert_eq!(code, -32602);
            assert_eq!(message, "invalid params");
        }
        other => panic!("unexpected error variant: {other:?}"),
    }
}

#[tokio::test]
async fn malformed_frame_should_fail_pending_and_close_client() {
    let (client, mut incoming, mut peer) = connect(JsonlRpcClientOptions::default());

    let request = client.request("pending", None);
    let ((), result) = tokio::join!(
        async {
            let _ = peer.read_frame().await;
            peer.write_line("not-json\n").await;
        },
        request
    );

    let error = result.expect_err("malformed frame rejects pending request");
    assert!(matches!(error, RpcClientError::Protocol(_)));
    let emitted = incoming.errors.recv().await.expect("error event emitted");
    assert!(matches!(emitted, RpcClientError::Protocol(_)));
    assert!(client.is_closed());
    let follow_up = client.request("after-close", None).await;
    assert!(matches!(
        follow_up,
        Err(RpcClientError::ConnectionClosed(_))
    ));
}

#[tokio::test]
async fn oversized_frame_should_fail_with_protocol_error() {
    let (client, _incoming, mut peer) = connect(JsonlRpcClientOptions {
        max_frame_bytes: 64,
        max_buffer_bytes: 64,
        ..JsonlRpcClientOptions::default()
    });

    let request = client.request("pending", None);
    let ((), result) = tokio::join!(
        async {
            let _ = peer.read_frame().await;
            let oversized = format!("{}\n", "x".repeat(128));
            peer.write_line(&oversized).await;
        },
        request
    );

    assert!(matches!(
        result.expect_err("oversized frame must fail"),
        RpcClientError::Protocol(_)
    ));
    assert!(client.is_closed());
}

#[tokio::test]
async fn crlf_and_cross_chunk_frames_should_parse() {
    let (client, _incoming, mut peer) = connect(JsonlRpcClientOptions::default());

    let request = client.request("chunked", None);
    let ((), result) = tokio::join!(
        async {
            let frame = peer.read_frame().await;
            let response = format!("{{\"id\":{},\"result\":{{\"ok\":true}}}}\r\n", frame["id"]);
            let (head, tail) = response.split_at(9);
            peer.write_line(head).await;
            tokio::time::sleep(Duration::from_millis(10)).await;
            peer.write_line(tail).await;
        },
        request
    );

    assert_eq!(
        result.expect("chunked response resolves"),
        json!({ "ok": true })
    );
}

#[tokio::test]
async fn input_end_with_partial_frame_should_error() {
    let (client, mut incoming, mut peer) = connect(JsonlRpcClientOptions::default());

    let request = client.request("pending", None);
    let ((), result) = tokio::join!(
        async {
            let _ = peer.read_frame().await;
            peer.write_line("{\"incomplete\":").await;
            drop(peer);
        },
        request
    );

    assert!(matches!(
        result.expect_err("incomplete trailing frame must fail"),
        RpcClientError::Protocol(_)
    ));
    assert!(matches!(
        incoming.errors.recv().await,
        Some(RpcClientError::Protocol(_))
    ));
}

#[tokio::test]
async fn clean_input_end_should_close_connection() {
    let (client, _incoming, mut peer) = connect(JsonlRpcClientOptions::default());

    let request = client.request("pending", None);
    let ((), result) = tokio::join!(
        async {
            let _ = peer.read_frame().await;
            drop(peer);
        },
        request
    );

    assert!(matches!(
        result.expect_err("input end rejects pending request"),
        RpcClientError::ConnectionClosed(_)
    ));
    assert!(client.is_closed());
}
