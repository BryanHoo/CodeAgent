-- 共享数据目录中的运行时设置按 Backend 隔离，避免不同 Provider 相互覆盖。
ALTER TABLE global_settings RENAME TO global_settings_v11;
CREATE TABLE global_settings (
  backend_id TEXT PRIMARY KEY CHECK (backend_id = 'codex'),
  settings_json TEXT NOT NULL CHECK (json_valid(settings_json)),
  updated_at TEXT NOT NULL
) STRICT;
INSERT INTO global_settings (backend_id, settings_json, updated_at)
SELECT 'codex', json_object(
  'approvalPolicy', approval_policy,
  'approvalsReviewer', approvals_reviewer,
  'commitMessageModel', commit_message_model,
  'commitMessagePrompt', commit_message_prompt,
  'commitMessageReasoningEffort', commit_message_reasoning_effort,
  'defaultOpenAppId', default_open_app_id,
  'followUpBehavior', follow_up_behavior,
  'model', model,
  'reasoningEffort', reasoning_effort,
  'sandboxMode', sandbox_mode
), updated_at
FROM global_settings_v11;
DROP TABLE global_settings_v11;

ALTER TABLE project_defaults RENAME TO project_defaults_v11;
CREATE TABLE project_defaults (
  backend_id TEXT NOT NULL CHECK (backend_id = 'codex'),
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  settings_json TEXT NOT NULL CHECK (json_valid(settings_json)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (backend_id, project_id)
) STRICT;
INSERT INTO project_defaults (backend_id, project_id, settings_json, updated_at)
SELECT 'codex', project_id, json_object(
  'model', model,
  'reasoningEffort', reasoning_effort,
  'sandboxMode', sandbox_mode
), updated_at
FROM project_defaults_v11;
DROP TABLE project_defaults_v11;

ALTER TABLE task_settings RENAME TO task_settings_v11;
CREATE TABLE task_settings (
  backend_id TEXT NOT NULL CHECK (backend_id = 'codex'),
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL,
  settings_json TEXT NOT NULL CHECK (json_valid(settings_json)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (backend_id, project_id, task_id)
) STRICT;
INSERT INTO task_settings (backend_id, project_id, task_id, settings_json, updated_at)
SELECT 'codex', project_id, task_id, json_object(
  'approvalPolicy', approval_policy,
  'approvalsReviewer', approvals_reviewer,
  'model', model,
  'reasoningEffort', reasoning_effort,
  'sandboxMode', sandbox_mode
), updated_at
FROM task_settings_v11;
DROP TABLE task_settings_v11;

ALTER TABLE provider_connection RENAME TO provider_connection_v11;
CREATE TABLE provider_connection (
  backend_id TEXT PRIMARY KEY CHECK (backend_id = 'codex'),
  connection_json TEXT NOT NULL CHECK (json_valid(connection_json)),
  updated_at TEXT NOT NULL
) STRICT;
INSERT INTO provider_connection (backend_id, connection_json, updated_at)
SELECT 'codex', json_object(
  'customBaseUrl', custom_base_url,
  'customModels', CASE
    WHEN custom_models_json IS NULL THEN NULL
    ELSE json(custom_models_json)
  END,
  'mode', mode,
  'updatedAt', updated_at
), updated_at
FROM provider_connection_v11;
DROP TABLE provider_connection_v11;
