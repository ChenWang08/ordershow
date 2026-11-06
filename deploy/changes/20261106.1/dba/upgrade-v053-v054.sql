-- EXISTING V053 DATABASE ONLY. DBA: verify target, stop all API/workers and back up first.
-- Apply before the new deletion code. Old workers do not maintain last_progress_at.
-- Stop on first error; DDL may implicitly commit. Never use --force.
SET NAMES utf8mb4;
SET time_zone = "+00:00";

-- BEGIN V054__activity_deletion_pause_and_progress.sql
-- Preserve existing stages/counters. Paused deletions keep the activity unavailable.
ALTER TABLE activity_deletion_task
  DROP CHECK ck_deletion_status,
  ADD CONSTRAINT ck_deletion_status CHECK (status IN ('QUEUED','RUNNING','PAUSED','FAILED','COMPLETED')),
  ADD COLUMN last_progress_at DATETIME(3) NULL;

-- Older tasks did not distinguish attempts from progress; use their last known update.
UPDATE activity_deletion_task SET last_progress_at=updated_at WHERE last_progress_at IS NULL;
ALTER TABLE activity_deletion_task MODIFY COLUMN last_progress_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- END V054__activity_deletion_pause_and_progress.sql
INSERT INTO deployment_schema_history(version,description) VALUES ('V054','DBA incremental V054__activity_deletion_pause_and_progress.sql');
