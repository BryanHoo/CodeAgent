use std::{
    collections::BTreeMap,
    fs,
    time::{SystemTime, UNIX_EPOCH},
};

use super::app_storage::{
    CustomBackgroundInput, initialize_storage, list_custom_backgrounds, read_custom_background,
    replace_file_atomic, update_custom_backgrounds, update_preferences,
};

fn test_root() -> std::path::PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!(
        "codeagent-app-storage-{}-{nonce}",
        std::process::id()
    ))
}

#[tokio::test]
async fn storage_should_import_legacy_data_only_once() {
    let root = test_root();
    let mut legacy = BTreeMap::new();
    legacy.insert("codeagent.theme-preference".to_owned(), "dark".to_owned());
    let image = CustomBackgroundInput {
        bytes: vec![0x89, b'P', b'N', b'G', 13, 10, 26, 10],
        created_at: 42,
        id: "background-1".to_owned(),
        media_type: "image/png".to_owned(),
        name: "first.png".to_owned(),
    };

    let initialized = initialize_storage(&root, legacy, vec![image])
        .await
        .unwrap();
    assert_eq!(
        initialized.get("codeagent.theme-preference"),
        Some(&"dark".to_owned())
    );
    assert_eq!(
        read_custom_background(&root, "background-1").await.unwrap(),
        vec![0x89, b'P', b'N', b'G', 13, 10, 26, 10]
    );

    let mut stale = BTreeMap::new();
    stale.insert("codeagent.theme-preference".to_owned(), "light".to_owned());
    let reloaded = initialize_storage(&root, stale, Vec::new()).await.unwrap();
    assert_eq!(
        reloaded.get("codeagent.theme-preference"),
        Some(&"dark".to_owned())
    );

    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn storage_should_update_preferences_and_backgrounds() {
    let root = test_root();
    initialize_storage(&root, BTreeMap::new(), Vec::new())
        .await
        .unwrap();

    update_preferences(
        &root,
        BTreeMap::from([(
            "codeagent.language-preference".to_owned(),
            Some("zh-CN".to_owned()),
        )]),
    )
    .await
    .unwrap();
    update_preferences(
        &root,
        BTreeMap::from([("codeagent.language-preference".to_owned(), None)]),
    )
    .await
    .unwrap();
    update_custom_backgrounds(
        &root,
        &[],
        vec![CustomBackgroundInput {
            bytes: vec![b'R', b'I', b'F', b'F', 0, 0, 0, 0, b'W', b'E', b'B', b'P'],
            created_at: 100,
            id: "background-2".to_owned(),
            media_type: "image/webp".to_owned(),
            name: "second.webp".to_owned(),
        }],
    )
    .await
    .unwrap();

    let backgrounds = list_custom_backgrounds(&root).await.unwrap();
    assert_eq!(backgrounds.len(), 1);
    assert_eq!(backgrounds[0].id, "background-2");
    assert_eq!(backgrounds[0].media_type, "image/webp");

    update_custom_backgrounds(&root, &["background-2".to_owned()], Vec::new())
        .await
        .unwrap();
    assert!(list_custom_backgrounds(&root).await.unwrap().is_empty());

    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn storage_should_reject_untrusted_keys_and_ids() {
    let root = test_root();
    initialize_storage(&root, BTreeMap::new(), Vec::new())
        .await
        .unwrap();

    assert!(
        update_preferences(
            &root,
            BTreeMap::from([("other.theme".to_owned(), Some("dark".to_owned()))]),
        )
        .await
        .is_err()
    );
    assert!(read_custom_background(&root, "../auth.json").await.is_err());

    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn storage_should_replace_existing_files_atomically() {
    let root = test_root();
    fs::create_dir_all(&root).unwrap();
    let target = root.join("app.json");
    let replacement = root.join(".app.json.tmp");
    fs::write(&target, b"old").unwrap();
    fs::write(&replacement, b"new").unwrap();

    replace_file_atomic(&replacement, &target).await.unwrap();

    assert_eq!(fs::read(&target).unwrap(), b"new");
    assert!(!replacement.exists());
    fs::remove_dir_all(root).unwrap();
}
