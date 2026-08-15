ALTER TABLE projects ADD COLUMN kind TEXT NOT NULL DEFAULT 'user'
  CHECK (kind IN ('user', 'temporary'));
