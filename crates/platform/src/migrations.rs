pub(crate) struct Migration {
    pub(crate) name: &'static str,
    pub(crate) sql: &'static str,
    pub(crate) version: i64,
}

pub(crate) const MIGRATIONS: &[Migration] = &[
    Migration {
        version: 1,
        name: "create_local_state",
        sql: include_str!("../migrations/001_create_local_state.sql"),
    },
    Migration {
        version: 2,
        name: "create_task_metadata",
        sql: include_str!("../migrations/002_create_task_metadata.sql"),
    },
    Migration {
        version: 3,
        name: "add_sandbox_mode_settings",
        sql: include_str!("../migrations/003_add_sandbox_mode_settings.sql"),
    },
    Migration {
        version: 4,
        name: "add_project_sort_order",
        sql: include_str!("../migrations/004_add_project_sort_order.sql"),
    },
    Migration {
        version: 5,
        name: "add_approvals_reviewer_setting",
        sql: include_str!("../migrations/005_add_approvals_reviewer_setting.sql"),
    },
    Migration {
        version: 6,
        name: "create_global_settings",
        sql: include_str!("../migrations/006_create_global_settings.sql"),
    },
    Migration {
        version: 7,
        name: "add_commit_message_settings",
        sql: include_str!("../migrations/007_add_commit_message_settings.sql"),
    },
    Migration {
        version: 8,
        name: "add_follow_up_behavior_setting",
        sql: include_str!("../migrations/008_add_follow_up_behavior_setting.sql"),
    },
    Migration {
        version: 9,
        name: "drop_task_metadata",
        sql: include_str!("../migrations/009_drop_task_metadata.sql"),
    },
    Migration {
        version: 10,
        name: "add_project_kind",
        sql: include_str!("../migrations/010_add_project_kind.sql"),
    },
    Migration {
        version: 11,
        name: "create_provider_connection",
        sql: include_str!("../migrations/011_create_provider_connection.sql"),
    },
    Migration {
        version: 12,
        name: "scope_agent_state_by_backend",
        sql: include_str!("../migrations/012_scope_agent_state_by_backend.sql"),
    },
    Migration {
        version: 13,
        name: "remove_backend_scoping",
        sql: include_str!("../migrations/013_remove_backend_scoping.sql"),
    },
];
