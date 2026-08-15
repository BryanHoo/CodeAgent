CREATE TABLE task_metadata (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL,
  pinned INTEGER NOT NULL CHECK (pinned IN (0, 1)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, task_id)
) STRICT;
