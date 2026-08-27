use serde_json::{Value, json, to_value};

use super::conversation::map_item;

#[test]
fn official_thread_items_should_keep_visible_semantics() {
    let cases = [
        (
            json!({
                "id": "collab-a", "type": "collabAgentToolCall", "tool": "spawnAgent",
                "status": "completed", "senderThreadId": "thread-a",
                "receiverThreadIds": ["thread-b"], "prompt": "检查实现", "model": null,
                "reasoningEffort": null, "agentsStates": {}
            }),
            "tool",
        ),
        (
            json!({"id": "search-a", "type": "webSearch", "query": "Codex", "results": []}),
            "tool",
        ),
        (
            json!({
                "id": "image-a", "type": "imageGeneration", "status": "completed",
                "revisedPrompt": "diagram", "result": null, "failure": null
            }),
            "tool",
        ),
        (
            json!({"id": "hook-a", "type": "hookPrompt", "fragments": []}),
            "activity",
        ),
        (
            json!({
                "id": "sub-a", "type": "subAgentActivity", "kind": "started",
                "agentThreadId": "thread-b", "agentPath": "reviewer"
            }),
            "activity",
        ),
        (
            json!({"id": "view-a", "type": "imageView", "path": "/tmp/a.png"}),
            "activity",
        ),
        (
            json!({"id": "sleep-a", "type": "sleep", "durationMs": 250}),
            "activity",
        ),
        (
            json!({"id": "review-a", "type": "enteredReviewMode", "review": "current changes"}),
            "review",
        ),
        (
            json!({"id": "review-b", "type": "exitedReviewMode", "review": "未发现问题"}),
            "message",
        ),
        (
            json!({"id": "compact-a", "type": "contextCompaction"}),
            "activity",
        ),
    ];

    for (native, expected_type) in cases {
        let item = map_item(native).expect("official item should map");
        let value: Value = to_value(item).expect("mapped item should serialize");
        assert_eq!(value["type"], expected_type);
        assert_ne!(value["label"], "Provider 活动");
    }
}

#[test]
fn command_output_should_keep_bounded_utf8_head_and_tail() {
    let output = format!(
        "{}{}{}",
        "头\n".repeat(6_000),
        "x".repeat(1_100_000),
        "\n尾".repeat(6_000)
    );
    let mapped = map_item(json!({
        "id": "command-a", "type": "commandExecution", "command": "test",
        "cwd": "/tmp", "status": "completed", "aggregatedOutput": output,
        "exitCode": 0
    }))
    .expect("command output should map");
    let value = to_value(mapped).unwrap();
    let retained = value["output"].as_str().unwrap();

    assert!(retained.len() <= 1_048_576);
    assert!(retained.is_char_boundary(retained.len()));
    assert!(value["outputOmitted"]["bytes"].as_u64().unwrap() > 0);
    assert!(value["outputOmitted"]["lines"].as_u64().unwrap() > 0);
}
