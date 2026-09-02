use std::{
    fs,
    time::{SystemTime, UNIX_EPOCH},
};

use serde_json::json;

use super::local_settings::{
    read_global_settings, read_project_defaults, update_global_settings, update_project_defaults,
};

fn test_root() -> std::path::PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!(
        "codeagent-local-settings-{}-{nonce}",
        std::process::id()
    ))
}

#[tokio::test]
async fn settings_should_persist_locally_and_only_report_changed_fields() {
    let root = test_root();
    let mut global = read_global_settings(&root).await.unwrap();
    global["model"] = json!("gpt-local");
    global["reasoningEffort"] = json!("medium");

    let first = update_global_settings(&root, global.clone()).await.unwrap();
    assert_eq!(first.changed_fields, ["model", "reasoningEffort"]);
    assert_eq!(read_global_settings(&root).await.unwrap(), global);

    let unchanged = update_global_settings(&root, global.clone()).await.unwrap();
    assert!(unchanged.changed_fields.is_empty());

    let inherited = read_project_defaults(&root, "project-a").await.unwrap();
    assert_eq!(inherited["model"], "gpt-local");
    let mut project = inherited;
    project["model"] = json!("gpt-project");
    let project_update = update_project_defaults(&root, "project-a", project.clone())
        .await
        .unwrap();
    assert_eq!(project_update.changed_fields, ["model"]);
    assert_eq!(
        read_project_defaults(&root, "project-a").await.unwrap(),
        project
    );

    let stored: serde_json::Value =
        serde_json::from_slice(&fs::read(root.join("agent-settings.json")).unwrap()).unwrap();
    assert_eq!(stored["global"]["model"], "gpt-local");
    assert_eq!(stored["projects"]["project-a"]["model"], "gpt-project");
    assert!(fs::read_dir(&root).unwrap().all(|entry| {
        !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .ends_with(".tmp")
    }));

    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn concurrent_settings_updates_should_preserve_both_atomic_changes() {
    let root = test_root();
    let mut global = read_global_settings(&root).await.unwrap();
    global["followUpBehavior"] = json!("steer");
    let mut project = read_project_defaults(&root, "project-a").await.unwrap();
    project["model"] = json!("gpt-project");

    let (global_result, project_result) = tokio::join!(
        update_global_settings(&root, global),
        update_project_defaults(&root, "project-a", project),
    );
    global_result.unwrap();
    project_result.unwrap();

    assert_eq!(
        read_global_settings(&root).await.unwrap()["followUpBehavior"],
        "steer"
    );
    assert_eq!(
        read_project_defaults(&root, "project-a").await.unwrap()["model"],
        "gpt-project"
    );
    fs::remove_dir_all(root).unwrap();
}
