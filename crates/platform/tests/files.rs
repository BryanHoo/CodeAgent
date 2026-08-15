use std::fs;

use code_agent_platform::{PlatformFileService, filesystem_roots};

#[tokio::test]
async fn filesystem_roots_should_include_the_current_platform_root() {
    let roots = filesystem_roots().await;

    assert!(!roots.is_empty());
    assert!(roots.iter().all(|root| root.is_absolute()));
    #[cfg(not(windows))]
    assert_eq!(
        roots,
        vec![std::path::PathBuf::from(
            std::path::MAIN_SEPARATOR.to_string()
        )]
    );
}

#[tokio::test]
async fn files_should_preserve_utf8_cursor_and_validate_image_signature() {
    let root = std::env::temp_dir().join(format!("code-agent-files-{}", std::process::id()));
    fs::create_dir_all(&root).expect("root");
    fs::write(root.join("source.txt"), "你好\nworld").expect("source");
    fs::write(
        root.join("image.png"),
        [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a],
    )
    .expect("image");
    fs::write(root.join("fake.png"), b"not-image").expect("fake");
    let service = PlatformFileService::new(&root).await.expect("service");
    let page = service
        .read_source("source.txt", 0)
        .await
        .expect("source page");
    assert_eq!(page.content, "你好\nworld");
    assert_eq!(
        service
            .read_image("image.png")
            .await
            .expect("image")
            .media_type,
        "image/png"
    );
    assert!(service.read_image("fake.png").await.is_err());
    fs::remove_dir_all(root).expect("remove root");
}
