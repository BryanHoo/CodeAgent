use std::fs;

use code_agent_core::{AttachmentPort, PortRequestContext};
use code_agent_platform::{AttachmentKind, AttachmentStore, AttachmentUpload};
use code_agent_protocol::{AgentAttachmentKind, ProjectId, TaskId};

#[tokio::test]
async fn attachment_store_enforces_content_and_project_ownership() {
    let root =
        std::env::temp_dir().join(format!("code-agent-attachments-{}", uuid::Uuid::new_v4()));
    let store = AttachmentStore::new(&root).expect("store");
    assert!(!root.exists());
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
    assert!(root.is_dir());

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

#[tokio::test]
async fn attachment_store_should_bind_atomically_and_release_turn() {
    let root = std::env::temp_dir().join(format!(
        "code-agent-attachment-lifecycle-{}",
        uuid::Uuid::new_v4()
    ));
    let store = AttachmentStore::new(&root).expect("store");
    let project_id = ProjectId::try_from("project-a").expect("project id");
    let task_id = TaskId::try_from("task-a").expect("task id");
    let context = PortRequestContext::new("attachment-lifecycle");
    let attachment = store
        .upload(
            &project_id,
            AgentAttachmentKind::Text,
            "text/plain",
            "notes.txt",
            b"notes".to_vec(),
            &context,
        )
        .await
        .expect("upload");

    assert!(
        store
            .bind_to_turn(
                &project_id,
                &task_id,
                "turn-a",
                &[attachment.id.to_string(), "missing".to_owned()],
                &context,
            )
            .await
            .is_err()
    );
    store
        .resolve_pending(&project_id, attachment.id.as_str(), &context)
        .await
        .expect("still pending");
    store
        .bind_to_turn(
            &project_id,
            &task_id,
            "turn-a",
            std::slice::from_ref(&*attachment.id),
            &context,
        )
        .await
        .expect("bind");
    AttachmentPort::read(
        &store,
        &project_id,
        &task_id,
        attachment.id.as_str(),
        &context,
    )
    .await
    .expect("bound content");
    store
        .release_turn(&project_id, "turn-a", &context)
        .await
        .expect("release");
    assert!(
        AttachmentPort::read(
            &store,
            &project_id,
            &task_id,
            attachment.id.as_str(),
            &context,
        )
        .await
        .is_err()
    );
    fs::remove_dir_all(root).expect("remove root");
}
