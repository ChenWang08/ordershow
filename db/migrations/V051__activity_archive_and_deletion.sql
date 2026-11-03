ALTER TABLE activity ADD COLUMN deletion_requested_at DATETIME(3) NULL,
  ADD KEY idx_activity_deletion (deletion_requested_at, id);
ALTER TABLE stored_file ADD KEY idx_stored_file_activity_id (activity_id,id);

-- Deliberately independent of activity: progress and the receipt survive physical deletion.
CREATE TABLE activity_deletion_task (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  activity_id BIGINT UNSIGNED NOT NULL,
  activity_code VARCHAR(64) NOT NULL,
  activity_name VARCHAR(200) NOT NULL,
  department_id BIGINT UNSIGNED NOT NULL,
  department_name VARCHAR(100) NOT NULL,
  requested_by BIGINT UNSIGNED NOT NULL,
  requested_by_name VARCHAR(200) NOT NULL,
  reason VARCHAR(500) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'QUEUED',
  stage INT NOT NULL DEFAULT 0,
  file_cursor BIGINT UNSIGNED NOT NULL DEFAULT 0,
  deleted_rows BIGINT UNSIGNED NOT NULL DEFAULT 0,
  deleted_files BIGINT UNSIGNED NOT NULL DEFAULT 0,
  retry_count INT NOT NULL DEFAULT 0,
  revision BIGINT NOT NULL DEFAULT 0,
  next_attempt_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_error VARCHAR(1000) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  completed_at DATETIME(3) NULL,
  UNIQUE KEY uk_deletion_activity (activity_id),
  UNIQUE KEY uk_deletion_code (activity_code),
  KEY idx_deletion_queue (status, next_attempt_at, id),
  CONSTRAINT ck_deletion_status CHECK (status IN ('QUEUED','RUNNING','FAILED','COMPLETED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE activity_deletion_file (
  task_id BIGINT UNSIGNED NOT NULL,
  file_id BIGINT UNSIGNED NOT NULL,
  bucket_name VARCHAR(255) NOT NULL,
  object_key VARCHAR(1000) NOT NULL,
  PRIMARY KEY (task_id, file_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- One short batch transaction at a time across all application instances.
CREATE TABLE activity_deletion_worker (
  id INT NOT NULL PRIMARY KEY,
  next_run_at DATETIME(3) NOT NULL
) ENGINE=InnoDB;
INSERT INTO activity_deletion_worker(id,next_run_at) VALUES (1,UTC_TIMESTAMP(3));
