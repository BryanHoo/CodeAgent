use std::sync::Arc;
use std::time::Duration;

use code_agent_core::{PortRequestContext, ProviderPort};
use code_agent_protocol::Project;
use code_agent_provider_codex::{CodexRuntimeProvider, JsonlRpcClient, JsonlRpcClientOptions};
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, DuplexStream, duplex};

use crate::platform_adapters::DesktopProvider;

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

fn native_thread() -> Value {
    json!({
        "createdAt": 1_754_956_800,
        "cwd": "/workspace",
        "id": "task-1",
        "name": null,
        "preview": "恢复任务",
        "section": null,
        "updatedAt": 1_754_956_800
    })
}

#[test]
fn runtime_readiness_starts_as_starting() {
    let provider = DesktopProvider::default();

    assert_eq!(provider.readiness().state, "starting");
}

#[test]
fn runtime_readiness_hides_internal_failure_details() {
    let provider = DesktopProvider::default();
    provider.fail("private stderr and host path");

    assert_eq!(
        serde_json::to_value(provider.readiness()).expect("serialize Runtime readiness"),
        serde_json::json!({ "state": "failed" })
    );
}

#[tokio::test]
async fn provider_replacement_restores_projects_tasks_and_event_subscriptions() {
    let provider_slot = DesktopProvider::default();
    let (first_runtime, first_server) = runtime();
    provider_slot
        .install(first_runtime)
        .await
        .expect("install first provider");
    let project_provider = provider_slot
        .for_project(project(), &PortRequestContext::new("project"))
        .await
        .expect("project provider");
    let (read, mut write) = tokio::io::split(first_server);
    let mut read = BufReader::new(read);
    let start = tokio::spawn(async move {
        let request = read_frame(&mut read).await;
        assert_eq!(request["method"], "thread/start");
        respond(&mut write, &request, json!({ "thread": native_thread() })).await;
    });
    project_provider
        .start_task(json!({}), &PortRequestContext::new("start"))
        .await
        .expect("start tracked task");
    start.await.expect("start scenario");
    let mut events = project_provider
        .subscribe_events(false, &PortRequestContext::new("events"))
        .await
        .expect("subscribe events");

    provider_slot.fail("first process exited");
    let (second_runtime, second_server) = runtime();
    let (read, mut write) = tokio::io::split(second_server);
    let mut read = BufReader::new(read);
    let recovery = tokio::spawn(async move {
        let request = read_frame(&mut read).await;
        assert_eq!(request["method"], "thread/resume");
        assert_eq!(request["params"]["threadId"], "task-1");
        respond(&mut write, &request, json!({ "thread": native_thread() })).await;
        write
            .write_all(
                format!(
                    "{}\n",
                    json!({
                        "method": "item/agentMessage/delta",
                        "params": {
                            "delta": "restored",
                            "itemId": "message-1",
                            "threadId": "task-1",
                            "turnId": "turn-1"
                        }
                    })
                )
                .as_bytes(),
            )
            .await
            .expect("restored notification");
    });
    provider_slot
        .install(second_runtime)
        .await
        .expect("install replacement provider");

    let event = tokio::time::timeout(Duration::from_secs(1), events.recv())
        .await
        .expect("event timeout")
        .expect("restored event");
    assert_eq!(event.event_type(), "message.delta");
    recovery.await.expect("recovery scenario");
}
