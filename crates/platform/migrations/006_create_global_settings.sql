CREATE TABLE global_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  approval_policy TEXT NOT NULL CHECK (approval_policy IN ('untrusted', 'on-request', 'never')),
  approvals_reviewer TEXT NOT NULL CHECK (
    approvals_reviewer IN ('user', 'auto_review')
    AND (approvals_reviewer = 'user' OR approval_policy = 'on-request')
  ),
  model TEXT NOT NULL,
  reasoning_effort TEXT NOT NULL,
  sandbox_mode TEXT NOT NULL CHECK (sandbox_mode IN ('read-only', 'workspace-write', 'danger-full-access')),
  default_open_app_id TEXT CHECK (default_open_app_id IN (
    'visual-studio-code', 'zed', 'windsurf', 'finder', 'terminal', 'ghostty', 'xcode',
    'android-studio', 'file-manager', 'gnome-terminal', 'konsole', 'xfce-terminal',
    'explorer', 'windows-terminal', 'command-prompt'
  )),
  updated_at TEXT NOT NULL
) STRICT;
