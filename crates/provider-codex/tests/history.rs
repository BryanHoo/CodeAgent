use std::sync::Arc;

use code_agent_core::{PortRequestContext, ProviderPort};
use code_agent_protocol::Project;
use code_agent_provider_codex::{CodexRuntimeProvider, JsonlRpcClient, JsonlRpcClientOptions};
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, DuplexStream, duplex};

const PINNED_SECTION_ID: &str = "01984de2-8f74-7c91-a3b2-5c5e937cf318";

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

#[tokio::test]
async fn project_provider_should_read_execution_snapshot_without_runtime_settings() {
    let (runtime, server) = runtime();
    let provider = runtime
        .for_project(project(), &PortRequestContext::new("project"))
        .await
        .expect("project provider");
    let (read, mut write) = tokio::io::split(server);
    let mut read = BufReader::new(read);
    let scenario = tokio::spawn(async move {
        let mut line = String::new();
        read.read_line(&mut line).await.expect("read frame");
        let request: Value = serde_json::from_str(&line).expect("valid frame");
        assert_eq!(request["method"], "thread/read");
        write
            .write_all(
                format!(
                    "{}\n",
                    json!({
                        "id": request["id"],
                        "result": { "thread": {
                            "createdAt": 1_754_956_800,
                            "cwd": "/workspace",
                            "id": "task-1",
                            "name": null,
                            "preview": "历史任务",
                            "section": null,
                            "turns": [],
                            "updatedAt": 1_754_956_801
                        } }
                    })
                )
                .as_bytes(),
            )
            .await
            .expect("write response");
    });

    let snapshot = provider
        .read_task("task-1", &PortRequestContext::new("read"))
        .await
        .expect("read execution snapshot")
        .expect("snapshot");

    assert_eq!(snapshot["id"], "task-1");
    assert_eq!(snapshot["title"], "历史任务");
    assert!(snapshot.get("settings").is_none());
    scenario.await.expect("scenario");
}

async fn read_frame(reader: &mut BufReader<tokio::io::ReadHalf<DuplexStream>>) -> Value {
    let mut line = String::new();
    reader.read_line(&mut line).await.expect("read frame");
    serde_json::from_str(&line).expect("valid frame")
}

#[tokio::test]
async fn historical_snapshot_should_restore_skills_from_rollout_transcript() {
    let unique = format!("code-agent-transcript-{}", std::process::id());
    let codex_home = std::env::temp_dir().join(unique);
    let session_directory = codex_home.join("sessions/2026/08/13");
    std::fs::create_dir_all(&session_directory).expect("create session directory");
    let task_id = "task-transcript";
    let transcript_path = session_directory.join(format!("rollout-2026-08-13-{task_id}.jsonl"));
    let transcript_entry = json!({
        "payload": {
            "content": [{
                "text": "<skill>\n<name>superwork:superwork-start</name>\n<path>/private/SKILL.md</path>\nSkill instructions\n</skill>",
                "type": "input_text"
            }],
            "internal_chat_message_metadata_passthrough": { "turn_id": "turn-1" },
            "role": "user",
            "type": "message"
        },
        "type": "response_item"
    });
    std::fs::write(&transcript_path, format!("{transcript_entry}\n")).expect("write transcript");

    let (client_stream, server) = duplex(128 * 1024);
    let (read, write) = tokio::io::split(client_stream);
    let (client, incoming, _workers) =
        JsonlRpcClient::spawn(read, write, JsonlRpcClientOptions::default());
    let runtime = Arc::new(CodexRuntimeProvider::new_with_codex_home(
        client,
        incoming,
        codex_home.clone(),
    ));
    let provider = runtime
        .for_project(project(), &PortRequestContext::new("project"))
        .await
        .expect("project provider");
    let (read, mut write) = tokio::io::split(server);
    let mut read = BufReader::new(read);
    let scenario = tokio::spawn(async move {
        let request = read_frame(&mut read).await;
        respond(
            &mut write,
            &request,
            json!({ "thread": {
                "createdAt": 1_754_956_800,
                "cwd": "/workspace",
                "id": task_id,
                "name": null,
                "preview": "Skill task",
                "section": null,
                "turns": [{
                    "completedAt": 1_754_956_802,
                    "error": null,
                    "id": "turn-1",
                    "items": [{
                        "content": [{ "text": "$superwork:superwork-start 继续实现", "type": "text" }],
                        "id": "message-1",
                        "type": "userMessage"
                    }],
                    "startedAt": 1_754_956_801,
                    "status": "completed"
                }],
                "updatedAt": 1_754_956_802
            } }),
        )
        .await;
    });

    let snapshot = provider
        .read_task(task_id, &PortRequestContext::new("read"))
        .await
        .expect("read task")
        .expect("snapshot");

    assert_eq!(
        snapshot["turns"][0]["items"][0]["skills"],
        json!([{ "name": "superwork:superwork-start" }])
    );
    assert_eq!(snapshot["turns"][0]["items"][0]["text"], "继续实现");
    scenario.await.expect("scenario");
    std::fs::remove_dir_all(codex_home).expect("remove transcript fixture");
}

#[tokio::test]
async fn historical_snapshot_should_merge_expanded_skill_messages_without_transcript() {
    let (runtime, server) = runtime();
    let provider = runtime
        .for_project(project(), &PortRequestContext::new("project"))
        .await
        .expect("project provider");
    let (read, mut write) = tokio::io::split(server);
    let mut read = BufReader::new(read);
    let scenario = tokio::spawn(async move {
        let request = read_frame(&mut read).await;
        respond(
            &mut write,
            &request,
            json!({ "thread": {
                "createdAt": 1_754_956_800,
                "cwd": "/workspace",
                "id": "task-1",
                "name": null,
                "preview": "Skill task",
                "section": null,
                "turns": [{
                    "completedAt": 1_754_956_802,
                    "error": null,
                    "id": "turn-1",
                    "items": [{
                        "content": [{
                            "text": "$superwork:superwork-start $superwork:superwork-start 继续实现",
                            "type": "text"
                        }],
                        "id": "message-1",
                        "type": "userMessage"
                    }, {
                        "content": [{
                            "text": "<skill>\n<name>superwork:superwork-start</name>\n<path>/private/SKILL.md</path>\nSkill instructions\n</skill>",
                            "type": "text"
                        }],
                        "id": "message-skill",
                        "type": "userMessage"
                    }, {
                        "id": "assistant-1",
                        "phase": "final_answer",
                        "text": "完成",
                        "type": "agentMessage"
                    }],
                    "startedAt": 1_754_956_801,
                    "status": "completed"
                }],
                "updatedAt": 1_754_956_802
            } }),
        )
        .await;
    });

    let snapshot = provider
        .read_task("task-1", &PortRequestContext::new("read"))
        .await
        .expect("read task")
        .expect("snapshot");

    assert_eq!(
        snapshot["turns"][0]["items"].as_array().map(Vec::len),
        Some(2)
    );
    assert_eq!(
        snapshot["turns"][0]["items"][0]["skills"],
        json!([{ "name": "superwork:superwork-start" }])
    );
    assert_eq!(snapshot["turns"][0]["items"][0]["text"], "继续实现");
    assert_eq!(snapshot["turns"][0]["items"][1]["text"], "完成");
    scenario.await.expect("scenario");
}

async fn respond(writer: &mut tokio::io::WriteHalf<DuplexStream>, request: &Value, result: Value) {
    writer
        .write_all(format!("{}\n", json!({ "id": request["id"], "result": result })).as_bytes())
        .await
        .expect("write response");
}

#[tokio::test]
async fn task_pinning_should_use_codex_fixed_section_uuid() {
    let (runtime, server) = runtime();
    let provider = runtime
        .for_project(project(), &PortRequestContext::new("project"))
        .await
        .expect("project provider");
    let (read, mut write) = tokio::io::split(server);
    let mut read = BufReader::new(read);
    let scenario = tokio::spawn(async move {
        let list = read_frame(&mut read).await;
        respond(
            &mut write,
            &list,
            json!({ "data": [{
                "createdAt": 1_754_956_800,
                "cwd": "/workspace",
                "id": "task-1",
                "name": null,
                "preview": "历史任务",
                "section": null,
                "updatedAt": 1_754_956_801
            }], "nextCursor": null }),
        )
        .await;
        let pin = read_frame(&mut read).await;
        assert_eq!(pin["method"], "thread/section/move");
        assert_eq!(pin["params"]["sectionId"], PINNED_SECTION_ID);
        respond(&mut write, &pin, json!({})).await;
        let read = read_frame(&mut read).await;
        respond(
            &mut write,
            &read,
            json!({ "thread": {
                "createdAt": 1_754_956_800,
                "cwd": "/workspace",
                "id": "task-1",
                "name": null,
                "preview": "历史任务",
                "section": { "id": PINNED_SECTION_ID, "name": "Pinned" },
                "updatedAt": 1_754_956_801
            } }),
        )
        .await;
    });

    provider
        .list_tasks(json!({}), &PortRequestContext::new("list"))
        .await
        .expect("list tasks");
    let task = provider
        .pin_task("task-1", true, &PortRequestContext::new("pin"))
        .await
        .expect("pin task");

    assert_eq!(task["pinned"], true);
    scenario.await.expect("scenario");
}

#[tokio::test]
async fn pinned_task_listing_should_query_only_the_codex_fixed_section() {
    let (runtime, server) = runtime();
    let provider = runtime
        .for_project(project(), &PortRequestContext::new("project"))
        .await
        .expect("project provider");
    let (read, mut write) = tokio::io::split(server);
    let mut read = BufReader::new(read);
    let scenario = tokio::spawn(async move {
        let list = read_frame(&mut read).await;
        assert_eq!(list["method"], "thread/list");
        assert_eq!(list["params"]["sectionId"], PINNED_SECTION_ID);
        assert_eq!(list["params"]["useStateDbOnly"], true);
        respond(
            &mut write,
            &list,
            json!({ "data": [{
                "createdAt": 1_754_956_800,
                "cwd": "/workspace",
                "id": "task-pinned",
                "name": null,
                "preview": "固定任务",
                "section": { "id": PINNED_SECTION_ID, "name": "Pinned" },
                "updatedAt": 1_754_956_801
            }], "nextCursor": null }),
        )
        .await;
    });

    let page = provider
        .list_tasks(
            json!({ "limit": 100, "pinnedOnly": true }),
            &PortRequestContext::new("list-pinned"),
        )
        .await
        .expect("list pinned tasks");

    assert_eq!(page.data.len(), 1);
    scenario.await.expect("scenario");
}

#[tokio::test]
async fn newly_started_task_should_remain_visible_before_codex_materializes_history() {
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
                "createdAt": 1_754_956_800,
                "cwd": "/workspace",
                "id": "task-new",
                "name": null,
                "preview": "新任务",
                "section": null,
                "updatedAt": 1_754_956_800
            } }),
        )
        .await;
        let list = read_frame(&mut read).await;
        respond(&mut write, &list, json!({ "data": [], "nextCursor": null })).await;
        let read = read_frame(&mut read).await;
        write
            .write_all(
                format!(
                    "{}\n",
                    json!({ "id": read["id"], "error": {
                        "code": -32600,
                        "message": "thread task-new is not materialized yet; includeTurns is unavailable before first user message"
                    } })
                )
                .as_bytes(),
            )
            .await
            .expect("write error");
    });

    provider
        .start_task(json!({}), &PortRequestContext::new("start"))
        .await
        .expect("start task");
    let page = provider
        .list_tasks(json!({}), &PortRequestContext::new("list"))
        .await
        .expect("list tasks");
    let snapshot = provider
        .read_task("task-new", &PortRequestContext::new("read"))
        .await
        .expect("read task")
        .expect("snapshot");

    assert_eq!(page.data.len(), 1);
    assert_eq!(snapshot["id"], "task-new");
    assert_eq!(snapshot["turns"], json!([]));
    scenario.await.expect("scenario");
}

#[tokio::test]
async fn missing_thread_should_map_to_absent_task() {
    let (runtime, server) = runtime();
    let provider = runtime
        .for_project(project(), &PortRequestContext::new("project"))
        .await
        .expect("project provider");
    let (read, mut write) = tokio::io::split(server);
    let mut read = BufReader::new(read);
    let scenario = tokio::spawn(async move {
        let request = read_frame(&mut read).await;
        write
            .write_all(
                format!(
                    "{}\n",
                    json!({ "id": request["id"], "error": {
                        "code": -32600,
                        "message": "thread not loaded: missing-task"
                    } })
                )
                .as_bytes(),
            )
            .await
            .expect("write error");
    });

    let task = provider
        .read_task("missing-task", &PortRequestContext::new("read"))
        .await
        .expect("read task");

    assert!(task.is_none());
    scenario.await.expect("scenario");
}

#[tokio::test]
async fn unknown_unmaterialized_thread_should_preserve_provider_failure() {
    let (runtime, server) = runtime();
    let provider = runtime
        .for_project(project(), &PortRequestContext::new("project"))
        .await
        .expect("project provider");
    let (read, mut write) = tokio::io::split(server);
    let mut read = BufReader::new(read);
    let scenario = tokio::spawn(async move {
        let request = read_frame(&mut read).await;
        write
            .write_all(
                format!(
                    "{}\n",
                    json!({ "id": request["id"], "error": {
                        "code": -32600,
                        "message": "thread unknown is not materialized yet; includeTurns is unavailable before first user message"
                    } })
                )
                .as_bytes(),
            )
            .await
            .expect("write error");
    });

    let error = provider
        .read_task("unknown", &PortRequestContext::new("read"))
        .await
        .expect_err("unknown task should remain a provider failure");

    assert_eq!(error.code().to_string(), "provider_failure");
    scenario.await.expect("scenario");
}

#[cfg(unix)]
#[tokio::test]
async fn historical_task_should_match_project_through_a_symbolic_link() {
    let unique = format!(
        "code-agent-history-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system time")
            .as_nanos()
    );
    let base = std::env::temp_dir().join(unique);
    let real_root = base.join("real");
    let linked_root = base.join("linked");
    std::fs::create_dir_all(&real_root).expect("create real root");
    std::os::unix::fs::symlink(&real_root, &linked_root).expect("create symbolic link");
    let project: Project = serde_json::from_value(json!({
        "createdAt": "2026-08-12T00:00:00.000Z",
        "id": "project-1",
        "name": "Project",
        "rootPath": linked_root.to_string_lossy()
    }))
    .expect("valid project");
    let (runtime, server) = runtime();
    let provider = runtime
        .for_project(project, &PortRequestContext::new("project"))
        .await
        .expect("project provider");
    let (read, mut write) = tokio::io::split(server);
    let mut read = BufReader::new(read);
    let cwd = real_root.to_string_lossy().to_string();
    let scenario = tokio::spawn(async move {
        let request = read_frame(&mut read).await;
        respond(
            &mut write,
            &request,
            json!({ "thread": {
                "createdAt": 1_754_956_800,
                "cwd": cwd,
                "id": "task-1",
                "name": null,
                "preview": "历史任务",
                "section": null,
                "turns": [],
                "updatedAt": 1_754_956_801
            } }),
        )
        .await;
    });

    let task = provider
        .read_task("task-1", &PortRequestContext::new("read"))
        .await
        .expect("read task");

    assert!(task.is_some());
    scenario.await.expect("scenario");
    std::fs::remove_dir_all(base).expect("remove fixture");
}

#[tokio::test]
async fn task_snapshot_should_merge_live_usage_plan_status_and_pending_requests() {
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
                "preview": "运行任务",
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
        .expect("subscribe events");
    for notification in [
        json!({ "method": "turn/started", "params": {
            "threadId": "task-1",
            "turn": {
                "completedAt": null,
                "error": null,
                "id": "turn-1",
                "items": [],
                "startedAt": 1_754_956_801,
                "status": "inProgress"
            }
        }}),
        json!({ "method": "thread/tokenUsage/updated", "params": {
            "threadId": "task-1",
            "turnId": "turn-1",
            "tokenUsage": { "last": { "totalTokens": 321 }, "modelContextWindow": 1000 }
        }}),
        json!({ "method": "turn/plan/updated", "params": {
            "explanation": "执行中",
            "plan": [{ "status": "inProgress", "step": "检查历史" }],
            "threadId": "task-1",
            "turnId": "turn-1"
        }}),
    ] {
        server
            .write_all(format!("{notification}\n").as_bytes())
            .await
            .expect("write notification");
        events.recv().await.expect("mapped event");
    }
    server
        .write_all(
            format!(
                "{}\n",
                json!({
                    "id": "approval-1",
                    "method": "item/commandExecution/requestApproval",
                    "params": {
                        "availableDecisions": ["accept", "decline"],
                        "command": "cargo test",
                        "cwd": "/workspace",
                        "itemId": "command-1",
                        "networkApprovalContext": null,
                        "reason": "验证",
                        "startedAtMs": 1_754_956_802_000_i64,
                        "threadId": "task-1",
                        "turnId": "turn-1"
                    }
                })
            )
            .as_bytes(),
        )
        .await
        .expect("write approval");
    events.recv().await.expect("pending event");

    let read_context = PortRequestContext::new("read");
    let read_task = provider.read_task("task-1", &read_context);
    let response = async {
        let (read, mut write) = tokio::io::split(server);
        let mut read = BufReader::new(read);
        let request = read_frame(&mut read).await;
        respond(
            &mut write,
            &request,
            json!({ "thread": {
                "createdAt": 1_754_956_800,
                "cwd": "/workspace",
                "id": "task-1",
                "name": null,
                "preview": "运行任务",
                "section": null,
                "status": { "type": "active" },
                "turns": [],
                "updatedAt": 1_754_956_802
            } }),
        )
        .await;
    };
    let (snapshot, ()) = tokio::join!(read_task, response);
    let snapshot = snapshot.expect("read task").expect("snapshot");

    assert_eq!(snapshot["status"], "running");
    assert_eq!(snapshot["contextUsage"]["usedTokens"], 321);
    assert_eq!(snapshot["plan"]["steps"][0]["status"], "in_progress");
    assert_eq!(
        snapshot["pendingRequests"].as_array().map(Vec::len),
        Some(1)
    );
}

#[tokio::test]
async fn task_snapshot_should_merge_subagent_review_worker_history() {
    let (runtime, server) = runtime();
    let provider = runtime
        .for_project(project(), &PortRequestContext::new("project"))
        .await
        .expect("project provider");
    let (read, mut write) = tokio::io::split(server);
    let mut read = BufReader::new(read);
    let scenario = tokio::spawn(async move {
        let parent_read = read_frame(&mut read).await;
        respond(
            &mut write,
            &parent_read,
            json!({ "thread": {
                "createdAt": 1_754_956_800,
                "cwd": "/workspace",
                "id": "task-1",
                "name": null,
                "preview": "审查任务",
                "section": null,
                "status": { "type": "active" },
                "turns": [{
                    "completedAt": null,
                    "error": null,
                    "id": "review-outer-turn",
                    "items": [{
                        "id": "review-mode",
                        "review": "current changes",
                        "type": "enteredReviewMode"
                    }],
                    "startedAt": null,
                    "status": "completed"
                }],
                "updatedAt": 1_754_956_801
            } }),
        )
        .await;
        let workers = read_frame(&mut read).await;
        assert_eq!(workers["method"], "thread/list");
        assert_eq!(workers["params"]["sourceKinds"], json!(["subAgentReview"]));
        respond(
            &mut write,
            &workers,
            json!({ "data": [{ "id": "review-worker-1" }], "nextCursor": null }),
        )
        .await;
        let worker_read = read_frame(&mut read).await;
        respond(
            &mut write,
            &worker_read,
            json!({ "thread": {
                "id": "review-worker-1",
                "turns": [{
                    "completedAt": null,
                    "error": null,
                    "id": "review-worker-turn",
                    "items": [{
                        "content": [{
                            "text": "Review the current code changes (staged, unstaged, and untracked files).",
                            "type": "text"
                        }],
                        "id": "review-prompt",
                        "type": "userMessage"
                    }, {
                        "aggregatedOutput": "diff --git a/a.rs b/a.rs",
                        "command": "git diff",
                        "cwd": "/workspace",
                        "exitCode": 0,
                        "id": "review-command",
                        "status": "completed",
                        "type": "commandExecution"
                    }],
                    "startedAt": 1_754_956_801,
                    "status": "inProgress"
                }]
            } }),
        )
        .await;
    });

    let snapshot = provider
        .read_task("task-1", &PortRequestContext::new("read"))
        .await
        .expect("read task")
        .expect("snapshot");

    assert_eq!(snapshot["turns"].as_array().map(Vec::len), Some(1));
    assert_eq!(snapshot["turns"][0]["id"], "review-outer-turn");
    assert_eq!(snapshot["turns"][0]["status"], "running");
    assert_eq!(snapshot["turns"][0]["items"][0]["type"], "review");
    assert_eq!(snapshot["turns"][0]["items"][1]["id"], "review-command");
    scenario.await.expect("scenario");
}

#[cfg(unix)]
#[tokio::test]
async fn historical_local_image_should_return_readable_attachment_metadata() {
    let unique = format!("code-agent-image-{}", std::process::id());
    let directory = std::env::temp_dir().join(unique);
    std::fs::create_dir_all(&directory).expect("create image directory");
    let image_path = directory.join("diagram.png");
    let image_bytes = vec![137, 80, 78, 71, 13, 10, 26, 10];
    std::fs::write(&image_path, &image_bytes).expect("write image");
    let (runtime, server) = runtime();
    let provider = runtime
        .for_project(project(), &PortRequestContext::new("project"))
        .await
        .expect("project provider");
    let (read, mut write) = tokio::io::split(server);
    let mut read = BufReader::new(read);
    let path = image_path.to_string_lossy().to_string();
    let scenario = tokio::spawn(async move {
        let request = read_frame(&mut read).await;
        respond(
            &mut write,
            &request,
            json!({ "thread": {
                "createdAt": 1_754_956_800,
                "cwd": "/workspace",
                "id": "task-1",
                "name": null,
                "preview": "图片任务",
                "section": null,
                "turns": [{
                    "completedAt": 1_754_956_802,
                    "error": null,
                    "id": "turn-image",
                    "items": [{
                        "content": [
                            { "text": "分析这张图", "type": "text" },
                            { "path": path, "type": "localImage" }
                        ],
                        "id": "message-image",
                        "type": "userMessage"
                    }],
                    "startedAt": 1_754_956_801,
                    "status": "completed"
                }],
                "updatedAt": 1_754_956_802
            } }),
        )
        .await;
        let terminals = read_frame(&mut read).await;
        assert_eq!(terminals["method"], "thread/backgroundTerminals/list");
        respond(
            &mut write,
            &terminals,
            json!({ "data": [], "nextCursor": null }),
        )
        .await;
        let unsubscribe = read_frame(&mut read).await;
        assert_eq!(unsubscribe["method"], "thread/unsubscribe");
        respond(
            &mut write,
            &unsubscribe,
            json!({ "status": "unsubscribed" }),
        )
        .await;
    });

    let snapshot = provider
        .read_task("task-1", &PortRequestContext::new("read"))
        .await
        .expect("read task")
        .expect("snapshot");
    let attachment = &snapshot["turns"][0]["items"][0]["attachments"][0];
    let attachment_id = attachment["id"].as_str().expect("attachment id");
    let content = provider
        .read_task_attachment(
            "task-1",
            attachment_id,
            &PortRequestContext::new("attachment"),
        )
        .await
        .expect("read attachment")
        .expect("attachment content");

    assert_eq!(attachment["mediaType"], "image/png");
    assert_eq!(attachment["name"], "diagram.png");
    assert_eq!(content.as_slice(), image_bytes);
    assert!(
        !snapshot
            .to_string()
            .contains(image_path.to_string_lossy().as_ref())
    );
    assert_eq!(
        provider
            .unsubscribe_task("task-1", &PortRequestContext::new("unsubscribe"))
            .await
            .expect("unsubscribe"),
        "unsubscribed"
    );
    assert!(
        provider
            .read_task_attachment(
                "task-1",
                attachment_id,
                &PortRequestContext::new("after-unsubscribe")
            )
            .await
            .expect("read after unsubscribe")
            .is_none()
    );
    scenario.await.expect("scenario");
    std::fs::remove_dir_all(directory).expect("remove fixture");
}

#[tokio::test]
async fn historical_inline_generated_and_text_attachments_should_be_stable_and_readable() {
    let image_bytes = vec![137, 80, 78, 71, 13, 10, 26, 10];
    let image_data_url = "data:image/png;base64,iVBORw0KGgo=";
    let generated_image = "iVBORw0KGgo=";
    let pasted_text = "第一行\n你好";
    let pasted_size = pasted_text.len();
    let thread = json!({
        "createdAt": 1_754_956_800,
        "cwd": "/workspace",
        "id": "task-1",
        "name": null,
        "preview": "附件任务",
        "section": null,
        "turns": [{
            "completedAt": 1_754_956_802,
            "error": null,
            "id": "turn-attachments",
            "items": [{
                "content": [{ "text": "分析附件", "type": "text" }, {
                    "name": "inline.png",
                    "type": "image",
                    "url": image_data_url
                }, {
                    "text": pasted_text,
                    "text_elements": [{
                        "byteRange": { "end": pasted_size, "start": 0 },
                        "placeholder": "Pasted text.txt"
                    }],
                    "type": "text"
                }],
                "id": "message-attachments",
                "type": "userMessage"
            }, {
                "id": "generated-image",
                "result": generated_image,
                "status": "completed",
                "type": "imageGeneration"
            }],
            "startedAt": 1_754_956_801,
            "status": "completed"
        }],
        "updatedAt": 1_754_956_802
    });
    let (runtime, server) = runtime();
    let provider = runtime
        .for_project(project(), &PortRequestContext::new("project"))
        .await
        .expect("project provider");
    let (read, mut write) = tokio::io::split(server);
    let mut read = BufReader::new(read);
    let scenario = tokio::spawn(async move {
        for _ in 0..2 {
            let request = read_frame(&mut read).await;
            respond(&mut write, &request, json!({ "thread": thread })).await;
        }
    });

    let first = provider
        .read_task("task-1", &PortRequestContext::new("first"))
        .await
        .expect("first read")
        .expect("first snapshot");
    let second = provider
        .read_task("task-1", &PortRequestContext::new("second"))
        .await
        .expect("second read")
        .expect("second snapshot");
    let first_inline_id = first["turns"][0]["items"][0]["attachments"][0]["id"]
        .as_str()
        .expect("inline id");
    let first_text_id = first["turns"][0]["items"][0]["attachments"][1]["id"]
        .as_str()
        .expect("text id");
    let first_generated_id = first["turns"][0]["items"][1]["attachments"][0]["id"]
        .as_str()
        .expect("generated id");

    assert_eq!(
        second["turns"][0]["items"][0]["attachments"][0]["id"],
        first_inline_id
    );
    assert_eq!(
        provider
            .read_task_attachment(
                "task-1",
                first_inline_id,
                &PortRequestContext::new("inline")
            )
            .await
            .expect("read inline"),
        Some(image_bytes.clone().into())
    );
    assert_eq!(
        provider
            .read_task_attachment(
                "task-1",
                first_generated_id,
                &PortRequestContext::new("generated")
            )
            .await
            .expect("read generated"),
        Some(image_bytes.into())
    );
    assert_eq!(
        provider
            .read_task_attachment("task-1", first_text_id, &PortRequestContext::new("text"))
            .await
            .expect("read text"),
        Some(pasted_text.as_bytes().to_vec().into())
    );
    assert!(!first.to_string().contains(image_data_url));
    assert!(!first.to_string().contains(pasted_text));
    scenario.await.expect("scenario");
}
