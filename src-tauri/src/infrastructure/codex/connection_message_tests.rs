use std::time::Duration;

use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, duplex, split};

use super::connection::AppServerConnection;

#[tokio::test]
async fn server_request_id_should_not_consume_client_response() {
    let (client, server) = duplex(4096);
    let (client_reader, client_writer) = split(client);
    let (server_reader, mut server_writer) = split(server);
    let connection = AppServerConnection::new(client_reader, client_writer);

    let server_task = tokio::spawn(async move {
        let mut lines = BufReader::new(server_reader).lines();
        let request: Value = serde_json::from_str(
            &lines
                .next_line()
                .await
                .expect("server should read request")
                .expect("client request should exist"),
        )
        .expect("client request should be JSON");
        let id = &request["id"];
        let messages = format!(
            "{{\"id\":{id},\"method\":\"item/tool/requestUserInput\",\"params\":{{}}}}\n{{\"id\":{id},\"result\":{{\"value\":\"client-response\"}}}}\n"
        );
        server_writer
            .write_all(messages.as_bytes())
            .await
            .expect("server should write messages");
    });

    let result: Value = connection
        .request("test/collision", &json!({}), Duration::from_secs(1))
        .await
        .expect("server request must not consume the client response");

    assert_eq!(result["value"], "client-response");
    server_task.await.expect("fake server should finish");
}
