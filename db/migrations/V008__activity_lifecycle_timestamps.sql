ALTER TABLE activity
  ADD COLUMN published_at DATETIME(3) NULL AFTER updated_at,
  ADD COLUMN actual_started_at DATETIME(3) NULL AFTER published_at,
  ADD COLUMN closed_at DATETIME(3) NULL AFTER actual_started_at;
