use std::collections::HashSet;

use chrono::{TimeZone, Utc};
use code_agent_protocol::{ValueDefinition, parse_protocol_value};
use code_agent_provider_codex::{
    CODEX_IGNORED_NOTIFICATION_METHODS, CODEX_MAPPED_NOTIFICATION_METHODS,
    CODEX_SPECIAL_NOTIFICATION_METHODS, RpcServerRequest, map_codex_item, map_codex_notification,
    map_codex_server_request, map_codex_turn, map_context_usage,
};
use serde::Deserialize;
use serde_json::{Value, json};

#[derive(Debug, Deserialize)]
struct NotificationFixture {
    expected: Value,
    method: String,
    params: Value,
}

fn notification_fixtures() -> Vec<NotificationFixture> {
    serde_json::from_str(include_str!("fixtures/mapping/notifications.json"))
        .expect("notification fixtures should be valid JSON")
}

#[test]
fn notification_mapping_should_match_shared_fixtures() {
    for fixture in notification_fixtures() {
        let event = map_codex_notification(&fixture.method, &fixture.params)
            .expect("fixture should map")
            .expect("fixture should produce an event");

        assert_eq!(
            event.to_value().expect("serialize event"),
            fixture.expected,
            "{}",
            fixture.method
        );
    }
}

#[test]
fn phase5_realtime_path_should_match_shared_delivery_fixture() {
    let fixture: Value = serde_json::from_str(include_str!(
        "../../../tests/fixtures/phase5/realtime-path.json"
    ))
    .expect("phase 5 fixture");
    let actual = fixture["notifications"]
        .as_array()
        .expect("notifications")
        .iter()
        .map(|notification| {
            map_codex_notification(
                notification["method"].as_str().expect("method"),
                &notification["params"],
            )
            .expect("map notification")
            .expect("mapped event")
            .into_value()
            .expect("serialize event")
        })
        .collect::<Vec<_>>();

    assert_eq!(Value::Array(actual), fixture["expectedEvents"]);
}

#[test]
fn notification_mapping_should_drop_unknown_and_process_warning() {
    assert!(
        map_codex_notification("future/notification", &json!({}))
            .expect("unknown notifications should not fail")
            .is_none()
    );
    assert!(
        map_codex_notification(
            "warning",
            &json!({ "message": "process", "threadId": null })
        )
        .expect("process warning should not fail")
        .is_none()
    );
}

#[test]
fn notification_classification_sets_should_be_disjoint() {
    let mapped = CODEX_MAPPED_NOTIFICATION_METHODS
        .iter()
        .copied()
        .collect::<HashSet<_>>();
    let ignored = CODEX_IGNORED_NOTIFICATION_METHODS
        .iter()
        .copied()
        .collect::<HashSet<_>>();
    let special = CODEX_SPECIAL_NOTIFICATION_METHODS
        .iter()
        .copied()
        .collect::<HashSet<_>>();

    assert!(mapped.is_disjoint(&ignored));
    assert!(mapped.is_disjoint(&special));
    assert!(ignored.is_disjoint(&special));
}

#[test]
fn item_and_turn_mapping_should_preserve_domain_shape() {
    let command = map_codex_item(&json!({
        "aggregatedOutput": "done\n",
        "command": "pnpm check",
        "cwd": "/workspace",
        "exitCode": 0,
        "id": "command-1",
        "status": "completed",
        "type": "commandExecution"
    }))
    .expect("command should map");
    assert_eq!(command["type"], "command");
    assert_eq!(command["outputTruncated"], false);

    let turn = map_codex_turn(&json!({
        "completedAt": 1_753_228_830,
        "error": null,
        "id": "turn-1",
        "items": [
            { "id": "message-1", "phase": "final_answer", "text": "完成", "type": "agentMessage" },
            { "content": ["推理正文"], "id": "reasoning-1", "summary": ["摘要"], "type": "reasoning" }
        ],
        "startedAt": 1_753_228_800,
        "status": "completed"
    }))
    .expect("turn should map");
    parse_protocol_value(ValueDefinition::AgentTurn, turn.clone())
        .expect("mapped turn should satisfy the shared schema");
    assert_eq!(turn["items"][0]["phase"], "final_answer");
}

#[test]
fn context_compaction_should_map_as_running_only_activity() {
    let item = map_codex_item(&json!({
        "id": "context-compaction-1",
        "type": "contextCompaction"
    }))
    .expect("context compaction should map");

    assert_eq!(item["type"], "activity");
    assert_eq!(item["visibility"], "running_only");
}

#[test]
fn user_message_mapping_should_preserve_skills_without_native_paths() {
    let item = map_codex_item(&json!({
        "content": [
            { "name": "frontend-design", "path": "/private/SKILL.md", "type": "skill" },
            { "text": "检查界面", "type": "text" }
        ],
        "id": "message-skill",
        "type": "userMessage"
    }))
    .expect("user message should map");

    assert_eq!(item["skills"], json!([{ "name": "frontend-design" }]));
    assert_eq!(item["text"], "检查界面");
    assert!(!item.to_string().contains("/private/SKILL.md"));
}

#[test]
fn turn_mapping_should_merge_expanded_skill_messages() {
    let turn = map_codex_turn(&json!({
        "completedAt": 1_753_228_830,
        "error": null,
        "id": "turn-skill",
        "items": [{
            "content": [{
                "text": "$superwork:superwork-start $superwork:superwork-start 根据项目需求继续实现。",
                "type": "text"
            }],
            "id": "user-skill",
            "type": "userMessage"
        }, {
            "content": [{
                "text": "<skill>\n<name>superwork:superwork-start</name>\n<path>/private/SKILL.md</path>\n执行 Superwork 流程。\n</skill>",
                "type": "text"
            }],
            "id": "expanded-skill",
            "type": "userMessage"
        }],
        "startedAt": 1_753_228_800,
        "status": "completed"
    }))
    .expect("turn should map");

    assert_eq!(turn["items"].as_array().map(Vec::len), Some(1));
    assert_eq!(
        turn["items"][0]["skills"],
        json!([{ "name": "superwork:superwork-start" }])
    );
    assert_eq!(turn["items"][0]["text"], "根据项目需求继续实现。");
}

#[test]
fn collaboration_item_should_preserve_subagent_contract() {
    let item = map_codex_item(&json!({
        "agentsStates": {
            "frontend-analysis": {
                "message": "完成",
                "status": "completed"
            }
        },
        "id": "collaboration-1",
        "model": "gpt-5.6-sol",
        "prompt": "分析前端",
        "reasoningEffort": "high",
        "receiverThreadIds": ["frontend-analysis"],
        "senderThreadId": "task-1",
        "status": "completed",
        "tool": "spawnAgent",
        "type": "collabAgentToolCall"
    }))
    .expect("collaboration item should map");

    assert_eq!(item["name"], "agent/spawn");
    assert_eq!(
        item["input"]["receiverTaskIds"],
        json!(["frontend-analysis"])
    );
    assert_eq!(item["output"]["agents"][0]["status"], "completed");
}

#[test]
fn turn_mapping_should_backfill_subagent_nickname() {
    let turn = map_codex_turn(&json!({
        "completedAt": 1_754_998_402_i64,
        "error": null,
        "id": "turn-1",
        "items": [
            {
                "agentsStates": {
                    "frontend-analysis": { "status": "completed" }
                },
                "id": "collaboration-1",
                "receiverThreadIds": ["frontend-analysis"],
                "senderThreadId": "task-1",
                "status": "completed",
                "tool": "spawnAgent",
                "type": "collabAgentToolCall"
            },
            {
                "agentPath": "/root/frontend_analysis",
                "agentThreadId": "frontend-analysis",
                "id": "activity-1",
                "kind": "started",
                "type": "subAgentActivity"
            }
        ],
        "startedAt": 1_754_998_400_i64,
        "status": "completed"
    }))
    .expect("turn should map");

    assert_eq!(
        turn["items"][0]["output"]["agents"][0]["nickname"],
        "frontend_analysis"
    );
}

#[test]
fn context_usage_mapping_should_reject_missing_counters() {
    let error = map_context_usage(&json!({
        "last": {},
        "modelContextWindow": 128000,
        "total": {}
    }))
    .expect_err("missing counters should fail");

    assert!(error.to_string().contains("inputTokens"));
}

#[test]
fn realtime_diff_should_be_bounded_on_utf8_boundary() {
    let diff = "汉".repeat(200_000);
    let event = map_codex_notification(
        "turn/diff/updated",
        &json!({ "diff": diff, "threadId": "task-1", "turnId": "turn-1" }),
    )
    .expect("diff should map")
    .expect("diff should produce an event");
    let mapped = event.to_value().expect("serialize event");

    assert!(
        mapped["payload"]["diff"]
            .as_str()
            .expect("diff string")
            .len()
            <= 524_288
    );
    assert_eq!(mapped["payload"]["truncated"], true);
    assert_eq!(mapped["payload"]["originalByteLength"], 600_000);
}

#[test]
fn server_request_mapping_should_validate_all_pending_request_variants() {
    let now = Utc
        .with_ymd_and_hms(2026, 8, 12, 12, 0, 0)
        .single()
        .expect("fixed timestamp");
    let requests = [
        RpcServerRequest {
            id: json!(7),
            method: "item/commandExecution/requestApproval".to_string(),
            params: json!({
                "availableDecisions": ["accept", "acceptForSession", "decline"],
                "command": "pnpm check",
                "cwd": "/workspace",
                "itemId": "command-1",
                "networkApprovalContext": { "host": "example.com", "protocol": "https" },
                "reason": "需要联网",
                "startedAtMs": 1_754_998_400_000_i64,
                "threadId": "task-1",
                "turnId": "turn-1"
            }),
        },
        RpcServerRequest {
            id: json!("approval-8"),
            method: "item/fileChange/requestApproval".to_string(),
            params: json!({
                "availableDecisions": ["accept", "cancel"],
                "grantRoot": "/workspace",
                "itemId": "patch-1",
                "reason": null,
                "startedAtMs": 1_754_998_400_000_i64,
                "threadId": "task-1",
                "turnId": "turn-1"
            }),
        },
        RpcServerRequest {
            id: json!(9),
            method: "item/tool/requestUserInput".to_string(),
            params: json!({
                "autoResolutionMs": 5000,
                "isBlocking": true,
                "itemId": "question-1",
                "questions": [{
                    "header": "确认",
                    "id": "continue",
                    "isOther": false,
                    "isSecret": false,
                    "options": [
                        { "description": "继续执行", "label": "是" },
                        { "description": "停止执行", "label": "否" }
                    ],
                    "question": "继续吗？"
                }],
                "threadId": "task-1",
                "turnId": "turn-1"
            }),
        },
    ];

    for request in requests {
        let pending = map_codex_server_request(&request, "project-1", now)
            .expect("server request should map")
            .expect("supported request should produce pending state");
        parse_protocol_value(ValueDefinition::PendingRequest, pending.request.clone())
            .expect("pending request should satisfy the shared schema");
    }
}

#[test]
fn permission_server_requests_should_preserve_granular_profiles() {
    let now = Utc
        .with_ymd_and_hms(2026, 8, 12, 12, 0, 0)
        .single()
        .expect("fixed timestamp");
    let command = map_codex_server_request(
        &RpcServerRequest {
            id: json!(10),
            method: "item/commandExecution/requestApproval".to_string(),
            params: json!({
                "additionalPermissions": {
                    "fileSystem": {
                        "entries": [{
                            "access": "read",
                            "path": { "path": "/workspace/input", "type": "path" }
                        }],
                        "globScanMaxDepth": 3,
                        "read": null,
                        "write": null
                    },
                    "network": { "enabled": true }
                },
                "availableDecisions": ["accept", "decline"],
                "command": "pnpm check",
                "cwd": "/workspace",
                "itemId": "command-1",
                "networkApprovalContext": null,
                "reason": null,
                "startedAtMs": 1_754_998_400_000_i64,
                "threadId": "task-1",
                "turnId": "turn-1"
            }),
        },
        "project-1",
        now,
    )
    .expect("command request should map")
    .expect("command request should be supported");
    assert_eq!(
        command.request["additionalPermissions"]["fileSystem"]["entries"][0]["access"],
        "read"
    );

    let permission = map_codex_server_request(
        &RpcServerRequest {
            id: json!(11),
            method: "item/permissions/requestApproval".to_string(),
            params: permission_request_params(),
        },
        "project-1",
        now,
    )
    .expect("permission request should map")
    .expect("permission request should be supported");
    assert_eq!(permission.request["type"], "permissions_approval");
    assert_eq!(permission.request["environmentId"], "local");
    assert_eq!(
        permission.request["permissions"]["network"]["enabled"],
        true
    );
}

fn permission_request_params() -> Value {
    json!({
        "cwd": "/workspace",
        "environmentId": "local",
        "itemId": "permission-1",
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
                "read": ["/workspace/legacy-read"],
                "write": null
            },
            "network": { "enabled": true }
        },
        "reason": "需要额外权限",
        "startedAtMs": 1_754_998_400_000_i64,
        "threadId": "task-1",
        "turnId": "turn-1"
    })
}

#[test]
fn automatic_approval_review_should_map_to_stream_item() {
    let event = map_codex_notification(
        "item/autoApprovalReview/completed",
        &json!({
            "action": { "command": "pnpm check", "type": "command" },
            "review": {
                "rationale": "命令只执行测试",
                "riskLevel": "low",
                "status": "approved",
                "userAuthorization": "high"
            },
            "reviewId": "review-1",
            "targetItemId": "command-1",
            "threadId": "task-1",
            "turnId": "turn-1"
        }),
    )
    .expect("review should map")
    .expect("review should produce an event");

    assert_eq!(event.event_type(), "item.completed");
    assert_eq!(
        event.item().and_then(|item| item["status"].as_str()),
        Some("approved")
    );
}
