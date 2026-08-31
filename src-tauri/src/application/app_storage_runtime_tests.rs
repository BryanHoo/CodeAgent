use std::collections::BTreeMap;

use super::app_storage_runtime::PreferenceWriteBuffer;

#[test]
fn preference_write_buffer_should_merge_updates_with_latest_value() {
    let mut buffer = PreferenceWriteBuffer::default();
    buffer.merge(BTreeMap::from([
        ("codeagent.language".to_owned(), Some("zh-CN".to_owned())),
        ("codeagent.theme".to_owned(), Some("light".to_owned())),
    ]));
    buffer.merge(BTreeMap::from([
        ("codeagent.language".to_owned(), Some("en".to_owned())),
        ("codeagent.theme".to_owned(), None),
    ]));

    assert_eq!(
        buffer.take(),
        BTreeMap::from([
            ("codeagent.language".to_owned(), Some("en".to_owned())),
            ("codeagent.theme".to_owned(), None),
        ])
    );
    assert!(buffer.is_empty());
}

#[test]
fn failed_preference_write_should_be_restored_without_overwriting_newer_updates() {
    let mut buffer = PreferenceWriteBuffer::default();
    buffer.merge(BTreeMap::from([(
        "codeagent.draft".to_owned(),
        Some("new".to_owned()),
    )]));
    buffer.restore_failed(BTreeMap::from([
        ("codeagent.draft".to_owned(), Some("old".to_owned())),
        ("codeagent.theme".to_owned(), Some("dark".to_owned())),
    ]));

    assert_eq!(
        buffer.take(),
        BTreeMap::from([
            ("codeagent.draft".to_owned(), Some("new".to_owned()),),
            ("codeagent.theme".to_owned(), Some("dark".to_owned()),),
        ])
    );
}
