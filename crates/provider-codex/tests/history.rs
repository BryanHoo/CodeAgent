use std::sync::Arc;

use code_agent_core::{PortRequestContext, ProviderPort};
use code_agent_protocol::Project;
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
                            "section": "unpinned",
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
