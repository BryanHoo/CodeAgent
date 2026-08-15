use std::sync::Arc;

use code_agent_core::{PortRequestContext, ProviderPort};
use code_agent_protocol::Project;
use code_agent_provider_codex::{CodexRuntimeProvider, JsonlRpcClient, JsonlRpcClientOptions};
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, DuplexStream, duplex};

fn project() -> Project {
    serde_json::from_value(json!({
        "createdAt": "2026-08-12T00:00:00.000Z", "id": "project-1",
        "name": "Project", "rootPath": "/workspace"
    }))
    .expect("project")
}

fn runtime() -> (Arc<CodexRuntimeProvider>, DuplexStream) {
    let (client_stream, server_stream) = duplex(128 * 1024);
    let (read, write) = tokio::io::split(client_stream);
    let (client, incoming, _workers) =
        JsonlRpcClient::spawn(read, write, JsonlRpcClientOptions::default());
    (
        Arc::new(CodexRuntimeProvider::new(client, incoming)),
        server_stream,
    )
}

async fn read_frame(reader: &mut BufReader<tokio::io::ReadHalf<DuplexStream>>) -> Value {
    let mut line = String::new();
    tokio::time::timeout(
        std::time::Duration::from_secs(1),
        reader.read_line(&mut line),
    )
    .await
    .expect("frame timeout")
    .expect("read frame");
    serde_json::from_str(&line).expect("frame")
}

async fn recv_event(
    events: &mut tokio::sync::mpsc::Receiver<code_agent_protocol::ProviderEvent>,
    label: &str,
) -> code_agent_protocol::ProviderEvent {
    tokio::time::timeout(std::time::Duration::from_secs(1), events.recv())
        .await
        .unwrap_or_else(|_| panic!("{label} event timeout"))
        .unwrap_or_else(|| panic!("{label} event stream closed"))
}

async fn start_task(
    provider: &Arc<dyn code_agent_core::ProjectProviderPort>,
    server: DuplexStream,
) -> DuplexStream {
    let (read, mut write) = tokio::io::split(server);
    let mut read = BufReader::new(read);
    let response = tokio::spawn(async move {
        let request = read_frame(&mut read).await;
        write
            .write_all(
                format!(
                    "{}\n",
                    json!({ "id": request["id"], "result": { "thread": {
                        "createdAt": 1_754_956_800, "cwd": "/workspace", "id": "task-1",
                        "name": null, "preview": "Task", "section": null,
                        "updatedAt": 1_754_956_800
                    } } })
                )
                .as_bytes(),
            )
            .await
            .expect("response");
        read.into_inner().unsplit(write)
    });
    provider
        .start_task(json!({}), &PortRequestContext::new("start"))
        .await
        .expect("start task");
    response.await.expect("response task")
}

#[tokio::test]
async fn approval_resolution_should_use_nested_public_resolution_and_publish_terminal_once() {
    let (runtime, server) = runtime();
    let provider = runtime
        .for_project(project(), &PortRequestContext::new("project"))
        .await
        .expect("provider");
    let mut server = start_task(&provider, server).await;
    let mut events = provider
        .subscribe_events(false, &PortRequestContext::new("events"))
        .await
        .expect("events");
    server
        .write_all(format!("{}\n", approval_request()).as_bytes())
        .await
        .expect("request");
    let created = recv_event(&mut events, "created").await;
    let request_id = created.pending_request().expect("pending request")["requestId"]
        .as_str()
        .expect("request id")
        .to_owned();

    let resolve_context = PortRequestContext::new("resolve");
    let resolution = provider.resolve_pending_request(
        json!({
            "itemId": "command-1", "projectId": "project-1",
            "requestId": request_id, "resolution": { "decision": "allow_for_session" },
            "taskId": "task-1", "turnId": "turn-1", "type": "command_approval"
        }),
        &resolve_context,
    );
    let native = async {
        let (read, _write) = tokio::io::split(server);
        read_frame(&mut BufReader::new(read)).await
    };
    let (resolved, native) = tokio::join!(resolution, native);
    assert_eq!(native["result"], json!({ "decision": "acceptForSession" }));
    assert_eq!(resolved.expect("resolved")["status"], "resolved");
    assert_eq!(
        recv_event(&mut events, "terminal").await.event_type(),
        "pending_request.resolved"
    );
}

#[tokio::test]
async fn permission_resolution_should_return_only_selected_session_grants() {
    let (runtime, server) = runtime();
    let provider = runtime
        .for_project(project(), &PortRequestContext::new("project"))
        .await
        .expect("provider");
    let mut server = start_task(&provider, server).await;
    let mut events = provider
        .subscribe_events(false, &PortRequestContext::new("events"))
        .await
        .expect("events");
    server
        .write_all(format!("{}\n", permission_request()).as_bytes())
        .await
        .expect("request");
    let created = recv_event(&mut events, "created").await;
    let request_id = created.pending_request().expect("pending request")["requestId"]
        .as_str()
        .expect("request id")
        .to_owned();

    let input = json!({
        "itemId": "permission-1", "projectId": "project-1", "requestId": request_id,
        "resolution": {
            "permissions": {
                "fileSystem": {
                    "entries": [{
                        "access": "read",
                        "path": { "path": "/workspace/input", "type": "path" }
                    }],
                    "globScanMaxDepth": 3,
                    "read": null,
                    "write": null
                },
                "network": null
            },
            "scope": "session"
        },
        "taskId": "task-1", "turnId": "turn-1", "type": "permissions_approval"
    });
    let mut expanded = input.clone();
    expanded["resolution"]["permissions"]["fileSystem"]["entries"][0]["path"]["path"] =
        json!("/workspace/not-requested");
    let error = provider
        .resolve_pending_request(expanded, &PortRequestContext::new("reject-expanded"))
        .await
        .expect_err("expanded permission grant must fail");
    assert!(
        error
            .to_string()
            .contains("exceed the requested permissions")
    );

    let resolve_context = PortRequestContext::new("resolve");
    let resolution = provider.resolve_pending_request(input, &resolve_context);
    let native = async {
        let (read, _write) = tokio::io::split(server);
        read_frame(&mut BufReader::new(read)).await
    };
    let (resolved, native) = tokio::join!(resolution, native);
    assert_eq!(
        native["result"],
        json!({
            "permissions": {
                "fileSystem": {
                    "entries": [{
                        "access": "read",
                        "path": { "path": "/workspace/input", "type": "path" }
                    }],
                    "globScanMaxDepth": 3,
                    "read": null,
                    "write": null
                }
            },
            "scope": "session"
        })
    );
    assert_eq!(resolved.expect("resolved")["status"], "resolved");
}

#[tokio::test]
async fn identical_concurrent_resolution_should_reuse_one_native_response() {
    let (runtime, server) = runtime();
    let provider = runtime
        .for_project(project(), &PortRequestContext::new("project"))
        .await
        .expect("provider");
    let mut server = start_task(&provider, server).await;
    let mut events = provider
        .subscribe_events(false, &PortRequestContext::new("events"))
        .await
        .expect("events");
    server
        .write_all(format!("{}\n", approval_request()).as_bytes())
        .await
        .expect("request");
    let created = recv_event(&mut events, "created").await;
    let request_id = created.pending_request().expect("pending request")["requestId"]
        .as_str()
        .expect("request id");
    let input = json!({
        "itemId": "command-1", "projectId": "project-1", "requestId": request_id,
        "resolution": { "decision": "allow" }, "taskId": "task-1",
        "turnId": "turn-1", "type": "command_approval"
    });
    let left_context = PortRequestContext::new("left");
    let right_context = PortRequestContext::new("right");
    let left = provider.resolve_pending_request(input.clone(), &left_context);
    let right = provider.resolve_pending_request(input, &right_context);
    let (left, right) = tokio::join!(left, right);
    assert_eq!(left.expect("left")["status"], "resolved");
    assert_eq!(right.expect("right")["status"], "resolved");
    let (read, _write) = tokio::io::split(server);
    let mut read = BufReader::new(read);
    assert_eq!(read_frame(&mut read).await["result"]["decision"], "accept");
    let mut extra = String::new();
    assert!(
        tokio::time::timeout(
            std::time::Duration::from_millis(100),
            read.read_line(&mut extra)
        )
        .await
        .is_err()
    );
    assert_eq!(
        recv_event(&mut events, "terminal").await.event_type(),
        "pending_request.resolved"
    );
}

#[tokio::test]
async fn user_input_should_map_answers_and_redact_secret_message() {
    let (runtime, server) = runtime();
    let provider = runtime
        .for_project(project(), &PortRequestContext::new("project"))
        .await
        .expect("provider");
    let mut server = start_task(&provider, server).await;
    let mut events = provider
        .subscribe_events(false, &PortRequestContext::new("events"))
        .await
        .expect("events");
    server
        .write_all(format!("{}\n", user_input_request()).as_bytes())
        .await
        .expect("request");
    let created = recv_event(&mut events, "created").await;
    let request_id = created.pending_request().expect("pending request")["requestId"]
        .as_str()
        .expect("request id")
        .to_owned();
    let resolve_context = PortRequestContext::new("resolve");
    let resolution = provider.resolve_pending_request(
        json!({
            "itemId": "input-1", "projectId": "project-1", "requestId": request_id,
            "resolution": { "answers": { "mode": ["继续"], "token": ["top-secret"] } },
            "taskId": "task-1", "turnId": "turn-1", "type": "user_input"
        }),
        &resolve_context,
    );
    let native = async {
        let (read, _write) = tokio::io::split(server);
        read_frame(&mut BufReader::new(read)).await
    };
    let (resolved, native) = tokio::join!(resolution, native);
    resolved.expect("resolved");
    assert_eq!(
        native["result"]["answers"]["mode"]["answers"],
        json!(["继续"])
    );
    assert_eq!(
        recv_event(&mut events, "terminal").await.event_type(),
        "pending_request.resolved"
    );
    let answer = recv_event(&mut events, "answer").await;
    assert_eq!(answer.event_type(), "item.completed");
    assert_eq!(
        answer.item().expect("answer item")["text"],
        "- 模式: 继续\n- 密钥: ******"
    );
    assert!(
        !answer
            .to_value()
            .expect("serialize answer")
            .to_string()
            .contains("top-secret")
    );
}

#[tokio::test]
async fn native_resolved_should_expire_request_once() {
    let (runtime, server) = runtime();
    let provider = runtime
        .for_project(project(), &PortRequestContext::new("project"))
        .await
        .expect("provider");
    let mut server = start_task(&provider, server).await;
    let mut events = provider
        .subscribe_events(false, &PortRequestContext::new("events"))
        .await
        .expect("events");
    server
        .write_all(format!("{}\n", approval_request()).as_bytes())
        .await
        .expect("request");
    recv_event(&mut events, "created").await;
    let notification = json!({
        "method": "serverRequest/resolved",
        "params": { "requestId": 7, "threadId": "task-1" }
    });
    server
        .write_all(format!("{notification}\n{notification}\n").as_bytes())
        .await
        .expect("notifications");
    assert_eq!(
        recv_event(&mut events, "expired").await.event_type(),
        "pending_request.expired"
    );
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(100), events.recv())
            .await
            .is_err()
    );
}

#[tokio::test]
async fn user_input_should_auto_expire_and_answer_codex() {
    let (runtime, server) = runtime();
    let provider = runtime
        .for_project(project(), &PortRequestContext::new("project"))
        .await
        .expect("provider");
    let mut server = start_task(&provider, server).await;
    let mut events = provider
        .subscribe_events(false, &PortRequestContext::new("events"))
        .await
        .expect("events");
    let mut request = user_input_request();
    request["params"]["autoResolutionMs"] = json!(20);
    server
        .write_all(format!("{request}\n").as_bytes())
        .await
        .expect("request");
    recv_event(&mut events, "created").await;
    let (read, _write) = tokio::io::split(server);
    let native = read_frame(&mut BufReader::new(read)).await;
    assert_eq!(native["result"], json!({ "answers": {} }));
    assert_eq!(
        recv_event(&mut events, "expired").await.event_type(),
        "pending_request.expired"
    );
}

fn approval_request() -> Value {
    json!({
        "id": 7, "method": "item/commandExecution/requestApproval", "params": {
            "availableDecisions": ["accept", "acceptForSession", "decline"],
            "command": "pnpm check", "cwd": "/workspace", "itemId": "command-1",
            "networkApprovalContext": null, "reason": null,
            "startedAtMs": 1_754_956_802_000_i64, "threadId": "task-1", "turnId": "turn-1"
        }
    })
}

fn permission_request() -> Value {
    json!({
        "id": 11, "method": "item/permissions/requestApproval", "params": {
            "cwd": "/workspace", "environmentId": "local", "itemId": "permission-1",
            "permissions": {
                "fileSystem": {
                    "entries": [
                        {
                            "access": "read",
                            "path": { "path": "/workspace/input", "type": "path" }
                        },
                        {
                            "access": "write",
                            "path": { "pattern": "/tmp/code-agent-*", "type": "glob_pattern" }
                        }
                    ],
                    "globScanMaxDepth": 3,
                    "read": null,
                    "write": null
                },
                "network": { "enabled": true }
            },
            "reason": "需要额外权限", "startedAtMs": 1_754_956_802_000_i64,
            "threadId": "task-1", "turnId": "turn-1"
        }
    })
}

fn user_input_request() -> Value {
    json!({
        "id": "input-native-1", "method": "item/tool/requestUserInput", "params": {
            "autoResolutionMs": null, "isBlocking": true, "itemId": "input-1",
            "questions": [{
                "header": "模式", "id": "mode", "isOther": false, "isSecret": false,
                "options": [{ "description": "继续实现", "label": "继续" }],
                "question": "下一步怎么处理？"
            }, {
                "header": "密钥", "id": "token", "isOther": false, "isSecret": true,
                "options": null, "question": "请输入密钥"
            }],
            "threadId": "task-1", "turnId": "turn-1"
        }
    })
}
