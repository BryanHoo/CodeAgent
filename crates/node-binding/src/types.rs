use napi_derive::napi;

#[napi(object)]
pub struct NodeEngineOptions {
    pub app_version: String,
    pub attachment_root: String,
    pub codex_home: String,
    pub codex_path: String,
    pub database_path: String,
    pub temporary_workspace: String,
}

#[napi(object)]
pub struct NodeEngineDiagnostic {
    pub codex_version: String,
    pub foreign_keys: bool,
    pub integrity_check: String,
    pub journal_mode: String,
    pub migration_version: i64,
}

#[napi(object)]
pub struct NodeProcessExit {
    pub code: Option<i32>,
    pub signal: Option<i32>,
}
