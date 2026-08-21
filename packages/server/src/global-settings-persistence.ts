export const FAST_MODE_SETTING_MIGRATION = {
  name: "add_fast_mode_setting",
  sql: `
    ALTER TABLE global_settings
      ADD COLUMN fast_mode INTEGER NOT NULL DEFAULT 0
      CHECK (fast_mode IN (0, 1));
  `,
  version: 12,
} as const;

export const DROP_COMMIT_MESSAGE_REASONING_EFFORT_MIGRATION = {
  name: "drop_commit_message_reasoning_effort",
  sql: "ALTER TABLE global_settings DROP COLUMN commit_message_reasoning_effort;",
  version: 13,
} as const;

export const GLOBAL_SETTINGS_MIGRATIONS = [
  FAST_MODE_SETTING_MIGRATION,
  DROP_COMMIT_MESSAGE_REASONING_EFFORT_MIGRATION,
] as const;
