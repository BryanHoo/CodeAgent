ALTER TABLE global_settings ADD COLUMN follow_up_behavior TEXT NOT NULL DEFAULT 'queue'
  CHECK (follow_up_behavior IN ('queue', 'steer'));
