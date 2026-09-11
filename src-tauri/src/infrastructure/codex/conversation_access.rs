use super::{
    agent_settings::read_agent_runtime_settings,
    connection::{AppServerConnection, ConnectionError},
    conversation_commands::resume_task,
    tasks::is_task_loaded,
};

/// 打开任务时确认本地写入权，不发起 Turn，也不加载历史正文。
pub async fn retain_task_writer(
    connection: &AppServerConnection,
    project_id: &str,
    task_id: &str,
) -> Result<(), ConnectionError> {
    let settings = read_agent_runtime_settings(connection).await?;
    // 已载入的线程也必须 resume，重新建立被 unsubscribe 释放的服务端通知订阅。
    match resume_task(connection, project_id, task_id, &settings).await {
        Err(error)
            if matches!(&error, ConnectionError::Request { code: -32600, message }
            if message == &format!("no rollout found for thread id {task_id}")) =>
        {
            // 154 的无 rollout 新线程不能 resume；仅在同一进程确认仍载入时沿用已有写入权。
            if is_task_loaded(connection, project_id, task_id).await? {
                Ok(())
            } else {
                Err(error)
            }
        }
        result => result,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, duplex, split};

    #[tokio::test]
    async fn retaining_a_loaded_thread_should_restore_its_server_subscription() {
        let (client, server) = duplex(8192);
        let (reader, writer) = split(client);
        let connection = AppServerConnection::new(reader, writer);
        let (reader, mut writer) = split(server);
        let peer = tokio::spawn(async move {
            let mut lines = BufReader::new(reader).lines();
            for (method, result) in [
                ("config/read", json!({"config": {}})),
                (
                    "thread/resume",
                    json!({"thread": {"id": "thread-a", "projectId": "project-a"}}),
                ),
            ] {
                let request: Value =
                    serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
                assert_eq!(request["method"], method);
                if method == "thread/resume" {
                    assert_eq!(request["params"]["excludeTurns"], true);
                    assert!(request["params"].get("cwd").is_none());
                }
                writer
                    .write_all(
                        format!("{}\n", json!({"id": request["id"], "result": result})).as_bytes(),
                    )
                    .await
                    .unwrap();
            }
        });
        retain_task_writer(&connection, "project-a", "thread-a")
            .await
            .unwrap();
        peer.await.unwrap();
    }
}
