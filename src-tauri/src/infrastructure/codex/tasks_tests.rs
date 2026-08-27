use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, duplex, split};

use super::{archive_task, delete_task, list_tasks, pin_task, rename_task, unarchive_task};
use crate::{
    domain::sidebar::ListTasksInput, infrastructure::codex::connection::AppServerConnection,
};

const PINNED_SECTION_ID: &str = "01984de2-8f74-7c91-a3b2-5c5e937cf318";

#[tokio::test]
async fn list_tasks_should_filter_and_map_native_threads() {
    let (client, server) = duplex(8 * 1024);
    let (client_reader, client_writer) = split(client);
    let (server_reader, mut server_writer) = split(server);
    let connection = AppServerConnection::new(client_reader, client_writer);

    let server_task = tokio::spawn(async move {
        let mut lines = BufReader::new(server_reader).lines();
        let request: Value = serde_json::from_str(&lines.next_line().await.unwrap().unwrap())
            .expect("request should be JSON");
        assert_eq!(request["method"], "thread/list");
        assert_eq!(request["params"]["projectId"], "project-a");
        assert_eq!(request["params"]["sectionId"], PINNED_SECTION_ID);
        assert_eq!(request["params"]["sortKey"], "updated_at");
        assert_eq!(request["params"]["sortDirection"], "desc");
        assert_eq!(request["params"]["searchTerm"], "fix");
        assert_eq!(request["params"]["cursor"], "cursor-a");
        assert_eq!(request["params"]["limit"], 20);
        let id = &request["id"];
        let response = json!({
            "id": id,
            "result": {
                "data": [{
                    "id": "thread-a",
                    "name": "  Fixed title  ",
                    "preview": "ignored",
                    "projectId": "project-a",
                    "section": {"id": PINNED_SECTION_ID, "name": "Pinned", "appearance": null},
                    "updatedAt": 1735689600
                }],
                "nextCursor": "cursor-b",
                "backwardsCursor": null
            }
        });
        server_writer
            .write_all(format!("{}\n", serde_json::to_string(&response).unwrap()).as_bytes())
            .await
            .unwrap();
    });

    let page = list_tasks(
        &connection,
        ListTasksInput {
            archived: Some(false),
            cursor: Some("cursor-a".into()),
            limit: Some(20),
            pinned: Some(true),
            project_id: "project-a".into(),
            search_term: Some("fix".into()),
        },
    )
    .await
    .expect("tasks should map");

    assert_eq!(page.data[0].id, "thread-a");
    assert_eq!(page.data[0].project_id, "project-a");
    assert_eq!(page.data[0].title, "Fixed title");
    assert!(page.data[0].pinned);
    assert_eq!(page.data[0].updated_at, "2025-01-01T00:00:00Z");
    assert_eq!(page.next_cursor.as_deref(), Some("cursor-b"));
    server_task.await.unwrap();
}

fn task_thread(title: &str, pinned: bool) -> Value {
    json!({
        "id": "thread-a",
        "name": title,
        "preview": "preview",
        "projectId": "project-a",
        "section": pinned.then(|| json!({"id": PINNED_SECTION_ID, "name": "Pinned", "appearance": null})),
        "updatedAt": 1735689600
    })
}

#[tokio::test]
async fn task_mutations_should_complete_native_protocol_round_trips() {
    let (client, server) = duplex(32 * 1024);
    let (client_reader, client_writer) = split(client);
    let (server_reader, mut server_writer) = split(server);
    let connection = AppServerConnection::new(client_reader, client_writer);

    let server_task = tokio::spawn(async move {
        let mut lines = BufReader::new(server_reader).lines();
        for (method, result) in [
            (
                "thread/read",
                json!({"thread": task_thread("Original", false)}),
            ),
            ("thread/name/set", json!({})),
            (
                "thread/read",
                json!({"thread": task_thread("Renamed", false)}),
            ),
            (
                "thread/read",
                json!({"thread": task_thread("Renamed", false)}),
            ),
            ("thread/section/move", json!({})),
            (
                "thread/read",
                json!({"thread": task_thread("Renamed", true)}),
            ),
            (
                "thread/read",
                json!({"thread": task_thread("Renamed", true)}),
            ),
            ("thread/archive", json!({})),
            (
                "thread/read",
                json!({"thread": task_thread("Renamed", true)}),
            ),
            (
                "thread/unarchive",
                json!({"thread": task_thread("Renamed", true)}),
            ),
            (
                "thread/read",
                json!({"thread": task_thread("Renamed", true)}),
            ),
            ("thread/delete", json!({})),
        ] {
            let request: Value =
                serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
            assert_eq!(request["method"], method);
            assert_eq!(request["params"]["threadId"], "thread-a");
            if method == "thread/name/set" {
                assert_eq!(request["params"]["name"], "Renamed");
            }
            if method == "thread/section/move" {
                assert_eq!(request["params"]["sectionId"], PINNED_SECTION_ID);
            }
            let response = json!({"id": request["id"].clone(), "result": result});
            server_writer
                .write_all(format!("{}\n", serde_json::to_string(&response).unwrap()).as_bytes())
                .await
                .unwrap();
        }
    });

    let renamed = rename_task(
        &connection,
        "project-a".into(),
        "thread-a".into(),
        " Renamed ".into(),
    )
    .await
    .unwrap();
    assert_eq!(renamed.task.title, "Renamed");
    let pinned = pin_task(&connection, "project-a".into(), "thread-a".into(), true)
        .await
        .unwrap();
    assert!(pinned.task.pinned);
    assert_eq!(
        archive_task(&connection, "project-a".into(), "thread-a".into())
            .await
            .unwrap()
            .status,
        "archived"
    );
    assert!(
        unarchive_task(&connection, "project-a".into(), "thread-a".into())
            .await
            .unwrap()
            .task
            .pinned
    );
    assert_eq!(
        delete_task(&connection, "project-a".into(), "thread-a".into())
            .await
            .unwrap()
            .status,
        "deleted"
    );
    server_task.await.unwrap();
}
