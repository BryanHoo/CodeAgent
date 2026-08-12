use std::sync::Arc;
use std::time::Duration;

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
    .expect("valid project")
}

fn runtime() -> (Arc<CodexRuntimeProvider>, DuplexStream) {
    let (client_stream, server_stream) = duplex(256 * 1024);
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
    reader.read_line(&mut line).await.expect("read frame");
    serde_json::from_str(&line).expect("valid frame")
}

async fn respond(writer: &mut tokio::io::WriteHalf<DuplexStream>, request: &Value, result: Value) {
    writer
        .write_all(format!("{}\n", json!({ "id": request["id"], "result": result })).as_bytes())
        .await
        .expect("write response");
}

fn native_thread() -> Value {
    json!({
        "createdAt": 1_754_956_800, "cwd": "/workspace", "id": "task-1",
        "name": null, "preview": "新任务", "section": null, "updatedAt": 1_754_956_800
    })
}

fn native_model(id: &str, hidden: bool) -> Value {
    json!({
        "defaultReasoningEffort": "high", "description": id, "displayName": id,
        "hidden": hidden, "isDefault": id == "model-a", "model": id,
        "supportedReasoningEfforts": [{ "description": "深入", "reasoningEffort": "high" }]
    })
}

#[tokio::test]
async fn model_catalog_should_merge_all_pages_and_reject_repeated_cursor() {
    let (runtime_one, server) = runtime();
    let (read, mut write) = tokio::io::split(server);
    let mut read = BufReader::new(read);
    let scenario = tokio::spawn(async move {
        let first = read_frame(&mut read).await;
        assert_eq!(
            first["params"],
            json!({ "includeHidden": false, "limit": 100 })
        );
        respond(
            &mut write,
            &first,
            json!({
                "data": [native_model("model-a", false), native_model("hidden", true)],
                "nextCursor": "page-2"
            }),
        )
        .await;
        let second = read_frame(&mut read).await;
        assert_eq!(second["params"]["cursor"], "page-2");
        respond(
            &mut write,
            &second,
            json!({
                "data": [native_model("model-b", false)], "nextCursor": null
            }),
        )
        .await;
    });
    let page = runtime_one
        .models(&PortRequestContext::new("models"))
        .await
        .expect("models");
    let page = serde_json::to_value(page).expect("model page");
    assert_eq!(page["data"].as_array().map(Vec::len), Some(2));
    assert_eq!(page["data"][1]["id"], "model-b");
    scenario.await.expect("scenario");

    let (runtime_two, server) = runtime();
    let (read, mut write) = tokio::io::split(server);
    let mut read = BufReader::new(read);
    let scenario = tokio::spawn(async move {
        for _ in 0..2 {
            let request = read_frame(&mut read).await;
            respond(
                &mut write,
                &request,
                json!({ "data": [], "nextCursor": "same" }),
            )
            .await;
        }
    });
    let error = runtime_two
        .models(&PortRequestContext::new("models"))
        .await
        .expect_err("cursor error");
    assert!(error.to_string().contains("repeated cursor"));
    scenario.await.expect("scenario");
}

#[tokio::test]
async fn mcp_contract_should_page_merge_deduplicate_and_redact_startup_failure() {
    let (runtime, server) = runtime();
    let provider = runtime
        .for_project(project(), &PortRequestContext::new("project"))
        .await
        .expect("provider");
    let (read, mut write) = tokio::io::split(server);
    let mut read = BufReader::new(read);
    let scenario = tokio::spawn(async move {
        let start = read_frame(&mut read).await;
        respond(&mut write, &start, json!({ "thread": native_thread() })).await;
        (read, write)
    });
    provider
        .start_task(json!({}), &PortRequestContext::new("start"))
        .await
        .expect("task");
    let (read, write) = scenario.await.expect("scenario");
    let mut server = read.into_inner().unsplit(write);
    let mut events = provider
        .subscribe_events(false, &PortRequestContext::new("events"))
        .await
        .expect("events");
    server.write_all(format!("{}\n", json!({
        "method": "mcpServer/startupStatus/updated",
        "params": { "error": "OAuth https://auth.example API_TOKEN=secret", "failureReason": "reauthenticationRequired",
            "name": "docs", "status": "failed", "threadId": "task-1" }
    })).as_bytes()).await.expect("notification");
    let event = tokio::time::timeout(Duration::from_secs(1), events.recv())
        .await
        .expect("timeout")
        .expect("event");
    assert_eq!(event.event_type(), "mcp_server.status_updated");
    assert_eq!(
        event.as_value()["payload"]["error"],
        "OAuth [URL redacted] API_TOKEN=[REDACTED]"
    );

    let (read, mut write) = tokio::io::split(server);
    let mut read = BufReader::new(read);
    let mcp_context = PortRequestContext::new("mcp");
    let list = provider.list_mcp_servers("task-1", &mcp_context);
    let responses = async {
        let first = read_frame(&mut read).await;
        assert_eq!(first["params"]["detail"], "toolsAndAuthOnly");
        respond(&mut write, &first, json!({
            "data": [{ "authStatus": "unsupported", "name": "playwright", "serverInfo": null, "tools": { "open": {} } }],
            "nextCursor": "page-2"
        })).await;
        let second = read_frame(&mut read).await;
        respond(&mut write, &second, json!({
            "data": [{ "authStatus": "unknown", "name": "playwright", "serverInfo": null, "tools": {} }],
            "nextCursor": null
        })).await;
    };
    let (page, _) = tokio::join!(list, responses);
    let page = serde_json::to_value(page.expect("MCP page")).expect("serialize MCP page");
    assert_eq!(page["data"].as_array().map(Vec::len), Some(2));
    assert_eq!(page["data"][0]["name"], "docs");
    assert_eq!(page["data"][1]["toolCount"], 1);
}

#[tokio::test]
async fn unsubscribe_should_return_busy_for_running_turn_or_background_terminal() {
    let (runtime, server) = runtime();
    let provider = runtime
        .for_project(project(), &PortRequestContext::new("project"))
        .await
        .expect("provider");
    let (read, mut write) = tokio::io::split(server);
    let mut read = BufReader::new(read);
    let scenario = tokio::spawn(async move {
        let start = read_frame(&mut read).await;
        respond(&mut write, &start, json!({ "thread": native_thread() })).await;
        let turn = read_frame(&mut read).await;
        respond(
            &mut write,
            &turn,
            json!({ "turn": {
            "completedAt": null, "error": null, "id": "turn-1", "items": [],
            "startedAt": 1_754_956_801, "status": "inProgress"
        } }),
        )
        .await;
        (read, write)
    });
    provider
        .start_task(json!({}), &PortRequestContext::new("start"))
        .await
        .expect("task");
    provider
        .start_turn(
            "task-1",
            json!({ "input": [{ "text": "work", "text_elements": [], "type": "text" }] }),
            &PortRequestContext::new("turn"),
        )
        .await
        .expect("turn");
    assert_eq!(
        provider
            .unsubscribe_task("task-1", &PortRequestContext::new("unsubscribe"))
            .await
            .expect("status"),
        "busy"
    );
    scenario.await.expect("scenario");
}

#[tokio::test]
async fn event_overflow_should_emit_terminal_error_and_close_subscription() {
    let (runtime, server) = runtime();
    let provider = runtime
        .for_project(project(), &PortRequestContext::new("project"))
        .await
        .expect("provider");
    let (read, mut write) = tokio::io::split(server);
    let mut read = BufReader::new(read);
    let start = tokio::spawn(async move {
        let request = read_frame(&mut read).await;
        respond(&mut write, &request, json!({ "thread": native_thread() })).await;
        (read, write)
    });
    provider
        .start_task(json!({}), &PortRequestContext::new("start"))
        .await
        .expect("task");
    let (read, write) = start.await.expect("scenario");
    let mut server = read.into_inner().unsplit(write);
    let mut events = provider
        .subscribe_events(false, &PortRequestContext::new("events"))
        .await
        .expect("events");
    for index in 0..257 {
        server.write_all(format!("{}\n", json!({
            "method": "item/agentMessage/delta",
            "params": { "delta": "x", "itemId": format!("item-{index}"), "threadId": "task-1", "turnId": "turn-1" }
        })).as_bytes()).await.expect("notification");
    }
    tokio::time::sleep(Duration::from_millis(100)).await;
    let mut last = None;
    while let Ok(Some(event)) = tokio::time::timeout(Duration::from_secs(1), events.recv()).await {
        last = Some(event);
    }
    let last = last.expect("overflow event");
    assert_eq!(last.event_type(), "provider.error");
    assert_eq!(
        last.as_value()["payload"]["message"],
        "Provider event subscription overflowed"
    );
}

#[tokio::test]
async fn login_notifications_should_update_pending_connection_state() {
    let (runtime, server) = runtime();
    let (read, mut write) = tokio::io::split(server);
    let mut read = BufReader::new(read);
    let scenario = tokio::spawn(async move {
        let config = read_frame(&mut read).await;
        respond(&mut write, &config, json!({})).await;
        let login = read_frame(&mut read).await;
        respond(
            &mut write,
            &login,
            json!({
                "authUrl": "https://auth.example/login", "loginId": "login-1", "type": "chatgpt"
            }),
        )
        .await;
        for _ in 0..2 {
            let request = read_frame(&mut read).await;
            let result = if request["method"] == "config/read" {
                json!({ "config": { "model_provider": "openai" } })
            } else {
                json!({ "account": null, "requiresOpenaiAuth": true })
            };
            respond(&mut write, &request, result).await;
        }
        write.write_all(format!("{}\n", json!({
            "method": "account/login/completed",
            "params": { "error": "browser login expired", "loginId": "login-1", "success": false }
        })).as_bytes()).await.expect("login notification");
        (read, write)
    });
    let started = runtime
        .start_official_login(&PortRequestContext::new("login"))
        .await
        .expect("login");
    assert!(matches!(
        started["status"]["state"].as_str(),
        Some("pending" | "failed")
    ));
    let (read, mut write) = scenario.await.expect("scenario");
    let mut read = read;
    tokio::time::sleep(Duration::from_millis(20)).await;
    let status_context = PortRequestContext::new("status");
    let status = runtime.connection_status(&status_context);
    let responses = async {
        for _ in 0..2 {
            let request = read_frame(&mut read).await;
            let result = if request["method"] == "config/read" {
                json!({ "config": { "model_provider": "openai" } })
            } else {
                json!({ "account": null, "requiresOpenaiAuth": true })
            };
            respond(&mut write, &request, result).await;
        }
    };
    let (status, _) = tokio::join!(status, responses);
    let status = status.expect("status");
    assert_eq!(status["state"], "failed");
    assert_eq!(status["pendingLogin"]["error"], "browser login expired");
}

#[tokio::test]
async fn background_terminals_should_merge_pages_and_missing_thread_should_be_empty() {
    let (runtime, server) = runtime();
    let provider = runtime
        .for_project(project(), &PortRequestContext::new("project"))
        .await
        .expect("provider");
    let (read, mut write) = tokio::io::split(server);
    let mut read = BufReader::new(read);
    let scenario = tokio::spawn(async move {
        let start = read_frame(&mut read).await;
        respond(&mut write, &start, json!({ "thread": native_thread() })).await;
        let first = read_frame(&mut read).await;
        respond(&mut write, &first, json!({
            "data": [{ "command": "pnpm dev", "cwd": "/workspace", "itemId": "item-1", "processId": "process-1" }],
            "nextCursor": "page-2"
        })).await;
        let second = read_frame(&mut read).await;
        assert_eq!(second["params"]["cursor"], "page-2");
        respond(&mut write, &second, json!({
            "data": [{ "command": "cargo test", "cwd": "/workspace", "itemId": "item-2", "processId": "process-2" }],
            "nextCursor": null
        })).await;
        let missing = read_frame(&mut read).await;
        write.write_all(format!("{}\n", json!({
            "error": { "code": -32600, "data": null, "message": "thread not found: task-1" },
            "id": missing["id"]
        })).as_bytes()).await.expect("missing response");
    });
    provider
        .start_task(json!({}), &PortRequestContext::new("start"))
        .await
        .expect("task");
    let page = provider
        .list_background_terminals("task-1", &PortRequestContext::new("terminals"))
        .await
        .expect("terminals");
    let page = serde_json::to_value(page).expect("page");
    assert_eq!(page["data"].as_array().map(Vec::len), Some(2));
    assert_eq!(page["data"][0]["id"], "process-1");
    let missing = provider
        .list_background_terminals("task-1", &PortRequestContext::new("missing"))
        .await
        .expect("empty page");
    assert!(missing.data.is_empty());
    scenario.await.expect("scenario");
}
