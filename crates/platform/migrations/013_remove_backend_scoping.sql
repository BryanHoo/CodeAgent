-- 产品只保留 Codex Runtime；将历史 Backend 分区收敛为单一设置记录。
ALTER TABLE global_settings RENAME TO global_settings_v12;
CREATE TABLE global_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  settings_json TEXT NOT NULL CHECK (json_valid(settings_json)),
  updated_at TEXT NOT NULL
) STRICT;
INSERT INTO global_settings (id, settings_json, updated_at)
SELECT 1, settings_json, updated_at
FROM global_settings_v12
WHERE backend_id = 'codex';
DROP TABLE global_settings_v12;

ALTER TABLE project_defaults RENAME TO project_defaults_v12;
CREATE TABLE project_defaults (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  settings_json TEXT NOT NULL CHECK (json_valid(settings_json)),
  updated_at TEXT NOT NULL
) STRICT;
INSERT INTO project_defaults (project_id, settings_json, updated_at)
SELECT project_id, settings_json, updated_at
FROM project_defaults_v12
WHERE backend_id = 'codex';
DROP TABLE project_defaults_v12;

ALTER TABLE task_settings RENAME TO task_settings_v12;
CREATE TABLE task_settings (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL,
  settings_json TEXT NOT NULL CHECK (json_valid(settings_json)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, task_id)
) STRICT;
INSERT INTO task_settings (project_id, task_id, settings_json, updated_at)
SELECT project_id, task_id, settings_json, updated_at
FROM task_settings_v12
WHERE backend_id = 'codex';
DROP TABLE task_settings_v12;

ALTER TABLE provider_connection RENAME TO provider_connection_v12;
CREATE TABLE provider_connection (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  connection_json TEXT NOT NULL CHECK (json_valid(connection_json)),
  updated_at TEXT NOT NULL
) STRICT;
INSERT INTO provider_connection (id, connection_json, updated_at)
SELECT 1, connection_json, updated_at
FROM provider_connection_v12
WHERE backend_id = 'codex';
DROP TABLE provider_connection_v12;
