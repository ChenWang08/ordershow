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
