use std::fs;

use code_agent_platform::{AttachmentKind, AttachmentStore, AttachmentUpload};

#[tokio::test]
async fn attachment_store_enforces_content_and_project_ownership() {
    let root = std::env::temp_dir().join(format!(
        "code-agent-attachments-{}-{}",
        std::process::id(),
        std::thread::current().name().unwrap_or("test")
    ));
    fs::create_dir_all(&root).expect("attachment root");
    let store = AttachmentStore::new(&root).await.expect("store");
    let attachment = store
        .add(
            "project-a",
            AttachmentUpload {
                bytes: vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a],
                kind: AttachmentKind::Image,
                media_type: "image/png".to_owned(),
                name: "screen.png".to_owned(),
            },
        )
        .await
        .expect("upload");

    assert_eq!(attachment.size.get(), 8);
    assert_eq!(
        store
            .read("project-a", &attachment.id)
            .await
            .expect("owned read")
            .bytes,
        [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]
    );
    assert!(store.read("project-b", &attachment.id).await.is_err());
    assert!(
        store
            .add(
                "project-a",
                AttachmentUpload {
                    bytes: b"not an image".to_vec(),
                    kind: AttachmentKind::Image,
                    media_type: "image/png".to_owned(),
                    name: "fake.png".to_owned(),
                },
            )
            .await
            .is_err()
    );

    store.release_project("project-a").await.expect("cleanup");
    assert!(store.read("project-a", &attachment.id).await.is_err());
    fs::remove_dir_all(root).expect("remove root");
}
