-- Preserve existing stages/counters. Paused deletions keep the activity unavailable.
ALTER TABLE activity_deletion_task
  DROP CHECK ck_deletion_status,
  ADD CONSTRAINT ck_deletion_status CHECK (status IN ('QUEUED','RUNNING','PAUSED','FAILED','COMPLETED')),
  ADD COLUMN last_progress_at DATETIME(3) NULL;

-- Older tasks did not distinguish attempts from progress; use their last known update.
UPDATE activity_deletion_task SET last_progress_at=updated_at WHERE last_progress_at IS NULL;
ALTER TABLE activity_deletion_task MODIFY COLUMN last_progress_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);
