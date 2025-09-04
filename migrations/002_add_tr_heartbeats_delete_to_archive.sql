-- Heartbeats Archive (Recycle Bin) Table schema
-- An automated archive (recycle bin) for heartbeats table, to provide
-- roll-back capability in case of accidental deletes!
--
-- NOTE: To prevent schema drift, you must apply any schema changes on live
--       table (heartbeats):
--        1. to archive table (heartbeats_archive) or just delete the archive
--           table and re-run this schema.
--        2. to the trigger schema below, to include all colunm names


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
    country,
    deleted_at -- deleted_at column
  )
  VALUES (
    OLD.unique_id,
    OLD.first_seen,
    OLD.last_seen,
    OLD.part_num,
    OLD.fw_version,
    OLD.sw_version,
    OLD.country,
    strftime('%s','now') -- deleted_at column
  );
END;