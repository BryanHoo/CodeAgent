use std::path::Path;

#[cfg(unix)]
use super::runtime_manager::inspect_codex_runtime;
use super::runtime_manager::{codex_executable_names, distribution_for, private_codex_binary_path};
#[cfg(unix)]
use crate::domain::runtime::CodexRuntimeAvailabilityStatus;

#[test]
fn private_runtime_should_use_the_provider_version_directory() {
    assert_eq!(
        private_codex_binary_path(Path::new("/application-data")),
        Path::new("/application-data/providers/codex/bin/0.151.0/bin")
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
            "g7YzpaCZGCw19R/gly3vRPjnLqaW7JcBAu2WQQ6e8PIlvBPmS/gMplIUURMgNO6gi8LsPzdlQtLqkwoeOOlIdg==",
        ),
        (
            "linux",
            "aarch64",
            "aarch64-unknown-linux-musl",
            "linux-arm64",
            "CsLgFeX4TQ6I2Gdrxd2r5UbgIbDLCdtcLAlnMYjr06bCL057MTNGec7Ewb3+Z2DBiMuXCljdTBGqLOePkMV0sQ==",
        ),
        (
            "linux",
            "x86_64",
            "x86_64-unknown-linux-musl",
            "linux-x64",
            "xcVyY1FtwvVYhh2JBmz8fX8CQqFAxO/lxJ2IXsh8x5uwxZVHVl5fZHFHf8JdRaOGG0vpkYmu/DKKVoLd56/DDQ==",
        ),
        (
            "windows",
            "aarch64",
            "aarch64-pc-windows-msvc",
            "win32-arm64",
            "zDWzOoh9wHm+Om1Nhn7os47rAVeSGPh0SnM3YOttdq6iPJz2zn4vBnbGUZjeih1qW/3mvNF3Oyd4owlaHmphmg==",
        ),
        (
            "windows",
            "x86_64",
            "x86_64-pc-windows-msvc",
            "win32-x64",
            "sLT7xvID3jhU6tkzcwRPnMEclKRwUPbpo0mtfxIF9KpdZH3VJV7sM2/kXWXyvUM7Zt/YeyOaeATTEysbRz8Yog==",
        ),
    ];

    for (os, arch, target, package_suffix, integrity) in cases {
        let distribution = distribution_for(os, arch).unwrap();
        assert_eq!(distribution.target, target);
        assert_eq!(
            distribution.url,
            format!(
                "https://registry.npmjs.org/@openai/codex/-/codex-0.151.0-{package_suffix}.tgz"
            )
        );
        assert_eq!(distribution.integrity, integrity);
    }
}

#[test]
fn macos_intel_runtime_should_not_be_supported() {
    assert!(distribution_for("macos", "x86_64").is_none());
}

#[test]
fn windows_runtime_should_include_the_npm_cmd_shim() {
    assert_eq!(
        codex_executable_names("windows"),
        &["codex.exe", "codex.cmd"]
    );
    assert_eq!(codex_executable_names("macos"), &["codex"]);
    assert_eq!(codex_executable_names("linux"), &["codex"]);
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
    std::fs::write(&binary, "#!/bin/sh\necho 'codex-cli 0.152.0'\n").unwrap();
    std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o755)).unwrap();

    let availability = inspect_codex_runtime(&app_data).await;

    assert_eq!(
        availability.status,
        CodexRuntimeAvailabilityStatus::Compatible
    );
    assert_eq!(availability.detected_version.as_deref(), Some("0.152.0"));
    std::fs::remove_dir_all(app_data).unwrap();
}
