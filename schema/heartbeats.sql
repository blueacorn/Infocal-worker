-- Heartbeats Table schema
-- note text columns include simple safety checks (length)
CREATE TABLE IF NOT EXISTS heartbeats (
  -- Required columns
  unique_id TEXT PRIMARY KEY,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  part_num TEXT NOT NULL CHECK (length(part_num) <= 32),
  fw_version TEXT CHECK (length(fw_version) <= 16),
  sw_version TEXT CHECK (length(sw_version) <= 16),
  country TEXT CHECK (length(country) <= 8)
);

-- Helpful index for queries by attributes + activity
CREATE INDEX IF NOT EXISTS idx_heartbeats_first_seen
  ON heartbeats(first_seen);

CREATE INDEX IF NOT EXISTS idx_heartbeats_last_seen
  ON heartbeats(last_seen);
