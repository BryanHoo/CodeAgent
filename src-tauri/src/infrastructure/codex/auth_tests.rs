use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, duplex, split};

use super::{AppServerConnection, configure_custom_provider, start_official_provider_login};

#[tokio::test]
async fn provider_login_should_keep_secrets_out_of_config_payloads() {
    let (client, server) = duplex(32 * 1024);
    let (client_reader, client_writer) = split(client);
    let (server_reader, mut server_writer) = split(server);
    let connection = AppServerConnection::new(client_reader, client_writer);

    let server_task = tokio::spawn(async move {
        let mut lines = BufReader::new(server_reader).lines();
        let official_config: Value =
            serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
        assert_eq!(official_config["method"], "config/batchWrite");
        server_writer
            .write_all(
                format!(
                    "{}\n",
                    json!({"id": official_config["id"].clone(), "result": {}})
                )
                .as_bytes(),
            )
            .await
            .unwrap();

        let official_login: Value =
            serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
        assert_eq!(official_login["method"], "account/login/start");
        assert_eq!(official_login["params"]["type"], "chatgpt");
        server_writer.write_all(format!("{}\n", json!({"id": official_login["id"].clone(), "result": {"type": "chatgpt", "loginId": "login-a", "authUrl": "https://auth.example/login"}})).as_bytes()).await.unwrap();

        let custom_config: Value =
            serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
        assert_eq!(custom_config["method"], "config/batchWrite");
        assert!(!custom_config.to_string().contains("secret-key"));
        server_writer
            .write_all(
                format!(
                    "{}\n",
                    json!({"id": custom_config["id"].clone(), "result": {}})
                )
                .as_bytes(),
            )
            .await
            .unwrap();

        let api_login: Value =
            serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
        assert_eq!(api_login["method"], "account/login/start");
        assert_eq!(api_login["params"]["apiKey"], "secret-key");
        server_writer
            .write_all(
                format!(
                    "{}\n",
                    json!({"id": api_login["id"].clone(), "result": {"type": "apiKey"}})
                )
                .as_bytes(),
            )
            .await
            .unwrap();
    });

    let official = start_official_provider_login(&connection).await.unwrap();
    assert_eq!(official["loginId"], "login-a");
    let custom = configure_custom_provider(
        &connection,
        json!({"apiKey": "secret-key", "baseUrl": "https://api.example/v1", "models": [{"id": "custom-a", "name": "Custom A"}]}),
    )
    .await
    .unwrap();
    assert_eq!(custom["models"]["data"][0]["id"], "custom-a");
    server_task.await.unwrap();
}
