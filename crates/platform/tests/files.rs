use std::fs;

use code_agent_platform::PlatformFileService;

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
