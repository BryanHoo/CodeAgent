export const FAST_MODE_SETTING_MIGRATION = {
  name: "add_fast_mode_setting",
  sql: `
    ALTER TABLE global_settings
      ADD COLUMN fast_mode INTEGER NOT NULL DEFAULT 0
      CHECK (fast_mode IN (0, 1));
  `,
  version: 12,
} as const;
