use std::sync::Arc;

use code_agent_core::{PortRequestContext, ProviderPort};
use code_agent_protocol::{AgentProviderConnectionStatus, Project};
use code_agent_provider_codex::{CodexRuntimeProvider, JsonlRpcClient, JsonlRpcClientOptions};
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, DuplexStream, duplex};

fn project() -> Project {
    serde_json::from_value(json!({
        "createdAt": "2026-08-12T00:00:00.000Z",
        "id": "project-1",
        "name": "Project",
        "rootPath": "/workspace"
    }))
    .expect("valid project")
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
    reader.read_line(&mut line).await.expect("read frame");
    serde_json::from_str(&line).expect("valid frame")
}

async fn respond(writer: &mut tokio::io::WriteHalf<DuplexStream>, request: &Value, result: Value) {
    writer
        .write_all(format!("{}\n", json!({ "id": request["id"], "result": result })).as_bytes())
        .await
        .expect("write response");
}

#[tokio::test]
async fn provider_connection_status_should_match_the_shared_protocol() {
    let (runtime, server) = runtime();
    let (read, mut write) = tokio::io::split(server);
    let mut read = BufReader::new(read);
    let scenario = tokio::spawn(async move {
        for _ in 0..2 {
            let request = read_frame(&mut read).await;
            match request["method"].as_str() {
                Some("config/read") => {
                    respond(
                        &mut write,
                        &request,
                        json!({ "config": { "model_provider": "openai" } }),
                    )
                    .await;
                }
                Some("account/read") => {
                    respond(
                        &mut write,
                        &request,
                        json!({
                            "account": {
                                "email": "developer@example.com",
                                "planType": "plus",
                                "type": "chatgpt"
                            },
                            "requiresOpenaiAuth": true
                        }),
                    )
                    .await;
                }
                method => panic!("unexpected request: {method:?}"),
            }
        }
    });

    let status = runtime
        .connection_status(&PortRequestContext::new("connection"))
        .await
        .expect("connection status");
    let parsed: AgentProviderConnectionStatus =
        serde_json::from_value(status.clone()).expect("shared provider connection contract");

    assert_eq!(
        status,
        json!({
            "account": {
                "email": "developer@example.com",
                "planType": "plus",
                "type": "chatgpt"
            },
            "customBaseUrl": null,
            "mode": "official",
            "pendingLogin": null,
            "state": "connected"
        })
    );
    assert_eq!(parsed.state.to_string(), "connected");
    scenario.await.expect("scenario");
}

#[tokio::test]
async fn project_provider_should_map_grouped_codex_skills_to_shared_protocol() {
    let (runtime, server) = runtime();
    let provider = runtime
        .for_project(project(), &PortRequestContext::new("project"))
        .await
        .expect("project provider");
    let (read, mut write) = tokio::io::split(server);
    let mut read = BufReader::new(read);
    let scenario = tokio::spawn(async move {
        let request = read_frame(&mut read).await;
        assert_eq!(request["method"], "skills/list");
        respond(
            &mut write,
            &request,
            json!({
                "data": [{
                    "cwd": "/workspace",
                    "errors": [],
                    "skills": [{
                        "description": "Fallback description",
                        "enabled": true,
                        "interface": {
                            "displayName": "Frontend Design",
                            "shortDescription": "Design polished interfaces"
                        },
                        "name": "frontend-design",
                        "path": "/workspace/.agents/skills/frontend-design/SKILL.md",
                        "scope": "repo",
                        "shortDescription": "Short description"
                    }, {
                        "description": "Disabled skill",
                        "enabled": false,
                        "interface": null,
                        "name": "disabled-skill",
                        "path": "/workspace/.agents/skills/disabled-skill/SKILL.md",
                        "scope": "repo",
                        "shortDescription": null
                    }]
                }]
            }),
        )
        .await;
    });

    let page = provider
        .list_skills(&PortRequestContext::new("skills"))
        .await
        .expect("mapped skills");
    let page = serde_json::to_value(page).expect("serialized skill page");

    assert_eq!(page["nextCursor"], Value::Null);
    assert_eq!(page["data"].as_array().map(Vec::len), Some(1));
    assert_eq!(page["data"][0]["name"], "frontend-design");
    assert_eq!(page["data"][0]["displayName"], "Frontend Design");
    assert_eq!(page["data"][0]["description"], "Design polished interfaces");
    assert_eq!(page["data"][0]["scope"], "repo");
    assert!(
        page["data"][0]["id"]
            .as_str()
            .is_some_and(|id| id.starts_with("skill_") && id.len() == 38)
    );
    assert!(page["data"][0].get("path").is_none());
    scenario.await.expect("scenario");
}

#[tokio::test]
async fn project_provider_should_start_task_and_turn_with_resume_deduplication() {
    let (runtime, server) = runtime();
    let provider = runtime
        .for_project(project(), &PortRequestContext::new("project"))
        .await
        .expect("project provider");
    let (read, mut write) = tokio::io::split(server);
    let mut read = BufReader::new(read);

    let scenario = tokio::spawn(async move {
        let start = read_frame(&mut read).await;
        assert_eq!(start["method"], "thread/start");
        respond(
            &mut write,
            &start,
            json!({ "thread": {
                "createdAt": 1_754_956_800,
                "cwd": "/workspace",
                "id": "task-1",
                "name": null,
                "preview": "新任务",
                "section": "unpinned",
                "updatedAt": 1_754_956_800
            } }),
        )
        .await;

        let turn = read_frame(&mut read).await;
        assert_eq!(turn["method"], "turn/start");
        respond(
            &mut write,
            &turn,
            json!({ "turn": {
                "completedAt": null,
                "error": null,
                "id": "turn-1",
                "items": [],
                "startedAt": 1_754_956_801,
                "status": "inProgress"
            } }),
        )
        .await;
    });

    let task = provider
        .start_task(
            json!({ "ephemeral": false }),
            &PortRequestContext::new("start"),
        )
        .await
        .expect("start task");
    assert_eq!(task["id"], "task-1");
    let turn = provider
        .start_turn(
            "task-1",
            json!({
                "input": [{ "text": "继续", "text_elements": [], "type": "text" }],
                "model": "gpt-5.6",
                "reasoningEffort": "high"
            }),
            &PortRequestContext::new("turn"),
        )
        .await
        .expect("start turn");
    assert_eq!(turn["id"], "turn-1");
    scenario.await.expect("scenario");
}

#[tokio::test]
async fn provider_should_route_mapped_notifications_to_project_subscription() {
    let (runtime, server) = runtime();
    let provider = runtime
        .for_project(project(), &PortRequestContext::new("project"))
        .await
        .expect("project provider");
    let (read, mut write) = tokio::io::split(server);
    let mut read = BufReader::new(read);
    let start = tokio::spawn(async move {
        let request = read_frame(&mut read).await;
        respond(
            &mut write,
            &request,
            json!({ "thread": {
                "createdAt": 1_754_956_800,
                "cwd": "/workspace",
                "id": "task-1",
                "name": null,
                "preview": "新任务",
                "section": "unpinned",
                "updatedAt": 1_754_956_800
            } }),
        )
        .await;
        (read, write)
    });
    provider
        .start_task(
            json!({ "ephemeral": false }),
            &PortRequestContext::new("start"),
        )
        .await
        .expect("start task");
    let (read, write) = start.await.expect("start scenario");
    let mut server = read.into_inner().unsplit(write);
    let mut events = provider
        .subscribe_events(false, &PortRequestContext::new("events"))
        .await
        .expect("subscription");

    server
        .write_all(
            format!(
                "{}\n",
                json!({
                    "method": "item/agentMessage/delta",
                    "params": {
                        "delta": "hello",
                        "itemId": "message-1",
                        "threadId": "task-1",
                        "turnId": "turn-1"
                    }
                })
            )
            .as_bytes(),
        )
        .await
        .expect("notification");

    let event = tokio::time::timeout(std::time::Duration::from_secs(1), events.recv())
        .await
        .expect("event timeout")
        .expect("event");
    assert_eq!(event.event_type(), "message.delta");
}

#[tokio::test]
async fn pending_approval_should_publish_and_round_trip_native_decision() {
    let (runtime, server) = runtime();
    let provider = runtime
        .for_project(project(), &PortRequestContext::new("project"))
        .await
        .expect("project provider");
    let (read, mut write) = tokio::io::split(server);
    let mut read = BufReader::new(read);
    let start = tokio::spawn(async move {
        let request = read_frame(&mut read).await;
        respond(
            &mut write,
            &request,
            json!({ "thread": {
                "createdAt": 1_754_956_800,
                "cwd": "/workspace",
                "id": "task-1",
                "name": null,
                "preview": "新任务",
                "section": "unpinned",
                "updatedAt": 1_754_956_800
            } }),
        )
        .await;
        (read, write)
    });
    provider
        .start_task(json!({}), &PortRequestContext::new("start"))
        .await
        .expect("start task");
    let (read, write) = start.await.expect("start scenario");
    let mut server = read.into_inner().unsplit(write);
    let mut events = provider
        .subscribe_events(false, &PortRequestContext::new("events"))
        .await
        .expect("subscription");

    server
        .write_all(
            format!(
                "{}\n",
                json!({
                    "id": "approval-1",
                    "method": "item/commandExecution/requestApproval",
                    "params": {
                        "availableDecisions": ["accept", "acceptForSession", "decline"],
                        "command": "pnpm check",
                        "cwd": "/workspace",
                        "itemId": "command-1",
                        "networkApprovalContext": null,
                        "reason": "运行检查",
                        "startedAtMs": 1_754_956_802_000_i64,
                        "threadId": "task-1",
                        "turnId": "turn-1"
                    }
                })
            )
            .as_bytes(),
        )
        .await
        .expect("server request");
    let event = tokio::time::timeout(std::time::Duration::from_secs(1), events.recv())
        .await
        .expect("pending timeout")
        .expect("pending event");
    assert_eq!(event.event_type(), "pending_request.created");
    let request_id = event.as_value()["payload"]["request"]["requestId"]
        .as_str()
        .expect("request id")
        .to_string();

    let resolve_context = PortRequestContext::new("resolve");
    let resolve = provider.resolve_pending_request(
        json!({ "decision": "allow_for_session", "requestId": request_id, "taskId": "task-1" }),
        &resolve_context,
    );
    let response = async {
        let (read, _write) = tokio::io::split(server);
        read_frame(&mut BufReader::new(read)).await
    };
    let (resolved, native) = tokio::join!(resolve, response);
    assert_eq!(resolved.expect("resolved")["status"], "resolved");
    assert_eq!(native["result"]["decision"], "acceptForSession");
}

#[tokio::test]
async fn review_worker_notification_should_route_to_parent_task() {
    let (runtime, server) = runtime();
    let provider = runtime
        .for_project(project(), &PortRequestContext::new("project"))
        .await
        .expect("project provider");
    let (read, mut write) = tokio::io::split(server);
    let mut read = BufReader::new(read);
    let start = tokio::spawn(async move {
        let request = read_frame(&mut read).await;
        respond(
            &mut write,
            &request,
            json!({ "thread": {
                "createdAt": 1_754_956_800,
                "cwd": "/workspace",
                "id": "task-1",
                "name": null,
                "preview": "新任务",
                "section": "unpinned",
                "updatedAt": 1_754_956_800
            } }),
        )
        .await;
        (read, write)
    });
    provider
        .start_task(json!({}), &PortRequestContext::new("start"))
        .await
        .expect("start task");
    let (read, write) = start.await.expect("start scenario");
    let mut server = read.into_inner().unsplit(write);
    let mut events = provider
        .subscribe_events(false, &PortRequestContext::new("events"))
        .await
        .expect("subscription");

    for notification in [
        json!({
            "method": "thread/started",
            "params": { "thread": {
                "id": "review-worker-1",
                "parentThreadId": "task-1",
                "source": { "subAgent": "review" }
            } }
        }),
        json!({
            "method": "item/completed",
            "params": {
                "item": {
                    "id": "review-message-1",
                    "phase": "commentary",
                    "text": "正在检查变更。",
                    "type": "agentMessage"
                },
                "threadId": "review-worker-1",
                "turnId": "review-turn-1"
            }
        }),
    ] {
        server
            .write_all(format!("{notification}\n").as_bytes())
            .await
            .expect("notification");
    }

    let event = tokio::time::timeout(std::time::Duration::from_secs(1), events.recv())
        .await
        .expect("review event timeout")
        .expect("review event");
    assert_eq!(event.task_id(), "task-1");
    assert_eq!(event.as_value()["payload"]["item"]["phase"], "commentary");
}
