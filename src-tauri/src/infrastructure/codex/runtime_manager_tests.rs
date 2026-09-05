use super::runtime_discovery::private_codex_binary_path;
use super::runtime_manager::distribution_for;
use std::path::Path;

#[test]
fn runtime_download_should_prefer_the_domestic_mirror_on_every_platform() {
    for (os, arch) in [
        ("macos", "aarch64"),
        ("linux", "aarch64"),
        ("linux", "x86_64"),
        ("windows", "aarch64"),
        ("windows", "x86_64"),
    ] {
        let distribution = distribution_for(os, arch).unwrap();
        assert!(
            distribution
                .url
                .starts_with("https://registry.npmmirror.com/"),
            "unexpected primary download URL: {}",
            distribution.url
        );
    }
}
#[test]
fn private_runtime_should_use_the_provider_version_directory() {
    assert_eq!(
        private_codex_binary_path(Path::new("/application-data")),
        Path::new("/application-data/providers/codex/bin/0.153.4/bin")
            .join(format!("codex{}", std::env::consts::EXE_SUFFIX))
    );
}

#[test]
fn distribution_should_be_fixed_to_the_official_supported_package() {
    let cases = [
        (
            "macos",
            "aarch64",
            "aarch64-apple-darwin",
            "darwin-arm64",
            "B1qhN3fa1ay0R0wGziXqgwSkB5icpYChNKHhtBHff/0UtSTC7z+l8aTtvMlGjH3E8HEvY3+njIJelM9CAAoVWg==",
        ),
        (
            "linux",
            "aarch64",
            "aarch64-unknown-linux-musl",
            "linux-arm64",
            "QKdjYLYV4hXIuUQDP3P6F4NXuWFoKo9WUoV4nAREIx55kiUyi8UsYdsVobkeXir5n/maEQgYMCKLHVma4rNPiw==",
        ),
        (
            "linux",
            "x86_64",
            "x86_64-unknown-linux-musl",
            "linux-x64",
            "x1EcwBlY3AObM1VTUHNM2AzAJQsyreGdagpF+qFiYi/Oa30VBktvvG0C6tLtCzqW6hjZNWkGZQWmeVk7MuJKWg==",
        ),
        (
            "windows",
            "aarch64",
            "aarch64-pc-windows-msvc",
            "win32-arm64",
            "/FBh42976ltF1kxDoPQBg1Q6+hwChRU5/sm5dfeC8kFVQMvOCGoGeY5d8rRZGVJE8XojlXo74VQb0sHowcfgBw==",
        ),
        (
            "windows",
            "x86_64",
            "x86_64-pc-windows-msvc",
            "win32-x64",
            "lMkB43kJZH0VFr+hoXc11qqR7QtQIbkr07ALgj4urKL1osNyUyuy1iXd3Vzz2iCYvBUCSw7I0l/W1cEPGx9euQ==",
        ),
    ];

    for (os, arch, target, package_suffix, integrity) in cases {
        let distribution = distribution_for(os, arch).unwrap();
        assert_eq!(distribution.target, target);
        assert_eq!(
            distribution.fallback_url,
            format!(
                "https://registry.npmjs.org/@openai/codex/-/codex-0.153.4-{package_suffix}.tgz"
            )
        );
        assert_eq!(distribution.integrity, integrity);
    }
}

#[test]
fn macos_intel_runtime_should_not_be_supported() {
    assert!(distribution_for("macos", "x86_64").is_none());
}

#[cfg(unix)]
mod private_runtime {
    use super::super::runtime_manager::{inspect_codex_runtime, install_codex_runtime};
    use super::*;
    use crate::domain::runtime::CodexRuntimeAvailabilityStatus as Status;
    use std::os::unix::fs::PermissionsExt;

    fn fixture() -> std::path::PathBuf {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("codeagent-private-runtime-{unique}"))
    }

    fn binary(path: &Path, version: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, format!("#!/bin/sh\necho 'codex-cli {version}'\n")).unwrap();
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
    }

    #[tokio::test]
    async fn startup_should_attempt_private_install_and_report_filesystem_failure() {
        let root = fixture();
        std::fs::write(&root, "blocks application data directory").unwrap();
        let events = std::sync::Mutex::new(Vec::new());
        let state = crate::application::state::AppState::default();
        let result = state
            .inspect_codex(&root, |event| events.lock().unwrap().push(event))
            .await;
        assert_eq!(result.status, Status::Failed);
        let events = events.lock().unwrap();
        assert_eq!(
            events.first().map(|event| event.phase),
            Some(crate::domain::runtime::CodexRuntimeInstallPhase::Preparing)
        );
        assert_eq!(
            events.last().map(|event| event.phase),
            Some(crate::domain::runtime::CodexRuntimeInstallPhase::Failed)
        );
        std::fs::remove_file(root).unwrap();
    }

    #[tokio::test]
    async fn inspection_should_ignore_active_manifest_redirects() {
        let root = fixture();
        let alternate = root.join("providers/codex/bin/alternate/bin/codex");
        binary(&alternate, "0.153.4");
        std::fs::write(
            root.join("providers/codex/active.json"),
            serde_json::to_vec(&serde_json::json!({"path": alternate, "version": "0.153.4"}))
                .unwrap(),
        )
        .unwrap();
        assert_eq!(inspect_codex_runtime(&root).await.status, Status::Missing);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn installation_should_reuse_valid_private_binary_without_progress_or_manifest_writes() {
        let root = fixture();
        binary(&private_codex_binary_path(&root), "0.153.4");
        let result = install_codex_runtime(&root, |_| panic!("healthy runtime must not install"))
            .await
            .unwrap();
        assert_eq!(result.status, Status::Compatible);
        assert!(!root.join("providers/codex/active.json").exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn inspection_should_reject_wrong_version_and_corrupt_private_binary() {
        let root = fixture();
        let path = private_codex_binary_path(&root);
        binary(&path, "0.150.0");
        let result = inspect_codex_runtime(&root).await;
        assert_eq!(result.status, Status::Incompatible);
        assert_eq!(result.detected_version.as_deref(), Some("0.150.0"));
        std::fs::write(&path, "corrupt").unwrap();
        assert_eq!(inspect_codex_runtime(&root).await.status, Status::Failed);
        std::fs::remove_dir_all(root).unwrap();
    }
}
