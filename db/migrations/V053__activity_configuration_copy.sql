-- Configuration copies are private until the final transaction makes them READY.
ALTER TABLE activity ADD COLUMN configuration_state VARCHAR(12) NOT NULL DEFAULT 'READY';

CREATE TABLE activity_copy_task (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  source_activity_id BIGINT UNSIGNED NOT NULL,
  target_activity_id BIGINT UNSIGNED NULL,
  department_id BIGINT UNSIGNED NOT NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  request_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  input_hash CHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'QUEUED',
  stage VARCHAR(32) NOT NULL DEFAULT 'QUEUED',
  snapshot_json LONGTEXT NULL,
  copied_files INT NOT NULL DEFAULT 0,
  total_files INT NOT NULL DEFAULT 0,
  attempt_count INT NOT NULL DEFAULT 0,
  lease_token VARCHAR(64) NULL,
  failure_message VARCHAR(300) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_activity_copy_request(created_by,request_key),
  KEY idx_activity_copy_queue(status,id),
  KEY idx_activity_copy_source(source_activity_id,status),
  CONSTRAINT fk_activity_copy_target FOREIGN KEY(target_activity_id) REFERENCES activity(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE activity_copy_file (
  task_id BIGINT UNSIGNED NOT NULL,
  source_file_id BIGINT UNSIGNED NOT NULL,
  target_file_id BIGINT UNSIGNED NULL,
  copied BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY(task_id,source_file_id),
  KEY idx_activity_copy_source_file(source_file_id,task_id),
  CONSTRAINT fk_activity_copy_file_task FOREIGN KEY(task_id) REFERENCES activity_copy_task(id) ON DELETE CASCADE,
  CONSTRAINT fk_activity_copy_file_target FOREIGN KEY(target_file_id) REFERENCES stored_file(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- One lease for the whole deployment, including all ACK replicas.
CREATE TABLE activity_copy_worker (
  id INT NOT NULL PRIMARY KEY,
  task_id BIGINT UNSIGNED NULL,
  lease_token VARCHAR(64) NULL,
  lease_expires_at DATETIME(3) NULL
) ENGINE=InnoDB;
INSERT INTO activity_copy_worker(id) VALUES(1);
