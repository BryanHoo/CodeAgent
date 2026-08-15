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
                "section": null,
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
async fn project_provider_should_map_prompt_attachments_and_skills() {
    let (runtime, server) = runtime();
    let provider = runtime
        .for_project(project(), &PortRequestContext::new("project"))
        .await
        .expect("project provider");
    let (read, mut write) = tokio::io::split(server);
    let mut read = BufReader::new(read);
    let scenario = tokio::spawn(async move {
        let start = read_frame(&mut read).await;
        respond(
            &mut write,
            &start,
            json!({ "thread": {
                "createdAt": 1_754_956_800, "cwd": "/workspace", "id": "task-1",
                "name": null, "preview": "新任务", "section": null,
                "updatedAt": 1_754_956_800
            } }),
        )
        .await;

        let skills = read_frame(&mut read).await;
        assert_eq!(skills["method"], "skills/list");
        respond(
            &mut write,
            &skills,
            json!({ "data": [{ "cwd": "/workspace", "errors": [], "skills": [{
                "description": "Design", "enabled": true, "interface": null,
                "name": "frontend-design", "path": "/workspace/skills/frontend/SKILL.md",
                "scope": "repo", "shortDescription": "Design"
            }] }] }),
        )
        .await;

        let turn = read_frame(&mut read).await;
        assert_eq!(turn["method"], "turn/start");
        let input = turn["params"]["input"].as_array().expect("native input");
        assert_eq!(input[0]["type"], "skill");
        assert_eq!(input[0]["name"], "frontend-design");
        assert_eq!(input[0]["path"], "/workspace/skills/frontend/SKILL.md");
        assert_eq!(input[1]["text"], "检查界面");
        assert_eq!(input[2]["text"], "粘贴内容");
        assert_eq!(input[2]["text_elements"][0]["placeholder"], "notes.txt");
        assert_eq!(input[3]["text"], "/managed/report.pdf");
        assert_eq!(input[4]["type"], "image");
        assert_eq!(input[4]["url"], "data:image/png;base64,iVBORw0KGgo=");
        respond(
            &mut write,
            &turn,
            json!({ "turn": {
                "completedAt": null, "error": null, "id": "turn-1", "items": [],
                "startedAt": 1_754_956_801, "status": "inProgress"
            } }),
        )
        .await;
    });

    provider
        .start_task(json!({}), &PortRequestContext::new("start"))
        .await
        .expect("start task");
    let skill_page = provider
        .list_skills(&PortRequestContext::new("skills"))
        .await
        .expect("skills");
    let skill_id = serde_json::to_value(skill_page).expect("skill page")["data"][0]["id"]
        .as_str()
        .expect("skill id")
        .to_owned();
    provider
        .start_turn(
            "task-1",
            json!({
                "prompt": {
                    "attachments": [
                        { "kind": "text", "mediaType": "text/plain", "name": "notes.txt", "path": "/managed/notes.txt", "text": "粘贴内容" },
                        { "kind": "file", "mediaType": "application/pdf", "name": "report.pdf", "path": "/managed/report.pdf" },
                        { "data": "iVBORw0KGgo=", "kind": "image", "mediaType": "image/png", "name": "shot.png", "path": "/managed/shot.png" }
                    ],
                    "skills": [{ "id": skill_id, "name": "frontend-design" }],
                    "text": "检查界面"
                },
                "options": {
                    "approvalPolicy": "on-request", "approvalsReviewer": "user",
                    "model": "gpt-5.6", "reasoningEffort": "high",
                    "sandboxMode": "workspace-write"
                }
            }),
            &PortRequestContext::new("turn"),
        )
        .await
        .expect("start turn");
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
                "section": null,
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
async fn goal_turn_should_update_settings_set_goal_and_wait_for_started_notification() {
    let (runtime, server) = runtime();
    let provider = runtime
        .for_project(project(), &PortRequestContext::new("project"))
        .await
        .expect("project provider");
    let (read, mut write) = tokio::io::split(server);
    let mut read = BufReader::new(read);
    let scenario = tokio::spawn(async move {
        let start = read_frame(&mut read).await;
        respond(
            &mut write,
            &start,
            json!({ "thread": {
                "createdAt": 1_754_956_800, "cwd": "/workspace", "id": "task-1",
                "name": null, "preview": "新任务", "section": null,
                "updatedAt": 1_754_956_800
            } }),
        )
        .await;

        let settings = read_frame(&mut read).await;
        assert_eq!(settings["method"], "thread/settings/update");
        assert_eq!(settings["params"]["threadId"], "task-1");
        respond(&mut write, &settings, json!({})).await;
        let objective = read_frame(&mut read).await;
        assert_eq!(objective["method"], "thread/goal/set");
        assert_eq!(objective["params"]["objective"], "完成 Rust 迁移");
        respond(
            &mut write,
            &objective,
            json!({ "goal": { "objective": "完成 Rust 迁移", "threadId": "task-1" } }),
        )
        .await;
        write
            .write_all(
                format!(
                    "{}\n",
                    json!({
                        "method": "turn/started",
                        "params": { "threadId": "task-1", "turn": {
                            "completedAt": null, "error": null, "id": "goal-turn-1",
                            "items": [], "startedAt": 1_754_956_801, "status": "inProgress"
                        } }
                    })
                )
                .as_bytes(),
            )
            .await
            .expect("goal turn notification");
    });

    provider
        .start_task(json!({}), &PortRequestContext::new("start"))
        .await
        .expect("start task");
    let turn = provider
        .start_turn(
            "task-1",
            json!({
                "prompt": { "attachments": [], "skills": [], "text": "  完成 Rust 迁移  " },
                "options": {
                    "approvalPolicy": "on-request", "approvalsReviewer": "user",
                    "goalMode": true, "model": "gpt-5.6", "reasoningEffort": "high",
                    "sandboxMode": "workspace-write"
                }
            }),
            &PortRequestContext::new("goal"),
        )
        .await
        .expect("goal turn");
    assert_eq!(turn["id"], "goal-turn-1");
    scenario.await.expect("scenario");
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
                "section": null,
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
    let request_id = event.pending_request().expect("pending request")["requestId"]
        .as_str()
        .expect("request id")
        .to_string();

    let resolve_context = PortRequestContext::new("resolve");
    let resolve = provider.resolve_pending_request(
        json!({
            "itemId": "command-1", "projectId": "project-1",
            "requestId": request_id, "resolution": { "decision": "allow_for_session" },
            "taskId": "task-1", "turnId": "turn-1", "type": "command_approval"
        }),
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
                "section": null,
                "updatedAt": 1_754_956_800
            } }),
        )
        .await;
        let review = read_frame(&mut read).await;
        assert_eq!(review["method"], "review/start");
        assert_eq!(
            review["params"]["target"],
            json!({ "type": "uncommittedChanges" })
        );
        respond(
            &mut write,
            &review,
            json!({
                "reviewThreadId": "task-1",
                "turn": {
                    "completedAt": null, "error": null, "id": "review-outer-turn",
                    "items": [], "startedAt": 1_754_956_801, "status": "inProgress"
                }
            }),
        )
        .await;
        (read, write)
    });
    provider
        .start_task(json!({}), &PortRequestContext::new("start"))
        .await
        .expect("start task");
    let review_context = PortRequestContext::new("review");
    let review = provider.start_review(
        "task-1",
        json!({ "type": "uncommitted_changes" }),
        &review_context,
    );
    let (review, server) = tokio::join!(review, start);
    let review = review.expect("start review");
    assert_eq!(review["items"][0]["type"], "review");
    let (read, write) = server.expect("start scenario");
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
            "method": "turn/started",
            "params": {
                "threadId": "review-worker-1",
                "turn": {
                    "completedAt": null, "error": null, "id": "review-worker-turn",
                    "items": [], "startedAt": 1_754_956_802, "status": "inProgress"
                }
            }
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
                "turnId": "review-worker-turn"
            }
        }),
    ] {
        server
            .write_all(format!("{notification}\n").as_bytes())
            .await
            .expect("notification");
    }

    let started = tokio::time::timeout(std::time::Duration::from_secs(1), events.recv())
        .await
        .expect("review event timeout")
        .expect("review event");
    assert_eq!(started.event_type(), "turn.started");
    assert_eq!(started.turn_id(), Some("review-outer-turn"));
    assert_eq!(
        started.turn().expect("started turn")["items"][0]["type"],
        "review"
    );
    let event = events.recv().await.expect("review item event");
    assert_eq!(event.task_id(), "task-1");
    assert_eq!(event.turn_id(), Some("review-outer-turn"));
    assert_eq!(event.item().expect("review item")["phase"], "commentary");
}
