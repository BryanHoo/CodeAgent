//! Codex App Server 进程生命周期测试：定位、版本、握手、退出与关闭升级。

use std::path::{Path, PathBuf};
use std::time::Duration;

use code_agent_provider_codex::{
    CodexAppServerOptions, CodexBinarySource, LocateCodexBinaryOptions, SUPPORTED_CODEX_VERSION,
    check_codex_version, locate_codex_binary, start_codex_app_server,
};
use serde_json::json;

fn fake_codex_path() -> PathBuf {
    PathBuf::from(env!("CARGO_BIN_EXE_fake-codex"))
}

fn options_with_scenario(scenario: &serde_json::Value) -> CodexAppServerOptions {
    CodexAppServerOptions {
        app_version: "9.9.9".to_string(),
        binary_path: fake_codex_path(),
        cwd: None,
        env_overrides: vec![("FAKE_CODEX_SCENARIO".to_string(), scenario.to_string())],
        shutdown_timeout: Duration::from_millis(300),
        ..CodexAppServerOptions::default()
    }
}

#[tokio::test]
async fn start_should_handshake_and_round_trip() {
    let scenario = json!({
        "onRequest": {
            "echo/test": [[ { "reply": { "ok": true } } ]]
        }
    });
    let process = start_codex_app_server(options_with_scenario(&scenario))
        .await
        .expect("start fake codex app server");

    let result = process
        .client()
        .request("echo/test", None)
        .await
        .expect("scripted request resolves");
    assert_eq!(result, json!({ "ok": true }));

    process.close().await.expect("close fake codex");
    let exit = process.wait_for_exit().await;
    assert_eq!(exit.code, Some(0));
}

#[tokio::test]
async fn handshake_failure_should_close_process() {
    let scenario = json!({
        "onRequest": {
            "initialize": [[ { "replyError": { "code": 1, "message": "nope" } } ]]
        }
    });

    let result = start_codex_app_server(options_with_scenario(&scenario)).await;
    let Err(error) = result else {
        panic!("handshake failure must propagate");
    };
    assert!(
        error.message().contains("nope"),
        "message: {}",
        error.message()
    );
}

#[tokio::test]
async fn unexpected_exit_should_reject_pending_with_stderr() {
    let scenario = json!({
        "onRequest": {
            "hang/request": [[
                { "stderrLine": "codex exploded" },
                { "sleepMs": 20 },
                { "exit": 3 }
            ]]
        }
    });
    let process = start_codex_app_server(options_with_scenario(&scenario))
        .await
        .expect("start fake codex app server");

    let error = process
        .client()
        .request("hang/request", None)
        .await
        .expect_err("exit must reject pending request");
    let message = error.to_string();
    assert!(message.contains("exited"), "message: {message}");
    assert!(message.contains("codex exploded"), "message: {message}");

    let exit = process.wait_for_exit().await;
    assert_eq!(exit.code, Some(3));
    process
        .close()
        .await
        .expect("close after exit is idempotent");
}

#[cfg(unix)]
#[tokio::test]
async fn close_should_escalate_when_stdin_close_is_ignored() {
    let scenario = json!({ "ignoreStdinClose": true });
    let process = start_codex_app_server(options_with_scenario(&scenario))
        .await
        .expect("start fake codex app server");

    process
        .close()
        .await
        .expect("escalated close must terminate the process");
    let exit = process.wait_for_exit().await;
    assert!(
        exit.code.is_none() || exit.code != Some(0),
        "process must be terminated by signal, exit: {exit:?}"
    );
}

#[tokio::test]
async fn version_check_should_reject_unsupported_version() {
    let error = check_codex_version_with_env(&fake_codex_path(), "0.1.0")
        .await
        .expect_err("unsupported version must fail");
    assert!(
        error.message().contains("Unsupported Codex version"),
        "message: {}",
        error.message()
    );

    let info = check_codex_version_with_env(&fake_codex_path(), SUPPORTED_CODEX_VERSION)
        .await
        .expect("supported version passes");
    assert_eq!(info.version, SUPPORTED_CODEX_VERSION);
}

async fn check_codex_version_with_env(
    path: &Path,
    version: &str,
) -> Result<code_agent_provider_codex::CodexVersionInfo, code_agent_core::CodeAgentError> {
    check_codex_version(
        path,
        &[("FAKE_CODEX_VERSION".to_string(), version.to_string())],
    )
    .await
}

#[test]
fn locate_should_prefer_explicit_then_environment_then_candidates() {
    let fake = fake_codex_path();

    let explicit = locate_codex_binary(&LocateCodexBinaryOptions {
        explicit_path: Some(fake.clone()),
        environment_path: Some(PathBuf::from("/nonexistent/env-codex")),
        candidate_paths: vec![PathBuf::from("/nonexistent/candidate")],
    })
    .expect("explicit path wins");
    assert_eq!(explicit.source, CodexBinarySource::Explicit);
    assert_eq!(explicit.path, fake);

    let environment = locate_codex_binary(&LocateCodexBinaryOptions {
        explicit_path: None,
        environment_path: Some(fake.clone()),
        candidate_paths: vec![PathBuf::from("/nonexistent/candidate")],
    })
    .expect("environment path wins over candidates");
    assert_eq!(environment.source, CodexBinarySource::Environment);

    let candidate = locate_codex_binary(&LocateCodexBinaryOptions {
        explicit_path: None,
        environment_path: None,
        candidate_paths: vec![PathBuf::from("/nonexistent/candidate"), fake.clone()],
    })
    .expect("first existing candidate wins");
    assert_eq!(candidate.source, CodexBinarySource::Candidate);
    assert_eq!(candidate.path, fake);

    let missing = locate_codex_binary(&LocateCodexBinaryOptions {
        explicit_path: None,
        environment_path: None,
        candidate_paths: vec![PathBuf::from("/nonexistent/candidate")],
    })
    .expect_err("no binary available");
    assert!(missing.message().contains("Codex binary was not found"));
}

#[cfg(unix)]
#[test]
fn locate_should_reject_non_executable_explicit_path() {
    let directory =
        std::env::temp_dir().join(format!("code-agent-codex-test-{}", std::process::id()));
    std::fs::create_dir_all(&directory).expect("create temp directory");
    let file = directory.join("codex");
    std::fs::write(&file, b"#!/bin/sh\n").expect("write placeholder");
    let mut permissions = std::fs::metadata(&file)
        .expect("stat placeholder")
        .permissions();
    use std::os::unix::fs::PermissionsExt;
    permissions.set_mode(0o644);
    std::fs::set_permissions(&file, permissions).expect("clear executable bit");

    let error = locate_codex_binary(&LocateCodexBinaryOptions {
        explicit_path: Some(file),
        environment_path: None,
        candidate_paths: Vec::new(),
    })
    .expect_err("non-executable file must be rejected");
    assert!(error.message().contains("not executable"));

    std::fs::remove_dir_all(&directory).expect("cleanup temp directory");
}
