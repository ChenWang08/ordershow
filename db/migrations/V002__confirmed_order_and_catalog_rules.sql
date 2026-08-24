-- 同步开发前已冻结的规则：后台订单只读、动态大区、可空吨数、商品可见与可订分离、导入版本原子发布。

ALTER TABLE admin_session
  ADD COLUMN csrf_token_hash BINARY(32) NOT NULL AFTER token_hash;

CREATE TABLE activity_region (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  activity_id BIGINT UNSIGNED NOT NULL,
  region_code VARCHAR(64) NOT NULL,
  region_name VARCHAR(100) NOT NULL,
  sort_no INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_activity_region_code (activity_id, region_code),
  UNIQUE KEY uk_activity_region_name (activity_id, region_name),
  KEY idx_activity_region_sort (activity_id, is_active, sort_no, id),
  CONSTRAINT fk_activity_region_activity FOREIGN KEY (activity_id) REFERENCES activity (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE import_task
  ADD COLUMN lease_owner VARCHAR(128) NULL AFTER failure_message,
  ADD COLUMN lease_expires_at DATETIME(3) NULL AFTER lease_owner,
  ADD COLUMN attempt_count INT UNSIGNED NOT NULL DEFAULT 0 AFTER lease_expires_at,
  ADD COLUMN next_attempt_at DATETIME(3) NULL AFTER attempt_count,
  ADD COLUMN base_publish_version_id BIGINT UNSIGNED NULL AFTER next_attempt_at,
  ADD COLUMN published_version_id BIGINT UNSIGNED NULL AFTER base_publish_version_id,
  DROP CHECK ck_import_task_status,
  ADD CONSTRAINT ck_import_task_status CHECK (status IN ('UPLOADED', 'PARSING', 'PREVIEW_READY', 'CONFIRMING', 'MATERIALIZING', 'READY_TO_PUBLISH', 'PUBLISHING', 'COMPLETED', 'FAILED', 'CANCELLED'));

CREATE TABLE import_publish_version (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  activity_id BIGINT UNSIGNED NOT NULL,
  data_type VARCHAR(32) NOT NULL,
  version_no INT UNSIGNED NOT NULL,
  source_import_task_id BIGINT UNSIGNED NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'BUILDING',
  row_count INT UNSIGNED NOT NULL DEFAULT 0,
  content_sha256 BINARY(32) NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ready_at DATETIME(3) NULL,
  published_at DATETIME(3) NULL,
  retired_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_publish_version_no (activity_id, data_type, version_no),
  UNIQUE KEY uk_publish_version_task (source_import_task_id),
  KEY idx_publish_version_status (activity_id, data_type, status, version_no),
  CONSTRAINT fk_publish_version_activity FOREIGN KEY (activity_id) REFERENCES activity (id),
  CONSTRAINT fk_publish_version_task FOREIGN KEY (source_import_task_id) REFERENCES import_task (id),
  CONSTRAINT fk_publish_version_created_by FOREIGN KEY (created_by) REFERENCES admin_user (id),
  CONSTRAINT ck_publish_version_type CHECK (data_type IN ('PRODUCT', 'WHITELIST', 'ATTENDANCE')),
  CONSTRAINT ck_publish_version_status CHECK (status IN ('BUILDING', 'READY', 'PUBLISHED', 'RETIRED', 'FAILED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE activity_data_binding (
  activity_id BIGINT UNSIGNED NOT NULL,
  data_type VARCHAR(32) NOT NULL,
  current_version_id BIGINT UNSIGNED NOT NULL,
  lock_version INT UNSIGNED NOT NULL DEFAULT 0,
  updated_by BIGINT UNSIGNED NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (activity_id, data_type),
  UNIQUE KEY uk_data_binding_current_version (current_version_id),
  CONSTRAINT fk_data_binding_activity FOREIGN KEY (activity_id) REFERENCES activity (id),
  CONSTRAINT fk_data_binding_version FOREIGN KEY (current_version_id) REFERENCES import_publish_version (id),
  CONSTRAINT fk_data_binding_updated_by FOREIGN KEY (updated_by) REFERENCES admin_user (id),
  CONSTRAINT ck_data_binding_type CHECK (data_type IN ('PRODUCT', 'WHITELIST', 'ATTENDANCE'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE activity_customer
  DROP INDEX uk_activity_customer_identity,
  DROP INDEX uk_activity_customer_phone,
  DROP CHECK ck_activity_customer_region,
  MODIFY COLUMN region_code VARCHAR(64) NULL,
  ADD COLUMN data_version_id BIGINT UNSIGNED NULL AFTER source_import_task_id,
  ADD UNIQUE KEY uk_activity_customer_identity (activity_id, data_version_id, customer_id),
  ADD UNIQUE KEY uk_activity_customer_phone (activity_id, data_version_id, customer_type, phone_lookup_hash),
  ADD CONSTRAINT fk_activity_customer_version FOREIGN KEY (data_version_id) REFERENCES import_publish_version (id);

ALTER TABLE lottery_candidate_snapshot
  MODIFY COLUMN region_code VARCHAR(64) NULL;

CREATE TABLE h5_session (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  activity_id BIGINT UNSIGNED NOT NULL,
  activity_customer_id BIGINT UNSIGNED NOT NULL,
  token_hash BINARY(32) NOT NULL,
  csrf_token_hash BINARY(32) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  last_seen_at DATETIME(3) NOT NULL,
  revoked_at DATETIME(3) NULL,
  ip_address VARBINARY(16) NULL,
  user_agent VARCHAR(512) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_h5_session_token_hash (token_hash),
  KEY idx_h5_session_customer_expires (activity_customer_id, expires_at),
  CONSTRAINT fk_h5_session_activity FOREIGN KEY (activity_id) REFERENCES activity (id),
  CONSTRAINT fk_h5_session_customer FOREIGN KEY (activity_customer_id) REFERENCES activity_customer (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE activity_attendee
  ADD COLUMN data_version_id BIGINT UNSIGNED NULL AFTER source_import_task_id,
  ADD CONSTRAINT fk_attendee_version FOREIGN KEY (data_version_id) REFERENCES import_publish_version (id);

ALTER TABLE activity_product
  DROP INDEX uk_activity_product_business,
  DROP INDEX idx_product_catalog,
  DROP CHECK ck_product_price,
  MODIFY COLUMN case_price DECIMAL(18,4) NULL,
  MODIFY COLUMN ton_case_factor DECIMAL(18,8) NULL,
  ADD COLUMN is_visible BOOLEAN NOT NULL DEFAULT TRUE AFTER is_branch_customized,
  ADD COLUMN is_orderable BOOLEAN NOT NULL DEFAULT TRUE AFTER is_visible,
  ADD COLUMN data_version_id BIGINT UNSIGNED NULL AFTER source_import_task_id,
  ADD UNIQUE KEY uk_activity_product_business (activity_id, data_version_id, business_key),
  ADD KEY idx_product_catalog (activity_id, data_version_id, customer_type, is_visible, is_orderable, rebate_status, sort_no, id),
  ADD CONSTRAINT fk_product_version FOREIGN KEY (data_version_id) REFERENCES import_publish_version (id),
  ADD CONSTRAINT ck_product_price CHECK ((case_price IS NULL OR case_price >= 0) AND (ton_case_factor IS NULL OR ton_case_factor > 0)),
  ADD CONSTRAINT ck_product_orderable CHECK (is_orderable = FALSE OR (is_visible = TRUE AND case_price IS NOT NULL AND case_price > 0));

ALTER TABLE customer_order
  DROP FOREIGN KEY fk_order_admin,
  DROP CHECK ck_order_source,
  DROP CHECK ck_order_totals,
  MODIFY COLUMN region_code VARCHAR(64) NULL,
  MODIFY COLUMN total_tons DECIMAL(18,6) NULL,
  MODIFY COLUMN last_modified_source VARCHAR(20) NOT NULL DEFAULT 'H5',
  DROP COLUMN last_modified_admin_id,
  ADD CONSTRAINT ck_order_source CHECK (last_modified_source IN ('H5', 'SYSTEM')),
  ADD CONSTRAINT ck_order_totals CHECK (total_quantity > 0 AND (total_tons IS NULL OR total_tons >= 0) AND total_amount >= 0);

ALTER TABLE order_item
  DROP CHECK ck_order_item_values,
  MODIFY COLUMN ton_case_factor DECIMAL(18,8) NULL,
  MODIFY COLUMN line_tons DECIMAL(18,6) NULL,
  ADD CONSTRAINT ck_order_item_values CHECK (quantity > 0 AND case_price > 0 AND line_amount >= 0 AND (ton_case_factor IS NULL OR ton_case_factor > 0) AND (line_tons IS NULL OR line_tons >= 0));

ALTER TABLE order_version
  DROP FOREIGN KEY fk_order_version_admin,
  DROP CHECK ck_order_version_region,
  DROP CHECK ck_order_version_source,
  DROP CHECK ck_order_version_totals,
  MODIFY COLUMN region_code VARCHAR(64) NULL,
  MODIFY COLUMN total_tons DECIMAL(18,6) NULL,
  DROP COLUMN submitted_by_admin_id,
  ADD CONSTRAINT ck_order_version_source CHECK (submitted_source IN ('H5')),
  ADD CONSTRAINT ck_order_version_totals CHECK (total_quantity > 0 AND (total_tons IS NULL OR total_tons >= 0) AND total_amount >= 0);

ALTER TABLE order_version_item
  DROP CHECK ck_version_item_values,
  MODIFY COLUMN ton_case_factor DECIMAL(18,8) NULL,
  MODIFY COLUMN line_tons DECIMAL(18,6) NULL,
  ADD CONSTRAINT ck_version_item_values CHECK (quantity > 0 AND case_price > 0 AND line_amount >= 0 AND (ton_case_factor IS NULL OR ton_case_factor > 0) AND (line_tons IS NULL OR line_tons >= 0));

ALTER TABLE order_operation
  DROP FOREIGN KEY fk_order_operation_admin,
  DROP CHECK ck_order_operation_source,
  DROP COLUMN admin_user_id,
  ADD CONSTRAINT ck_order_operation_source CHECK (source IN ('H5', 'SYSTEM'));
