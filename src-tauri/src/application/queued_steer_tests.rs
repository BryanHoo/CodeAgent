use super::*;
use serde_json::json;
use std::sync::atomic::{AtomicUsize, Ordering};

fn request() -> QueuedSteerRequest {
    QueuedSteerRequest {
        project_id: "project".into(),
        task_id: "task".into(),
        turn_id: "turn".into(),
        input: AgentPromptInput::text("hello"),
        idempotency_key: "key".into(),
        queued_submission_id: "queue".into(),
    }
}

#[tokio::test]
async fn queued_steer_should_retry_only_delete_on_native_transport() {
    use crate::infrastructure::codex;
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, duplex, split};
    let (client, server) = duplex(8192);
    let (reader, writer) = split(client);
    let connection = Arc::new(codex::AppServerConnection::new(reader, writer));
    let (reader, mut writer) = split(server);
    let peer = tokio::spawn(async move {
        let mut lines = BufReader::new(reader).lines();
        for (index, method) in ["turn/steer", "thread/queue/delete", "thread/queue/delete"]
            .into_iter()
            .enumerate()
        {
            let request: Value =
                serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
            assert_eq!(request["method"], method);
            assert_eq!(request["params"]["threadId"], "task");
            if index > 0 {
                assert_eq!(request["params"]["queuedSubmissionId"], "queue");
            }
            let response = match index {
                0 => json!({"id":request["id"], "result":{"turnId":"turn"}}),
                1 => json!({"id":request["id"], "error":{"code":-32000,"message":"delete failed"}}),
                // 重试时队列项已不存在也视为清理完成。
                _ => json!({"id":request["id"], "result":{"deleted":false}}),
            };
            writer
                .write_all(format!("{response}\n").as_bytes())
                .await
                .unwrap();
        }
        assert!(lines.next_line().await.unwrap().is_none());
    });
    let registry = Arc::new(TurnStartRegistry::default());
    let budget = SubmissionBudget::default();
    for attempt in 0..2 {
        let steer_connection = connection.clone();
        let cleanup_connection = connection.clone();
        let result = run(
            registry.clone(),
            &budget,
            request(),
            move |input| async move {
                let result =
                    codex::steer_turn(&steer_connection, "task".into(), "turn".into(), input)
                        .await
                        .map_err(AppError::from)?;
                serde_json::to_value(result).map_err(|_| AppError::CodexRequestFailed)
            },
            move || async move {
                codex::delete_queued_submission(&cleanup_connection, "task", "queue")
                    .await
                    .map_err(AppError::from)?;
                Ok(())
            },
        )
        .await;
        assert_eq!(result.is_ok(), attempt == 1);
    }
    drop(connection);
    peer.await.unwrap();
}

#[tokio::test]
async fn queued_steer_should_retry_cleanup_without_repeating_accepted_steer() {
    let registry = Arc::new(TurnStartRegistry::default());
    let budget = SubmissionBudget::default();
    let steers = Arc::new(AtomicUsize::new(0));
    for attempt in 0..2 {
        let calls = Arc::clone(&steers);
        let result = run(
            Arc::clone(&registry),
            &budget,
            request(),
            move |_| async move {
                calls.fetch_add(1, Ordering::SeqCst);
                Ok(json!({"status":"accepted"}))
            },
            move || async move {
                if attempt == 0 {
                    Err(AppError::CodexRequestFailed)
                } else {
                    Ok(())
                }
            },
        )
        .await;
        assert_eq!(result.is_ok(), attempt == 1);
        if attempt == 0 {
            assert_eq!(result.unwrap_err()["code"], "QUEUE_CLEANUP_FAILED");
        }
    }
    assert_eq!(steers.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn queued_steer_should_not_cleanup_rejected_input() {
    let result = run(
        Arc::default(),
        &SubmissionBudget::default(),
        request(),
        |_| async { Err(AppError::CodexRequestFailed) },
        || async { panic!("rejected input must remain queued") },
    )
    .await;
    assert!(result.is_err());
}

#[tokio::test]
async fn queued_steer_should_bind_queue_turn_and_input_to_key() {
    let registry = Arc::new(TurnStartRegistry::default());
    let budget = SubmissionBudget::default();
    run(
        registry.clone(),
        &budget,
        request(),
        |_| async { Ok(json!({})) },
        || async { Ok(()) },
    )
    .await
    .unwrap();
    for field in 0..3 {
        let mut changed = request();
        match field {
            0 => changed.queued_submission_id = "another-queue".into(),
            1 => changed.turn_id = "another-turn".into(),
            _ => changed.input = AgentPromptInput::text("different"),
        }
        let error = run(
            registry.clone(),
            &budget,
            changed,
            |_| async { panic!("conflict must not steer") },
            || async { panic!("conflict must not delete") },
        )
        .await
        .unwrap_err();
        assert_eq!(error["code"], "IDEMPOTENCY_CONFLICT");
    }
}

#[tokio::test]
async fn queued_steer_should_finish_cleanup_after_caller_cancellation() {
    let entered = Arc::new(tokio::sync::Notify::new());
    let release = Arc::new(tokio::sync::Notify::new());
    let (finished, done) = tokio::sync::oneshot::channel();
    let worker_entered = entered.clone();
    let worker_release = release.clone();
    let caller = tokio::spawn(async move {
        run(
            Arc::default(),
            &SubmissionBudget::default(),
            request(),
            |_| async { Ok(json!({})) },
            move || async move {
                worker_entered.notify_one();
                worker_release.notified().await;
                finished.send(()).unwrap();
                Ok(())
            },
        )
        .await
    });
    entered.notified().await;
    caller.abort();
    release.notify_one();
    tokio::time::timeout(std::time::Duration::from_secs(1), done)
        .await
        .unwrap()
        .unwrap();
}

#[tokio::test]
async fn queued_steer_should_reject_invalid_queue_identity_before_execution() {
    for id in [String::new(), "x".repeat(1025)] {
        let mut invalid = request();
        invalid.queued_submission_id = id;
        let error = run(
            Arc::default(),
            &SubmissionBudget::default(),
            invalid,
            |_| async { panic!("invalid input must not steer") },
            || async { panic!("invalid input must not delete") },
        )
        .await
        .unwrap_err();
        assert_eq!(error["code"], "INVALID_REQUEST");
    }
}
