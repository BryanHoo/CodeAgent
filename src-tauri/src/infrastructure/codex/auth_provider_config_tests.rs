use std::sync::atomic::{AtomicU64, Ordering};

use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, duplex, split};

use super::{AppServerConnection, configure_custom_provider};

static TEST_ROOT_ID: AtomicU64 = AtomicU64::new(1);

fn test_root() -> std::path::PathBuf {
    let id = TEST_ROOT_ID.fetch_add(1, Ordering::Relaxed);
    std::env::temp_dir().join(format!(
        "codeagent-provider-config-{}-{id}",
        std::process::id()
    ))
}

#[tokio::test]
async fn openai_override_reconnect_should_update_openai_base_url() {
    let root = test_root();
    let (client, server) = duplex(32 * 1024);
    let (client_reader, client_writer) = split(client);
    let (server_reader, mut server_writer) = split(server);
    let connection = AppServerConnection::new(client_reader, client_writer);

    let server_task = tokio::spawn(async move {
        let mut lines = BufReader::new(server_reader).lines();
        let config_read: Value =
            serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
        assert_eq!(config_read["method"], "config/read");
        server_writer
            .write_all(
                format!(
                    "{}\n",
                    json!({
                        "id": config_read["id"].clone(),
                        "result": {
                            "config": {
                                "model_provider": "openai",
                                "openai_base_url": "https://old.example/v1"
                            }
                        }
                    })
                )
                .as_bytes(),
            )
            .await
            .unwrap();

        let config_write: Value =
            serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
        let edits = config_write["params"]["edits"].as_array().unwrap();
        assert!(edits.iter().any(|edit| {
            edit["keyPath"] == "openai_base_url" && edit["value"] == "https://new.example/v1"
        }));
        assert!(edits.iter().all(|edit| edit["keyPath"] != "model_provider"));
        assert!(
            edits
                .iter()
                .all(|edit| edit["keyPath"] != "model_providers.openai")
        );
        server_writer
            .write_all(
                format!(
                    "{}\n",
                    json!({"id": config_write["id"].clone(), "result": {}})
                )
                .as_bytes(),
            )
            .await
            .unwrap();
    });

    configure_custom_provider(
        &connection,
        &root,
        json!({"baseUrl": "https://new.example/v1"}),
    )
    .await
    .unwrap();
    server_task.await.unwrap();
}
