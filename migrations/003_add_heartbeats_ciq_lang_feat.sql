-- Add new fields for CIQ, language, and country
ALTER TABLE heartbeats ADD COLUMN ciq_version TEXT CHECK (length(ciq_version) <= 16);
ALTER TABLE heartbeats ADD COLUMN lang        TEXT CHECK (length(lang)        <= 16);
ALTER TABLE heartbeats ADD COLUMN feat        TEXT CHECK (length(feat)       <= 256);
