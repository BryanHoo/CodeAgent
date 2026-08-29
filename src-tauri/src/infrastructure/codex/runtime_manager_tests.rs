use std::path::Path;

use super::runtime_manager::{distribution_for, inspect_codex_runtime, private_codex_binary_path};
use crate::domain::runtime::CodexRuntimeAvailabilityStatus;

#[test]
fn private_runtime_should_use_the_provider_version_directory() {
    assert_eq!(
        private_codex_binary_path(Path::new("/application-data")),
        Path::new("/application-data/providers/codex/bin/0.149.0/bin")
            .join(format!("codex{}", std::env::consts::EXE_SUFFIX))
    );
}

#[test]
fn distribution_should_be_fixed_to_the_official_supported_package() {
    let distribution = distribution_for("macos", "aarch64").unwrap();

    assert_eq!(distribution.target, "aarch64-apple-darwin");
    assert_eq!(
        distribution.url,
        "https://registry.npmjs.org/@openai/codex/-/codex-0.149.0-darwin-arm64.tgz"
    );
    assert_eq!(
        distribution.integrity,
        "GsZJbzBWiD48RETrO8VHGAQNgfSrUVxItXZFeD87wswatPi0+lKuQo8Dx4nMYmOZhZrVtwr3al/feRrZxnDV8Q=="
    );
}

#[cfg(unix)]
#[tokio::test]
async fn inspection_should_find_the_compatible_private_runtime() {
    use std::os::unix::fs::PermissionsExt;

    let unique = std::time::SystemTime::now()
        .duration_since(std::time::SystemTime::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let app_data = std::env::temp_dir().join(format!("codeagent-runtime-{unique}"));
    let binary = private_codex_binary_path(&app_data);
    std::fs::create_dir_all(binary.parent().unwrap()).unwrap();
    std::fs::write(&binary, "#!/bin/sh\necho 'codex-cli 0.149.0'\n").unwrap();
    std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o755)).unwrap();

    let availability = inspect_codex_runtime(&app_data).await;

    assert_eq!(
        availability.status,
        CodexRuntimeAvailabilityStatus::Compatible
    );
    assert_eq!(availability.detected_version.as_deref(), Some("0.149.0"));
    std::fs::remove_dir_all(app_data).unwrap();
}
