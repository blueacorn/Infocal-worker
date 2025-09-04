PRAGMA defer_foreign_keys=TRUE;
CREATE TABLE heartbeats (
  
  unique_id TEXT PRIMARY KEY,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  part_num TEXT NOT NULL CHECK (length(part_num) <= 32),
  fw_version TEXT CHECK (length(fw_version) <= 16), sw_version TEXT CHECK (length(sw_version) <= 16), country TEXT CHECK (length(country) <= 8));
CREATE TABLE heartbeats_archive(
  unique_id TEXT,
  first_seen INT,
  last_seen INT,
  part_num TEXT,
  fw_version TEXT,
  sw_version TEXT,
  country TEXT,
  deleted_at
);
CREATE INDEX idx_heartbeats_first_seen
  ON heartbeats(first_seen);
CREATE INDEX idx_heartbeats_last_seen
  ON heartbeats(last_seen);
CREATE TRIGGER tr_heartbeats_delete_to_archive
AFTER DELETE ON heartbeats
BEGIN
  INSERT INTO heartbeats_archive (
    unique_id,
    first_seen,
    last_seen,
    part_num,
    fw_version,
    sw_version,
    country,
    deleted_at 
  )
  VALUES (
    OLD.unique_id,
    OLD.first_seen,
    OLD.last_seen,
    OLD.part_num,
    OLD.fw_version,
    OLD.sw_version,
    OLD.country,
    strftime('%s','now') 
  );
END;