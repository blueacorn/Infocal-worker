-- Delete the archive table, to re-create schema from live
-- WARNING: This will delete all archived deleted rows!
DROP TABLE IF EXISTS heartbeats_archive;

-- Re-create the trigger to match your schema
DROP TRIGGER IF EXISTS tr_heartbeats_delete_to_archive;

-- Ensure archive table exists by cloning heartbeats schema
CREATE TABLE IF NOT EXISTS heartbeats_archive AS
SELECT *, NULL AS deleted_at FROM heartbeats WHERE 0;

-- Trigger: whenever a row is deleted in heartbeats, copy it to archive with timestamp
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
    ciq_version,
    country,
    lang,
    feat,
    deleted_at
  )
  VALUES (
    OLD.unique_id,
    OLD.first_seen,
    OLD.last_seen,
    OLD.part_num,
    OLD.fw_version,
    OLD.sw_version,
    OLD.ciq_version,
    OLD.country,
    OLD.lang,
    OLD.feat,
    strftime('%s','now')
  );
END;
