ALTER TABLE project_defaults ADD COLUMN sandbox_mode TEXT NOT NULL DEFAULT 'workspace-write'
  CHECK (sandbox_mode IN ('read-only', 'workspace-write', 'danger-full-access'));
ALTER TABLE task_settings ADD COLUMN sandbox_mode TEXT NOT NULL DEFAULT 'workspace-write'
  CHECK (sandbox_mode IN ('read-only', 'workspace-write', 'danger-full-access'));
