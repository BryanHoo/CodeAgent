use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, duplex, split};

use super::{
    AppServerConnection, configure_custom_provider, get_provider_connection, list_provider_models,
    start_official_provider_login,
};

async fn read_provider_connection(config: Value, account: Value) -> Value {
    let (client, server) = duplex(32 * 1024);
    let (client_reader, client_writer) = split(client);
    let (server_reader, mut server_writer) = split(server);
    let connection = AppServerConnection::new(client_reader, client_writer);

    let server_task = tokio::spawn(async move {
        let mut lines = BufReader::new(server_reader).lines();
        for result in [json!({"config": config}), account] {
            let request: Value =
                serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
            server_writer
                .write_all(
                    format!(
                        "{}\n",
                        json!({"id": request["id"].clone(), "result": result})
                    )
                    .as_bytes(),
                )
                .await
                .unwrap();
        }
    });

    let status = get_provider_connection(&connection, None).await.unwrap();
    server_task.await.unwrap();
    status
}

#[tokio::test]
async fn provider_connection_should_detect_selected_custom_provider_without_login() {
    let status = read_provider_connection(
        json!({
            "model_provider": "relay",
            "model_providers": {
                "relay": {"base_url": "https://relay.example/v1"}
            }
        }),
        json!({"account": null, "requiresOpenaiAuth": false}),
    )
    .await;

    assert_eq!(status["mode"], "custom");
    assert_eq!(status["customBaseUrl"], "https://relay.example/v1");
    assert_eq!(status["state"], "connected");
}

#[tokio::test]
async fn provider_connection_should_detect_openai_base_url_override() {
    let status = read_provider_connection(
        json!({
            "model_provider": "openai",
            "openai_base_url": "https://relay.example/v1"
        }),
        json!({"account": {"type": "apiKey"}, "requiresOpenaiAuth": true}),
    )
    .await;

    assert_eq!(status["mode"], "custom");
    assert_eq!(status["customBaseUrl"], "https://relay.example/v1");
    assert_eq!(status["state"], "connected");
}

#[tokio::test]
async fn custom_provider_models_should_restore_page_from_persisted_data() {
    let (client, server) = duplex(32 * 1024);
    let (client_reader, client_writer) = split(client);
    let (server_reader, mut server_writer) = split(server);
    let connection = AppServerConnection::new(client_reader, client_writer);

    let server_task = tokio::spawn(async move {
        let mut lines = BufReader::new(server_reader).lines();
        let request: Value =
            serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
        assert_eq!(request["method"], "config/read");
        server_writer
            .write_all(
                format!(
                    "{}\n",
                    json!({
                        "id": request["id"].clone(),
                        "result": {
                            "config": {
                                "desktop": {
                                    "codeagent": {
                                        "provider": {
                                            "customModels": [{"id": "custom-a"}]
                                        }
                                    }
                                },
                                "model_provider": "codeagent-custom"
                            }
                        }
                    })
                )
                .as_bytes(),
            )
            .await
            .unwrap();
    });

    let models = list_provider_models(&connection).await.unwrap();
    assert_eq!(
        models,
        json!({"data": [{"id": "custom-a"}], "nextCursor": null})
    );
    server_task.await.unwrap();
}

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
        let private_models = custom_config["params"]["edits"]
            .as_array()
            .and_then(|edits| {
                edits
                    .iter()
                    .find(|edit| edit["keyPath"] == "desktop.codeagent.provider")
            })
            .map(|edit| &edit["value"]["customModels"])
            .unwrap();
        // Codex 配置最终写入 TOML，持久化载荷中不能包含 JSON null。
        assert!(private_models.is_array());
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
