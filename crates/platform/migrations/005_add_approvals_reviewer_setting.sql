ALTER TABLE task_settings ADD COLUMN approvals_reviewer TEXT NOT NULL DEFAULT 'user'
  CHECK (
    approvals_reviewer IN ('user', 'auto_review')
    AND (approvals_reviewer = 'user' OR approval_policy = 'on-request')
  );
