use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, duplex, split};

use super::{AppServerConnection, get_global_settings, update_global_settings};

#[tokio::test]
async fn global_settings_should_read_effective_config_and_write_atomically() {
    let (client, server) = duplex(32 * 1024);
    let (client_reader, client_writer) = split(client);
    let (server_reader, mut server_writer) = split(server);
    let connection = AppServerConnection::new(client_reader, client_writer);

    let server_task = tokio::spawn(async move {
        let mut lines = BufReader::new(server_reader).lines();
        let read: Value = serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
        assert_eq!(read["method"], "config/read");
        let config = json!({
            "model": "gpt-test", "model_reasoning_effort": "medium",
            "approval_policy": "never", "approvals_reviewer": "auto_review",
            "sandbox_mode": "read-only", "features": {"fast_mode": true},
            "desktop": {"codeagent": {"global": {
                "commitMessageModel": "gpt-commit", "commitMessagePrompt": "Summarize",
                "followUpBehavior": "steer", "pet": {"enabled": true}
            }}}
        });
        server_writer.write_all(format!("{}\n", json!({"id": read["id"].clone(), "result": {"config": config, "origins": {}, "layers": null}})).as_bytes()).await.unwrap();

        let write: Value =
            serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
        assert_eq!(write["method"], "config/batchWrite");
        assert_eq!(write["params"]["reloadUserConfig"], true);
        let edits = write["params"]["edits"].as_array().unwrap();
        assert!(
            edits
                .iter()
                .any(|edit| edit["keyPath"] == "model" && edit["value"] == "gpt-next")
        );
        assert!(
            edits
                .iter()
                .any(|edit| edit["keyPath"] == "desktop.codeagent.global")
        );
        let private = &edits
            .iter()
            .find(|edit| edit["keyPath"] == "desktop.codeagent.global")
            .unwrap()["value"];
        assert_eq!(private.get("defaultOpenAppId"), None);
        assert_eq!(private["pet"].get("selectedPetId"), None);
        server_writer
            .write_all(format!("{}\n", json!({"id": write["id"].clone(), "result": {}})).as_bytes())
            .await
            .unwrap();
    });

    let current = get_global_settings(&connection).await.unwrap();
    assert_eq!(current["settings"]["model"], "gpt-test");
    assert_eq!(current["settings"]["fastMode"], true);
    assert_eq!(current["settings"]["followUpBehavior"], "steer");
    assert_eq!(current["settings"]["defaultOpenAppId"], Value::Null);
    assert_eq!(
        current["settings"]["pet"],
        json!({"enabled": true, "selectedPetId": null})
    );

    let mut next = current["settings"].clone();
    next["model"] = json!("gpt-next");
    let updated = update_global_settings(&connection, next.clone())
        .await
        .unwrap();
    assert_eq!(updated["settings"], next);
    server_task.await.unwrap();
}
