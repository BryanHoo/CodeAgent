use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::Mutex,
    time::{Duration, Instant},
};

use chrono::{TimeZone, Utc};
use code_agent_core::{GitPort, PortRequestContext, RepositoryPort};
use code_agent_platform::{
    AttachmentKind, AttachmentStore, AttachmentUpload, DatabaseOptions, GitCliService,
    PlatformDatabase, ProcessEnvironment, SqliteRepository,
};
use serde_json::Value;

static TEST_LOCK: Mutex<()> = Mutex::new(());

struct TempRoot(PathBuf);

impl TempRoot {
    fn new(label: &str) -> Self {
        let path =
            std::env::temp_dir().join(format!("code-agent-{label}-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&path).expect("temporary root");
        Self(path)
    }
}

impl Drop for TempRoot {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn budgets() -> Value {
    serde_json::from_str(include_str!("../../../tests/performance-budgets.json"))
        .expect("performance budgets")
}

fn budget(value: &Value, section: &str, key: &str) -> u64 {
    value[section][key]
        .as_u64()
        .unwrap_or_else(|| panic!("missing budget {section}.{key}"))
}

#[tokio::test]
#[expect(
    clippy::await_holding_lock,
    reason = "serializes process-wide RSS and wall-clock performance measurements"
)]
async fn attachment_store_should_write_maximum_file_without_copying_input() {
    let _guard = TEST_LOCK.lock().unwrap_or_else(|error| error.into_inner());
    let budgets = budgets();
    let bytes = budget(&budgets, "attachment", "bytes") as usize;
    let input = vec![b'x'; bytes];
    let rss_baseline = resident_set_bytes();
    let root = TempRoot::new("attachment-performance");
    let store = AttachmentStore::new(&root.0).expect("attachment store");

    let started_at = Instant::now();
    let attachment = store
        .add(
            "project-performance",
            AttachmentUpload {
                bytes: input,
                kind: AttachmentKind::File,
                media_type: "application/octet-stream".to_owned(),
                name: "maximum.bin".to_owned(),
            },
        )
        .await
        .expect("maximum attachment");
    let duration = started_at.elapsed();
    let rss_growth = resident_set_bytes().saturating_sub(rss_baseline);

    println!("attachment performance: duration={duration:?}, rss_growth={rss_growth}");
    assert_eq!(attachment.size.get(), bytes as u64);
    assert_eq!(
        fs::metadata(root.0.join(attachment.id.as_str()))
            .expect("stored file")
            .len(),
        bytes as u64
    );
    assert!(duration.as_millis() < budget(&budgets, "attachment", "maxDurationMs") as u128);
    assert!(rss_growth < budget(&budgets, "attachment", "maxRssGrowthBytes"));
}

#[tokio::test]
#[expect(
    clippy::await_holding_lock,
    reason = "serializes process-wide RSS and wall-clock performance measurements"
)]
async fn git_status_should_bound_large_multi_repository_worktree() {
    let _guard = TEST_LOCK.lock().unwrap_or_else(|error| error.into_inner());
    let budgets = budgets();
    let root = TempRoot::new("git-performance");
    let project_root = root.0.join("project");
    fs::create_dir_all(&project_root).expect("project root");
    let repository_count = budget(&budgets, "git", "childRepositories") as usize;
    let change_count = budget(&budgets, "git", "changes") as usize;
    let untracked_count = budget(&budgets, "git", "untrackedFiles") as usize;
    let untracked_bytes = budget(&budgets, "git", "untrackedFileBytes") as usize;
    create_git_fixture(
        &project_root,
        repository_count,
        change_count,
        untracked_count,
        untracked_bytes,
    );

    let database = PlatformDatabase::open(DatabaseOptions {
        path: root.0.join("state.sqlite3"),
        queue_capacity: 8,
        request_timeout: Duration::from_secs(10),
    })
    .await
    .expect("database");
    let registry = SqliteRepository::new(database.clone());
    let project = registry
        .register_project(
            &project_root.to_string_lossy(),
            "Performance",
            Utc.with_ymd_and_hms(2026, 8, 14, 0, 0, 0)
                .single()
                .expect("timestamp"),
            &PortRequestContext::new("register-performance"),
        )
        .await
        .expect("project");
    let service = GitCliService::new(database.clone(), current_process_environment());

    let started_at = Instant::now();
    let status = service
        .status(&project.id, &PortRequestContext::new("git-performance"))
        .await
        .expect("git status");
    let duration = started_at.elapsed();
    let staged = status["staged"].as_array().expect("staged");
    let unstaged = status["unstaged"].as_array().expect("unstaged");
    let diff_bytes = staged
        .iter()
        .chain(unstaged)
        .filter_map(|change| change["diff"].as_str())
        .map(str::len)
        .sum::<usize>();
    let repository_started_at = Instant::now();
    service
        .status_for(
            &project.id,
            Some("repo-00"),
            &PortRequestContext::new("git-repository-performance"),
        )
        .await
        .expect("repository git status");
    let repository_duration = repository_started_at.elapsed();

    println!(
        "git performance: duration={duration:?}, repository_duration={repository_duration:?}, files={}, diff_bytes={diff_bytes}",
        staged.len() + unstaged.len()
    );
    assert_eq!(status["repositoryMode"], "children");
    assert!(staged.len() + unstaged.len() <= budget(&budgets, "git", "maxFiles") as usize);
    assert!(diff_bytes <= budget(&budgets, "git", "maxDiffBytes") as usize);
    assert!(repository_duration.as_millis() < budget(&budgets, "git", "maxDurationMs") as u128);
    assert!(duration.as_millis() < budget(&budgets, "git", "maxStressDurationMs") as u128);
    assert!(
        budget(&budgets, "git", "maxDiffCommands")
            <= budget(&budgets, "git", "maxConcurrentGitCommands")
    );
    database.close().expect("close database");
}

fn create_git_fixture(
    project_root: &Path,
    repositories: usize,
    changes: usize,
    untracked_files: usize,
    untracked_bytes: usize,
) {
    let tracked_per_repository = changes.div_ceil(repositories);
    let untracked_per_repository = untracked_files.div_ceil(repositories);
    let mut tracked_remaining = changes;
    let mut untracked_remaining = untracked_files;
    for index in 0..repositories {
        let repository = project_root.join(format!("repo-{index:02}"));
        fs::create_dir_all(&repository).expect("repository");
        run_git(&repository, &["init", "-q", "-b", "main"]);
        run_git(
            &repository,
            &["config", "user.email", "performance@example.com"],
        );
        run_git(&repository, &["config", "user.name", "Performance Test"]);
        let tracked = tracked_remaining.min(tracked_per_repository);
        for file_index in 0..tracked {
            fs::write(
                repository.join(format!("tracked-{file_index:04}.txt")),
                "initial\n",
            )
            .expect("tracked file");
        }
        run_git(&repository, &["add", "."]);
        run_git(&repository, &["commit", "-q", "-m", "initial"]);
        for file_index in 0..tracked {
            fs::write(
                repository.join(format!("tracked-{file_index:04}.txt")),
                "changed\n",
            )
            .expect("tracked change");
        }
        tracked_remaining -= tracked;
        let untracked = untracked_remaining.min(untracked_per_repository);
        let content = vec![b'u'; untracked_bytes];
        for file_index in 0..untracked {
            fs::write(
                repository.join(format!("untracked-{file_index:04}.txt")),
                &content,
            )
            .expect("untracked file");
        }
        untracked_remaining -= untracked;
    }
}

fn run_git(root: &Path, arguments: &[&str]) {
    let status = Command::new("git")
        .current_dir(root)
        .args(arguments)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .expect("git command");
    assert!(status.success(), "git command failed: {arguments:?}");
}

fn current_process_environment() -> ProcessEnvironment {
    ProcessEnvironment::capture_with_path(std::env::var_os("PATH").unwrap_or_default())
}

#[cfg(unix)]
fn resident_set_bytes() -> u64 {
    let output = Command::new("ps")
        .args(["-o", "rss=", "-p", &std::process::id().to_string()])
        .output()
        .expect("read process RSS");
    let kilobytes = String::from_utf8(output.stdout)
        .expect("RSS output")
        .trim()
        .parse::<u64>()
        .expect("RSS value");
    kilobytes * 1024
}

#[cfg(windows)]
fn resident_set_bytes() -> u64 {
    let output = Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            &format!("(Get-Process -Id {}).WorkingSet64", std::process::id()),
        ])
        .output()
        .expect("read process RSS");
    String::from_utf8(output.stdout)
        .expect("RSS output")
        .trim()
        .parse::<u64>()
        .expect("RSS value")
}
