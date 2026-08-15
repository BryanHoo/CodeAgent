ALTER TABLE global_settings ADD COLUMN commit_message_model TEXT NOT NULL DEFAULT '';
ALTER TABLE global_settings ADD COLUMN commit_message_reasoning_effort TEXT NOT NULL DEFAULT '';
ALTER TABLE global_settings ADD COLUMN commit_message_prompt TEXT NOT NULL DEFAULT '';
UPDATE global_settings SET commit_message_model = model, commit_message_reasoning_effort = reasoning_effort;
