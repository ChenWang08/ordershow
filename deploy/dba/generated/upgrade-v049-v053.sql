-- EXISTING V049 DATABASE ONLY. DBA: verify target, stop all writers/workers, back up first.
-- Apply V050-V053 in order; stop on first error. MySQL DDL may implicitly commit.
-- Never use mysql --force. Never run the fresh-install bundle on an existing database.
SET NAMES utf8mb4;
SET time_zone = "+00:00";

-- BEGIN V050__lottery_rule_revision.sql
ALTER TABLE lottery_rule ADD COLUMN revision BIGINT UNSIGNED NOT NULL DEFAULT 0;

-- END V050__lottery_rule_revision.sql
INSERT INTO deployment_schema_history(version,description) VALUES ('V050','DBA incremental V050__lottery_rule_revision.sql');

-- BEGIN V051__activity_archive_and_deletion.sql
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

-- END V051__activity_archive_and_deletion.sql
INSERT INTO deployment_schema_history(version,description) VALUES ('V051','DBA incremental V051__activity_archive_and_deletion.sql');

-- BEGIN V052__async_order_exports.sql
ALTER TABLE activity ADD COLUMN export_generation BIGINT NOT NULL DEFAULT 0;
ALTER TABLE export_task
  DROP CHECK ck_export_task_type,
  ADD CONSTRAINT ck_export_task_type CHECK (export_type IN ('ORDER_SUMMARY','ORDER_ITEMS','ORDER_VERSIONS','VISIT_FUNNEL','LOTTERY_WINNERS','IMPORT_ERRORS','ORDER_PACKAGE')),
  ADD COLUMN format_version INT NOT NULL DEFAULT 1,
  ADD COLUMN activity_generation BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN request_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD COLUMN filter_hash CHAR(64) NULL,
  ADD COLUMN stage VARCHAR(24) NOT NULL DEFAULT 'QUEUED',
  ADD COLUMN order_count BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN detail_count BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN sheet_counts_json JSON NULL,
  ADD COLUMN snapshot_at DATETIME(3) NULL,
  ADD COLUMN lease_token VARCHAR(64) NULL,
  ADD COLUMN attempt_count INT NOT NULL DEFAULT 0,
  ADD COLUMN cancel_requested BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ADD UNIQUE KEY uk_export_request (created_by,request_key),
  ADD KEY idx_export_active_filter (activity_id,filter_hash,status),
  ADD KEY idx_order_export_expiry (export_type,status,expires_at),
  ADD KEY idx_order_export_files (export_type,status,result_file_id);

ALTER TABLE stored_file ADD KEY idx_file_export_cleanup (file_purpose,deleted_at,created_at);

-- A short lease coordinates task claiming; it is never a transaction around file I/O.
CREATE TABLE order_export_worker (
  id INT NOT NULL PRIMARY KEY,
  task_id BIGINT NULL,
  lease_token VARCHAR(64) NULL,
  lease_expires_at DATETIME(3) NULL
) ENGINE=InnoDB;
INSERT INTO order_export_worker(id) VALUES(1);

-- Every retried browser request keeps its result even when it joined an existing task.
CREATE TABLE order_export_request (
  created_by BIGINT NOT NULL,
  request_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  task_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (created_by,request_key),
  CONSTRAINT fk_order_export_request_task FOREIGN KEY (task_id) REFERENCES export_task(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- END V052__async_order_exports.sql
INSERT INTO deployment_schema_history(version,description) VALUES ('V052','DBA incremental V052__async_order_exports.sql');

-- BEGIN V053__activity_configuration_copy.sql
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

-- END V053__activity_configuration_copy.sql
INSERT INTO deployment_schema_history(version,description) VALUES ('V053','DBA incremental V053__activity_configuration_copy.sql');
