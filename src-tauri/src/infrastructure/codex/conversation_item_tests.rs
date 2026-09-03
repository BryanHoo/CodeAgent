use serde_json::{Value, json, to_value};

use super::conversation::map_item;

fn absolute_test_path(name: &str) -> String {
    std::env::temp_dir()
        .join(name)
        .to_string_lossy()
        .into_owned()
}

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
fn codex_152_items_should_keep_native_tool_semantics() {
    let function_output = map_item(json!({
        "id": "function-output-a",
        "name": "search",
        "namespace": "docs",
        "output": "found",
        "type": "functionCallOutput",
    }))
    .expect("function output should map");
    let function_output = to_value(function_output).unwrap();
    assert_eq!(function_output["type"], "tool");
    assert_eq!(function_output["name"], "docs/search");
    assert_eq!(function_output["output"], "found");
    assert_eq!(function_output["status"], "completed");

    for (native_tool, mapped_tool) in [
        ("sendMessage", "agent/send_message"),
        ("followupTask", "agent/followup_task"),
        ("interruptAgent", "agent/interrupt"),
        ("listAgents", "agent/list"),
    ] {
        let mapped = map_item(json!({
            "agentsStates": {
                "thread-b": {"message": "done", "status": "completed"},
                "thread-c": {"message": null, "status": "interrupted"}
            },
            "id": format!("collab-{native_tool}"),
            "model": null,
            "prompt": null,
            "reasoningEffort": null,
            "receiverThreadIds": [],
            "senderThreadId": "thread-a",
            "status": "completed",
            "tool": native_tool,
            "type": "collabAgentToolCall",
        }))
        .expect("Codex 0.152 collaboration tool should map");
        let mapped = to_value(mapped).unwrap();
        assert_eq!(mapped["name"], mapped_tool);
        assert_eq!(mapped["output"]["agents"][0]["taskId"], "thread-b");
        assert_eq!(mapped["output"]["agents"][0]["status"], "completed");
        assert_eq!(mapped["output"]["agents"][1]["taskId"], "thread-c");
        assert_eq!(mapped["output"]["agents"][1]["status"], "interrupted");
    }

    let completed = map_item(json!({
        "agentPath": "reviewer",
        "agentThreadId": "thread-b",
        "id": "sub-completed",
        "kind": "completed",
        "type": "subAgentActivity",
    }))
    .expect("completed subagent activity should map");
    let completed = to_value(completed).unwrap();
    assert_eq!(completed["detail"], "已完成");
    assert_eq!(completed["status"], "completed");
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
    let path = absolute_test_path("report.json");
    let mapped = map_item(json!({
        "id": "user-file",
        "type": "userMessage",
        "content": [{
            "text": &path,
            "text_elements": [{
                "byteRange": {"start": 0, "end": path.len()},
                "placeholder": "codexly-file:eyJraW5kIjoiZmlsZSIsIm1lZGlhVHlwZSI6ImFwcGxpY2F0aW9uL2pzb24iLCJuYW1lIjoicmVwb3J0Lmpzb24iLCJzaXplIjoxN30",
            }],
            "type": "text",
        }],
    }))
    .expect("user file should map");
    let value = to_value(mapped).unwrap();

    assert_eq!(value["text"], "");
    assert_eq!(value["attachments"][0]["id"], path);
    assert_eq!(value["attachments"][0]["name"], "report.json");
}

#[test]
fn user_local_audio_should_restore_attachment_identity() {
    let path = absolute_test_path("recording.mp3");
    let mapped = map_item(json!({
        "id": "user-audio",
        "type": "userMessage",
        "content": [{"path": &path, "type": "localAudio"}],
    }))
    .expect("local audio should map");
    let value = to_value(mapped).unwrap();

    assert_eq!(value["text"], "");
    assert_eq!(value["attachments"][0]["id"], path);
    assert_eq!(value["attachments"][0]["kind"], "file");
    assert_eq!(value["attachments"][0]["mediaType"], "audio/mpeg");
    assert_eq!(value["attachments"][0]["name"], "recording.mp3");
}

#[test]
fn user_local_image_should_restore_requested_detail() {
    let path = absolute_test_path("diagram.png");
    let mapped = map_item(json!({
        "id": "user-image",
        "type": "userMessage",
        "content": [{"detail": "high", "path": &path, "type": "localImage"}],
    }))
    .expect("local image should map");
    let value = to_value(mapped).unwrap();

    assert_eq!(value["attachments"][0]["detail"], "high");
}

#[test]
fn completed_image_generation_should_map_to_attachment_metadata_without_base64() {
    let encoded = "iVBORw0KGgo=";
    let path = absolute_test_path("generated.png");
    let mapped = map_item(json!({
        "codeagentAttachment": {
            "id": &path,
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
    assert_eq!(value["attachments"][0]["id"], path);
    assert!(!value.to_string().contains(encoded));
}
