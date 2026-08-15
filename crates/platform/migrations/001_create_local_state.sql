CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  root_path TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
) STRICT;
CREATE TABLE project_defaults (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  reasoning_effort TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE task_settings (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL,
  approval_policy TEXT NOT NULL CHECK (approval_policy IN ('untrusted', 'on-request', 'never')),
  model TEXT NOT NULL,
  reasoning_effort TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, task_id)
) STRICT;
