use std::fs::{File, remove_dir_all};
use std::io::Write;
use std::time::Duration;

use code_agent_core::AttachmentBytes;

use super::HistoricalAttachmentStore;

const PNG_HEADER: [u8; 8] = [137, 80, 78, 71, 13, 10, 26, 10];
const MAX_IMAGE_BYTES: u64 = 10 * 1024 * 1024;

fn fixture_directory(name: &str) -> std::path::PathBuf {
    let path = std::env::temp_dir().join(format!(
        "code-agent-historical-attachments-{name}-{}-{}",
        std::process::id(),
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&path).expect("create fixture directory");
    path
}

#[tokio::test]
async fn local_image_read_should_reject_file_removed_after_registration() {
    let directory = fixture_directory("removed");
    let path = directory.join("diagram.png");
    std::fs::write(&path, PNG_HEADER).expect("write image fixture");
    let store = HistoricalAttachmentStore::default();
    let attachment = store
        .add_local_image("task-1", path.to_str().expect("fixture path"), 0)
        .await
        .expect("register local image");
    let attachment_id = attachment["id"].as_str().expect("attachment id");

    std::fs::remove_file(&path).expect("remove image fixture");

    assert!(store.read("task-1", attachment_id).await.is_none());
    remove_dir_all(directory).expect("remove fixture directory");
}

#[tokio::test]
async fn local_image_read_should_reject_signature_changed_after_registration() {
    let directory = fixture_directory("changed-signature");
    let path = directory.join("diagram.png");
    std::fs::write(&path, PNG_HEADER).expect("write image fixture");
    let store = HistoricalAttachmentStore::default();
    let attachment = store
        .add_local_image("task-1", path.to_str().expect("fixture path"), 0)
        .await
        .expect("register local image");
    let attachment_id = attachment["id"].as_str().expect("attachment id");

    std::fs::write(&path, b"not-png!").expect("replace image fixture");

    assert!(store.read("task-1", attachment_id).await.is_none());
    remove_dir_all(directory).expect("remove fixture directory");
}

#[tokio::test]
async fn local_image_registration_should_reject_per_image_limit_overflow() {
    let directory = fixture_directory("oversized");
    let path = directory.join("oversized.png");
    let mut file = File::create(&path).expect("create image fixture");
    file.write_all(&PNG_HEADER).expect("write image header");
    file.set_len(MAX_IMAGE_BYTES + 1)
        .expect("extend image fixture");
    drop(file);
    let store = HistoricalAttachmentStore::default();

    let attachment = store
        .add_local_image("task-1", path.to_str().expect("fixture path"), 0)
        .await;

    assert!(attachment.is_none());
    remove_dir_all(directory).expect("remove fixture directory");
}

#[tokio::test]
async fn inline_reads_should_share_content_and_expire_without_unsubscribe() {
    let store = HistoricalAttachmentStore::with_limits(Duration::from_secs(60), 2, 16);
    let encoded = data_encoding::BASE64.encode(&PNG_HEADER);
    let attachment = store
        .add_base64_image("task-1", &encoded, 0)
        .expect("register inline image");
    let attachment_id = attachment["id"].as_str().expect("attachment id");
    let first = store
        .read("task-1", attachment_id)
        .await
        .expect("first read");
    let second = store
        .read("task-1", attachment_id)
        .await
        .expect("second read");

    let (AttachmentBytes::Shared(first), AttachmentBytes::Shared(second)) = (first, second) else {
        panic!("inline bytes should use shared storage");
    };
    assert!(std::sync::Arc::ptr_eq(&first, &second));

    let expiring = HistoricalAttachmentStore::with_limits(Duration::ZERO, 2, 16);
    let expired = expiring
        .add_base64_image("task-1", &encoded, 0)
        .expect("register expiring image");
    assert!(
        expiring
            .read("task-1", expired["id"].as_str().expect("expired id"))
            .await
            .is_none()
    );
}

#[tokio::test]
async fn capacity_should_evict_least_recently_used_attachment() {
    let store = HistoricalAttachmentStore::with_limits(Duration::from_secs(60), 2, 24);
    let first = store
        .add_base64_image("task-1", &data_encoding::BASE64.encode(&PNG_HEADER), 0)
        .expect("register first image");
    let mut second_bytes = PNG_HEADER.to_vec();
    second_bytes.push(1);
    let second = store
        .add_base64_image("task-1", &data_encoding::BASE64.encode(&second_bytes), 1)
        .expect("register second image");
    let first_id = first["id"].as_str().expect("first id");
    let second_id = second["id"].as_str().expect("second id");
    assert!(store.read("task-1", first_id).await.is_some());
    let mut third_bytes = PNG_HEADER.to_vec();
    third_bytes.push(2);
    let third = store
        .add_base64_image("task-1", &data_encoding::BASE64.encode(&third_bytes), 2)
        .expect("register third image");

    assert!(store.read("task-1", second_id).await.is_none());
    assert!(
        store
            .read("task-1", third["id"].as_str().expect("third id"))
            .await
            .is_some()
    );
}
