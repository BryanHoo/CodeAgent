use super::local_settings::{
    default_global_settings, project_defaults_from_global, read_global_settings,
    read_project_defaults, update_global_settings, update_project_defaults,
};
use serde_json::{Value, json};
use std::{fs, path::PathBuf};

fn test_root() -> PathBuf {
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!(
        "codeagent-local-settings-{}-{nonce}",
        std::process::id()
    ))
}

#[tokio::test]
async fn local_settings_should_not_store_agent_global_defaults() {
    let root = test_root();
    let mut settings = read_global_settings(&root).await.unwrap();
    settings["model"] = json!("global-model");
    settings["followUpBehavior"] = json!("steer");
    update_global_settings(&root, settings).await.unwrap();
    let stored: Value =
        serde_json::from_slice(&fs::read(root.join("agent-settings.json")).unwrap()).unwrap();
    for field in [
        "model",
        "webSearch",
        "modelVerbosity",
        "approvalPolicy",
        "approvalsReviewer",
        "fastMode",
        "reasoningEffort",
        "sandboxMode",
    ] {
        assert!(stored["global"].get(field).is_none(), "{field}");
    }
    assert_eq!(stored["global"]["followUpBehavior"], "steer");
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn settings_should_persist_local_preferences_and_explicit_project_overrides() {
    let root = test_root();
    assert!(
        read_project_defaults(&root, "project-a")
            .await
            .unwrap()
            .is_none()
    );
    let mut global = default_global_settings();
    global["followUpBehavior"] = json!("steer");
    assert_eq!(
        update_global_settings(&root, global.clone())
            .await
            .unwrap()
            .changed_fields,
        ["followUpBehavior"]
    );
    assert_eq!(read_global_settings(&root).await.unwrap(), global);
    assert!(
        update_global_settings(&root, global.clone())
            .await
            .unwrap()
            .changed_fields
            .is_empty()
    );
    // 显式保存与全局相同的值后，项目也应拥有独立覆盖值。
    let project = project_defaults_from_global(&global);
    update_project_defaults(&root, "project-a", project.clone())
        .await
        .unwrap();
    assert_eq!(
        read_project_defaults(&root, "project-a").await.unwrap(),
        Some(project.clone())
    );
    let stored: Value =
        serde_json::from_slice(&fs::read(root.join("agent-settings.json")).unwrap()).unwrap();
    assert_eq!(stored["projects"]["project-a"], project);
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
async fn local_settings_should_ignore_old_agent_defaults_and_preserve_project_preferences() {
    let root = test_root();
    let mut old = default_global_settings();
    old["model"] = json!("obsolete-local-model");
    old["webSearch"] = json!("live");
    old["followUpBehavior"] = json!("steer");
    let project = project_defaults_from_global(&old);
    fs::create_dir_all(&root).unwrap();
    fs::write(
        root.join("agent-settings.json"),
        serde_json::to_vec(
            &json!({"version": 1, "global": old, "projects": {"project-a": project}}),
        )
        .unwrap(),
    )
    .unwrap();
    let settings = read_global_settings(&root).await.unwrap();
    assert_eq!(settings["model"], default_global_settings()["model"]);
    assert_eq!(settings["webSearch"], "cached");
    assert_eq!(settings["followUpBehavior"], "steer");
    assert_eq!(
        read_project_defaults(&root, "project-a").await.unwrap(),
        Some(project)
    );
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn concurrent_settings_updates_should_preserve_both_atomic_changes() {
    let root = test_root();
    let mut global = default_global_settings();
    global["followUpBehavior"] = json!("steer");
    let mut project = project_defaults_from_global(&global);
    project["model"] = json!("gpt-project");
    let (global_result, project_result) = tokio::join!(
        update_global_settings(&root, global),
        update_project_defaults(&root, "project-a", project)
    );
    global_result.unwrap();
    project_result.unwrap();
    assert_eq!(
        read_global_settings(&root).await.unwrap()["followUpBehavior"],
        "steer"
    );
    assert_eq!(
        read_project_defaults(&root, "project-a")
            .await
            .unwrap()
            .unwrap()["model"],
        "gpt-project"
    );
    fs::remove_dir_all(root).unwrap();
}
