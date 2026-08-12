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

        assert_eq!(event.as_value(), &fixture.expected, "{}", fixture.method);
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
            .as_value()
            .clone()
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
    let mapped = event.as_value();

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
    assert_eq!(event.as_value()["payload"]["item"]["status"], "approved");
}
