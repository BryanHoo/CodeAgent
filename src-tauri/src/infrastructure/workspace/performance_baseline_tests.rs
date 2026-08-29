use std::{
    fs,
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, Instant, SystemTime},
};

use super::{ProjectFileSearch, read_source_file};

const SEARCH_FILE_COUNT: usize = 5_000;

fn test_root(label: &str) -> PathBuf {
    let unique = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .expect("system time should be available")
        .as_nanos();
    std::env::temp_dir().join(format!("codeagent-performance-{label}-{unique}"))
}

fn create_search_fixture(root: &Path) {
    for index in 0..SEARCH_FILE_COUNT {
        let directory = root.join(format!("module-{:02}", index % 50));
        fs::create_dir_all(&directory).expect("fixture directory should be created");
        fs::write(
            directory.join(format!("performance-target-{index:05}.rs")),
            "fn measured() {}\n",
        )
        .expect("fixture file should be created");
    }
}

fn percentile(samples: &[Duration], ratio: f64) -> f64 {
    let mut micros = samples
        .iter()
        .map(|duration| duration.as_secs_f64() * 1_000.0)
        .collect::<Vec<_>>();
    micros.sort_unstable_by(f64::total_cmp);
    let index = ((micros.len() as f64 * ratio).ceil() as usize)
        .saturating_sub(1)
        .min(micros.len().saturating_sub(1));
    micros.get(index).copied().unwrap_or(0.0)
}

async fn read_all_source(root: &Path, relative: &str) {
    let mut cursor = None;
    loop {
        let page = read_source_file(root, relative, cursor)
            .await
            .expect("source page should load");
        cursor = page.next_cursor;
        if cursor.is_none() {
            break;
        }
    }
}

#[tokio::test]
#[ignore = "manual performance baseline"]
async fn performance_baseline_file_search() {
    let root = test_root("search");
    create_search_fixture(&root);
    let root = fs::canonicalize(root).expect("fixture root should resolve");
    let search = Arc::new(ProjectFileSearch::default());

    let mut cold = Vec::with_capacity(20);
    let mut warm = Vec::with_capacity(50);
    for iteration in 0..20 {
        search.invalidate(&root);
        let started = Instant::now();
        search
            .search(&root, "root-a", "target", &format!("cold-{iteration}"))
            .await
            .expect("cold search should complete");
        cold.push(started.elapsed());
    }
    for iteration in 0..50 {
        let started = Instant::now();
        search
            .search(&root, "root-a", "target", &format!("warm-{iteration}"))
            .await
            .expect("warm search should complete");
        warm.push(started.elapsed());
    }

    let mut cancellation = Vec::with_capacity(10);
    for iteration in 0..10 {
        search.invalidate(&root);
        let search_task = Arc::clone(&search);
        let task_root = root.clone();
        let session_id = format!("cancel-{iteration}");
        let task_session_id = session_id.clone();
        let task = tokio::spawn(async move {
            search_task
                .search(&task_root, "root-a", "target", &task_session_id)
                .await
        });
        tokio::time::sleep(Duration::from_millis(1)).await;
        let started = Instant::now();
        search.cancel(&session_id);
        task.await
            .expect("cancelled search task should join")
            .expect("cancelled search should return cleanly");
        cancellation.push(started.elapsed());
    }

    println!(
        "PERFORMANCE_BASELINE {{\"benchmark\":\"file_search\",\"coldP50Ms\":{:.3},\"coldP95Ms\":{:.3},\"warmP50Ms\":{:.3},\"warmP95Ms\":{:.3},\"cancelP50Ms\":{:.3},\"cancelP95Ms\":{:.3}}}",
        percentile(&cold, 0.50),
        percentile(&cold, 0.95),
        percentile(&warm, 0.50),
        percentile(&warm, 0.95),
        percentile(&cancellation, 0.50),
        percentile(&cancellation, 0.95),
    );
    fs::remove_dir_all(root).expect("fixture root should be removed");
}

#[tokio::test]
#[ignore = "manual performance baseline"]
async fn performance_baseline_source_read() {
    let root = test_root("source");
    fs::create_dir_all(&root).expect("fixture root should be created");
    fs::write(root.join("source-256k.rs"), vec![b'a'; 256 * 1_024])
        .expect("256 KiB fixture should be written");
    fs::write(root.join("source-2m.rs"), vec![b'a'; 2 * 1_024 * 1_024])
        .expect("2 MiB fixture should be written");
    let root = fs::canonicalize(root).expect("fixture root should resolve");

    for (name, bytes) in [
        ("source-256k.rs", 256 * 1_024),
        ("source-2m.rs", 2 * 1_024 * 1_024),
    ] {
        let mut samples = Vec::with_capacity(50);
        for _ in 0..50 {
            let started = Instant::now();
            read_all_source(&root, name).await;
            samples.push(started.elapsed());
        }
        println!(
            "PERFORMANCE_BASELINE {{\"benchmark\":\"source_read\",\"bytes\":{bytes},\"p50Ms\":{:.3},\"p95Ms\":{:.3}}}",
            percentile(&samples, 0.50),
            percentile(&samples, 0.95),
        );
    }
    fs::remove_dir_all(root).expect("fixture root should be removed");
}
