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

#[test]
fn user_file_should_restore_attachment_without_exposing_its_path_as_text() {
    let mapped = map_item(json!({
        "id": "user-file",
        "type": "userMessage",
        "content": [{
            "text": "/tmp/report.json",
            "text_elements": [{
                "byteRange": {"start": 0, "end": 16},
                "placeholder": "codexly-file:eyJraW5kIjoiZmlsZSIsIm1lZGlhVHlwZSI6ImFwcGxpY2F0aW9uL2pzb24iLCJuYW1lIjoicmVwb3J0Lmpzb24iLCJzaXplIjoxN30",
            }],
            "type": "text",
        }],
    }))
    .expect("user file should map");
    let value = to_value(mapped).unwrap();

    assert_eq!(value["text"], "");
    assert_eq!(value["attachments"][0]["id"], "/tmp/report.json");
    assert_eq!(value["attachments"][0]["name"], "report.json");
}

#[test]
fn completed_image_generation_should_map_to_attachment_metadata_without_base64() {
    let encoded = "iVBORw0KGgo=";
    let mapped = map_item(json!({
        "codeagentAttachment": {
            "id": "/tmp/generated.png",
            "kind": "image",
            "mediaType": "image/png",
            "name": "generated-image.png",
            "size": 8,
        },
        "failure": null,
        "id": "image-a",
        "result": encoded,
        "revisedPrompt": "diagram",
        "status": "completed",
        "type": "imageGeneration",
    }))
    .expect("generated image should map");
    let value = to_value(mapped).unwrap();

    assert_eq!(value["type"], "message");
    assert_eq!(value["role"], "assistant");
    assert_eq!(value["attachments"][0]["id"], "/tmp/generated.png");
    assert!(!value.to_string().contains(encoded));
}
