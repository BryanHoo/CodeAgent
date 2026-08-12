CREATE TABLE provider_connection (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  mode TEXT NOT NULL CHECK (mode IN ('official', 'custom')),
  custom_base_url TEXT,
  custom_models_json TEXT,
  updated_at TEXT NOT NULL,
  CHECK (
    (mode = 'official' AND custom_base_url IS NULL AND custom_models_json IS NULL)
    OR
    (mode = 'custom' AND custom_base_url IS NOT NULL AND custom_models_json IS NOT NULL)
  )
) STRICT;
