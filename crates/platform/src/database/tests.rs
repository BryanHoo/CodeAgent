use std::{
    fs,
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
    time::Duration,
};


use super::{DatabaseOptions, PlatformDatabase, PlatformError};

fn temporary_database_path(name: &str) -> PathBuf {
    let directory = std::env::temp_dir().join(format!(
        "code-agent-platform-{name}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock must follow unix epoch")
            .as_nanos()
    ));
    fs::create_dir_all(&directory).expect("temporary database directory must be created");
    directory.join("state.sqlite3")
}

#[tokio::test(flavor = "current_thread")]
async fn database_call_should_not_block_tokio_worker() {
    let directory = std::env::temp_dir().join(format!(
        "code-agent-platform-async-call-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock must follow unix epoch")
            .as_nanos()
    ));
    fs::create_dir_all(&directory).expect("temporary database directory must be created");
    let database = PlatformDatabase::open_deferred(DatabaseOptions {
        path: directory.join("state.sqlite3"),
        queue_capacity: 4,
        request_timeout: Duration::from_secs(2),
    })
    .expect("database must open");
    let timer_fired = Arc::new(AtomicBool::new(false));

    let database_operation = async {
        database
            .call(|_| {
                std::thread::sleep(Duration::from_millis(100));
                Ok(())
            })
            .await
            .expect("database operation must succeed");
        assert!(
            timer_fired.load(Ordering::Acquire),
            "Tokio timer must run while the database owner thread is busy"
        );
    };
    let timer = async {
        tokio::time::sleep(Duration::from_millis(10)).await;
        timer_fired.store(true, Ordering::Release);
    };

    tokio::join!(database_operation, timer);
    database.close().expect("database must close cleanly");
    fs::remove_dir_all(directory).expect("temporary database directory must be removed");
}

#[tokio::test(flavor = "current_thread")]
async fn timed_out_queued_job_should_not_execute() {
    let path = temporary_database_path("timeout-queued");
    let database = PlatformDatabase::open(DatabaseOptions {
        path: path.clone(),
        queue_capacity: 1,
        request_timeout: Duration::from_millis(100),
    })
    .await
    .expect("database must open");
    let executed = Arc::new(AtomicBool::new(false));

    let blocking = tokio::spawn({
        let database = database.clone();
        async move {
            database
                .call(|_| {
                    std::thread::sleep(Duration::from_millis(400));
                    Ok(())
                })
                .await
        }
    });
    tokio::time::sleep(Duration::from_millis(20)).await;

    let executed_for_queued = Arc::clone(&executed);
    let queued = database
        .call(move |_| {
            executed_for_queued.store(true, Ordering::Release);
            Ok(())
        })
        .await;
    assert!(matches!(queued, Err(PlatformError::Timeout)));

    let blocking_result = blocking.await.expect("blocking job must finish");
    assert!(matches!(blocking_result, Err(PlatformError::Timeout)));
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert!(
        !executed.load(Ordering::Acquire),
        "queued job must be skipped after caller timeout"
    );

    database.close().expect("database must close cleanly");
    fs::remove_dir_all(path.parent().expect("database must have parent"))
        .expect("temporary database directory must be removed");
}

#[tokio::test(flavor = "current_thread")]
async fn timed_out_running_query_should_be_interrupted() {
    let path = temporary_database_path("timeout-running");
    let database = PlatformDatabase::open(DatabaseOptions {
        path: path.clone(),
        queue_capacity: 1,
        request_timeout: Duration::from_millis(100),
    })
    .await
    .expect("database must open");
    let completed = Arc::new(AtomicBool::new(false));

    let result = database
        .call({
            let completed = Arc::clone(&completed);
            move |connection| {
                connection.execute_batch(
                    "WITH RECURSIVE cnt(x) AS (
                       SELECT 1
                       UNION ALL
                       SELECT x + 1 FROM cnt WHERE x < 50000000
                     )
                     SELECT count(*) FROM cnt;",
                )?;
                completed.store(true, Ordering::Release);
                Ok(())
            }
        })
        .await;
    assert!(matches!(result, Err(PlatformError::Timeout)));
    assert!(
        !completed.load(Ordering::Acquire),
        "timed out query must not finish after caller timeout"
    );

    database
        .call(|connection| {
            connection.execute_batch(
                "CREATE TABLE IF NOT EXISTS timeout_marker (value INTEGER NOT NULL) STRICT;
                 INSERT INTO timeout_marker (value) VALUES (1);",
            )?;
            Ok(())
        })
        .await
        .expect("follow-up write must succeed quickly after interruption");

    database.close().expect("database must close cleanly");
    fs::remove_dir_all(path.parent().expect("database must have parent"))
        .expect("temporary database directory must be removed");
}

#[tokio::test(flavor = "current_thread")]
async fn timed_out_jobs_should_not_block_subsequent_requests() {
    let path = temporary_database_path("timeout-drain");
    let database = PlatformDatabase::open(DatabaseOptions {
        path: path.clone(),
        queue_capacity: 4,
        request_timeout: Duration::from_millis(100),
    })
    .await
    .expect("database must open");
    let executed = Arc::new(AtomicUsize::new(0));

    let blocking = tokio::spawn({
        let database = database.clone();
        async move {
            database
                .call(|_| {
                    std::thread::sleep(Duration::from_millis(300));
                    Ok(())
                })
                .await
        }
    });
    tokio::time::sleep(Duration::from_millis(20)).await;

    let mut queued = Vec::new();
    for _ in 0..3 {
        let database = database.clone();
        let executed = Arc::clone(&executed);
        queued.push(tokio::spawn(async move {
            database
                .call(move |_| {
                    executed.fetch_add(1, Ordering::AcqRel);
                    Ok(())
                })
                .await
        }));
    }
    for handle in queued {
        let result = handle.await.expect("queued job must finish awaiting");
        assert!(matches!(result, Err(PlatformError::Timeout)));
    }

    let blocking_result = blocking.await.expect("blocking job must finish");
    assert!(matches!(blocking_result, Err(PlatformError::Timeout)));
    tokio::time::sleep(Duration::from_millis(250)).await;
    assert_eq!(
        executed.load(Ordering::Acquire),
        0,
        "expired queued jobs must be dropped before execution"
    );

    let value = database
        .call(|_| Ok(42))
        .await
        .expect("database worker must remain available after timed out jobs");
    assert_eq!(value, 42);

    database.close().expect("database must close cleanly");
    fs::remove_dir_all(path.parent().expect("database must have parent"))
        .expect("temporary database directory must be removed");
}
