-- FRESH EMPTY DATABASE ONLY. DBA must stop on first error; never use mysql --force.
-- V037 is Java data cleanup only; an empty new database has no applicable rows.
-- Existing databases MUST use separately reviewed incremental migrations, never this file.
SET NAMES utf8mb4;
SET time_zone = "+00:00";

-- BEGIN V001__initial_schema.sql
-- 订购会系统 MySQL 8.4 LTS 初始结构
-- 时间字段由应用按 UTC 写入，展示时按 activity.timezone 转换。

SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE admin_user (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  username VARCHAR(64) NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role_code VARCHAR(32) NOT NULL DEFAULT 'ADMIN',
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
  password_changed_at DATETIME(3) NULL,
  last_login_at DATETIME(3) NULL,
  lock_version INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_admin_user_username (username),
  CONSTRAINT ck_admin_user_role CHECK (role_code IN ('ADMIN')),
  CONSTRAINT ck_admin_user_status CHECK (status IN ('ACTIVE', 'DISABLED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE admin_session (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  admin_user_id BIGINT UNSIGNED NOT NULL,
  token_hash BINARY(32) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  last_seen_at DATETIME(3) NOT NULL,
  revoked_at DATETIME(3) NULL,
  revoke_reason VARCHAR(255) NULL,
  ip_address VARBINARY(16) NULL,
  user_agent VARCHAR(512) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_admin_session_token_hash (token_hash),
  KEY idx_admin_session_user_expires (admin_user_id, expires_at),
  CONSTRAINT fk_admin_session_user FOREIGN KEY (admin_user_id) REFERENCES admin_user (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE activity (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  activity_code VARCHAR(64) NOT NULL,
  name VARCHAR(200) NOT NULL,
  description TEXT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Shanghai',
  starts_at DATETIME(3) NOT NULL,
  ends_at DATETIME(3) NOT NULL,
  customer_scope VARCHAR(20) NOT NULL DEFAULT 'ALL',
  company_ranking_top_n SMALLINT UNSIGNED NOT NULL DEFAULT 90,
  branch_ranking_top_n SMALLINT UNSIGNED NOT NULL DEFAULT 30,
  ton_display_scale TINYINT UNSIGNED NOT NULL DEFAULT 4,
  version INT UNSIGNED NOT NULL DEFAULT 0,
  created_by BIGINT UNSIGNED NOT NULL,
  updated_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  archived_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_activity_code (activity_code),
  KEY idx_activity_status_time (status, starts_at, ends_at),
  CONSTRAINT fk_activity_created_by FOREIGN KEY (created_by) REFERENCES admin_user (id),
  CONSTRAINT fk_activity_updated_by FOREIGN KEY (updated_by) REFERENCES admin_user (id),
  CONSTRAINT ck_activity_status CHECK (status IN ('DRAFT', 'SCHEDULED', 'ACTIVE', 'CLOSED', 'ARCHIVED')),
  CONSTRAINT ck_activity_scope CHECK (customer_scope IN ('ALL', 'GENERAL', 'SPECIAL')),
  CONSTRAINT ck_activity_time CHECK (starts_at < ends_at),
  CONSTRAINT ck_activity_company_ranking_top CHECK (company_ranking_top_n BETWEEN 1 AND 500),
  CONSTRAINT ck_activity_branch_ranking_top CHECK (branch_ranking_top_n BETWEEN 1 AND 500),
  CONSTRAINT ck_activity_ton_scale CHECK (ton_display_scale BETWEEN 0 AND 6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE stored_file (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  activity_id BIGINT UNSIGNED NULL,
  storage_provider VARCHAR(32) NOT NULL,
  bucket_name VARCHAR(128) NOT NULL,
  object_key VARCHAR(512) NOT NULL,
  original_filename VARCHAR(255) NOT NULL,
  content_type VARCHAR(128) NOT NULL,
  size_bytes BIGINT UNSIGNED NOT NULL,
  sha256 BINARY(32) NOT NULL,
  file_purpose VARCHAR(32) NOT NULL,
  reference_count INT UNSIGNED NOT NULL DEFAULT 0,
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  deleted_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_stored_file_object (bucket_name, object_key),
  KEY idx_stored_file_activity_purpose (activity_id, file_purpose, created_at),
  KEY idx_stored_file_sha256 (sha256),
  CONSTRAINT fk_stored_file_activity FOREIGN KEY (activity_id) REFERENCES activity (id),
  CONSTRAINT fk_stored_file_created_by FOREIGN KEY (created_by) REFERENCES admin_user (id),
  CONSTRAINT ck_stored_file_purpose CHECK (file_purpose IN ('IMPORT_SOURCE', 'PRODUCT_IMAGE', 'IMAGE_ARCHIVE', 'EXPORT_RESULT', 'OTHER'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE import_task (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  activity_id BIGINT UNSIGNED NOT NULL,
  import_type VARCHAR(32) NOT NULL,
  strategy VARCHAR(32) NOT NULL DEFAULT 'FULL_REPLACE',
  status VARCHAR(24) NOT NULL DEFAULT 'UPLOADED',
  source_file_id BIGINT UNSIGNED NOT NULL,
  auxiliary_file_id BIGINT UNSIGNED NULL,
  file_sha256 BINARY(32) NOT NULL,
  input_count INT UNSIGNED NOT NULL DEFAULT 0,
  added_count INT UNSIGNED NOT NULL DEFAULT 0,
  updated_count INT UNSIGNED NOT NULL DEFAULT 0,
  unchanged_count INT UNSIGNED NOT NULL DEFAULT 0,
  deactivated_count INT UNSIGNED NOT NULL DEFAULT 0,
  warning_count INT UNSIGNED NOT NULL DEFAULT 0,
  error_count INT UNSIGNED NOT NULL DEFAULT 0,
  started_at DATETIME(3) NULL,
  preview_ready_at DATETIME(3) NULL,
  confirmed_at DATETIME(3) NULL,
  completed_at DATETIME(3) NULL,
  failed_at DATETIME(3) NULL,
  failure_code VARCHAR(64) NULL,
  failure_message VARCHAR(1000) NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  confirmed_by BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_import_task_activity_type_created (activity_id, import_type, created_at),
  KEY idx_import_task_status_created (status, created_at),
  CONSTRAINT fk_import_task_activity FOREIGN KEY (activity_id) REFERENCES activity (id),
  CONSTRAINT fk_import_task_source_file FOREIGN KEY (source_file_id) REFERENCES stored_file (id),
  CONSTRAINT fk_import_task_aux_file FOREIGN KEY (auxiliary_file_id) REFERENCES stored_file (id),
  CONSTRAINT fk_import_task_created_by FOREIGN KEY (created_by) REFERENCES admin_user (id),
  CONSTRAINT fk_import_task_confirmed_by FOREIGN KEY (confirmed_by) REFERENCES admin_user (id),
  CONSTRAINT ck_import_task_type CHECK (import_type IN ('PRODUCT', 'WHITELIST', 'ATTENDANCE', 'PRODUCT_IMAGE')),
  CONSTRAINT ck_import_task_strategy CHECK (strategy IN ('FULL_REPLACE', 'IMAGE_ATTACH')),
  CONSTRAINT ck_import_task_status CHECK (status IN ('UPLOADED', 'PARSING', 'PREVIEW_READY', 'CONFIRMING', 'COMPLETED', 'FAILED', 'CANCELLED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE import_staging_row (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  import_task_id BIGINT UNSIGNED NOT NULL,
  sheet_name VARCHAR(128) NULL,
  source_row_number INT UNSIGNED NOT NULL,
  row_key VARCHAR(255) NULL,
  diff_type VARCHAR(20) NOT NULL,
  validation_status VARCHAR(20) NOT NULL,
  raw_data_json JSON NULL,
  sensitive_data_ciphertext LONGBLOB NULL,
  normalized_data_json JSON NULL,
  edited_data_json JSON NULL,
  edited_sensitive_data_ciphertext LONGBLOB NULL,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  edited_by BIGINT UNSIGNED NULL,
  edited_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_import_staging_source_row (import_task_id, sheet_name, source_row_number),
  KEY idx_import_staging_task_status (import_task_id, validation_status, diff_type),
  CONSTRAINT fk_import_staging_task FOREIGN KEY (import_task_id) REFERENCES import_task (id),
  CONSTRAINT fk_import_staging_edited_by FOREIGN KEY (edited_by) REFERENCES admin_user (id),
  CONSTRAINT ck_import_staging_diff CHECK (diff_type IN ('ADDED', 'UPDATED', 'UNCHANGED', 'DEACTIVATED', 'POSSIBLE_DUPLICATE', 'PENDING_CONFIRMATION')),
  CONSTRAINT ck_import_staging_validation CHECK (validation_status IN ('VALID', 'WARNING', 'BLOCKED')),
  CONSTRAINT ck_import_staging_payload CHECK (raw_data_json IS NOT NULL OR sensitive_data_ciphertext IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE import_error (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  import_task_id BIGINT UNSIGNED NOT NULL,
  staging_row_id BIGINT UNSIGNED NULL,
  severity VARCHAR(16) NOT NULL,
  error_code VARCHAR(64) NOT NULL,
  sheet_name VARCHAR(128) NULL,
  source_row_number INT UNSIGNED NULL,
  field_name VARCHAR(128) NULL,
  raw_value_masked VARCHAR(1000) NULL,
  message VARCHAR(1000) NOT NULL,
  resolved_at DATETIME(3) NULL,
  resolved_by BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_import_error_task_severity (import_task_id, severity, source_row_number),
  CONSTRAINT fk_import_error_task FOREIGN KEY (import_task_id) REFERENCES import_task (id),
  CONSTRAINT fk_import_error_staging FOREIGN KEY (staging_row_id) REFERENCES import_staging_row (id),
  CONSTRAINT fk_import_error_resolved_by FOREIGN KEY (resolved_by) REFERENCES admin_user (id),
  CONSTRAINT ck_import_error_severity CHECK (severity IN ('WARNING', 'BLOCKING'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE customer (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_type VARCHAR(16) NOT NULL,
  dealer_full_name VARCHAR(255) NOT NULL,
  normalized_dealer_full_name VARCHAR(255) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_customer_type_full_name (customer_type, normalized_dealer_full_name),
  CONSTRAINT ck_customer_type CHECK (customer_type IN ('GENERAL', 'SPECIAL'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE activity_customer (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  activity_id BIGINT UNSIGNED NOT NULL,
  customer_id BIGINT UNSIGNED NOT NULL,
  customer_type VARCHAR(16) NOT NULL,
  region_code VARCHAR(16) NULL,
  branch_name VARCHAR(200) NULL,
  normalized_branch_name VARCHAR(200) NULL,
  dealer_short_name VARCHAR(200) NULL,
  dealer_full_name VARCHAR(255) NOT NULL,
  dealer_category VARCHAR(100) NULL,
  contact_name VARCHAR(100) NULL,
  phone_ciphertext VARBINARY(512) NOT NULL,
  phone_lookup_hash BINARY(32) NOT NULL,
  phone_masked VARCHAR(32) NOT NULL,
  phone_key_version SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  confirmer_name VARCHAR(100) NULL,
  confirmer_phone_ciphertext VARBINARY(512) NULL,
  confirmer_phone_masked VARCHAR(32) NULL,
  excel_sequence INT UNSIGNED NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  deactivated_at DATETIME(3) NULL,
  source_import_task_id BIGINT UNSIGNED NOT NULL,
  lock_version INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_activity_customer_identity (activity_id, customer_id),
  UNIQUE KEY uk_activity_customer_phone (activity_id, customer_type, phone_lookup_hash),
  KEY idx_activity_customer_filter (activity_id, customer_type, is_active, region_code, branch_name),
  KEY idx_activity_customer_dealer_name (activity_id, dealer_full_name),
  CONSTRAINT fk_activity_customer_activity FOREIGN KEY (activity_id) REFERENCES activity (id),
  CONSTRAINT fk_activity_customer_customer FOREIGN KEY (customer_id) REFERENCES customer (id),
  CONSTRAINT fk_activity_customer_import FOREIGN KEY (source_import_task_id) REFERENCES import_task (id),
  CONSTRAINT ck_activity_customer_type CHECK (customer_type IN ('GENERAL', 'SPECIAL')),
  CONSTRAINT ck_activity_customer_region CHECK (region_code IS NULL OR region_code IN ('EAST', 'SOUTH', 'NORTH_1', 'NORTH_2'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE activity_attendee (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  activity_id BIGINT UNSIGNED NOT NULL,
  activity_customer_id BIGINT UNSIGNED NULL,
  participant_name VARCHAR(100) NULL,
  gender VARCHAR(16) NULL,
  participant_type VARCHAR(100) NULL,
  dealer_name_snapshot VARCHAR(255) NOT NULL,
  branch_name_snapshot VARCHAR(200) NULL,
  phone_ciphertext VARBINARY(512) NULL,
  phone_lookup_hash BINARY(32) NULL,
  phone_masked VARCHAR(32) NULL,
  source_import_task_id BIGINT UNSIGNED NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_attendee_activity_customer (activity_id, activity_customer_id, is_active),
  KEY idx_attendee_activity_phone (activity_id, phone_lookup_hash),
  CONSTRAINT fk_attendee_activity FOREIGN KEY (activity_id) REFERENCES activity (id),
  CONSTRAINT fk_attendee_customer FOREIGN KEY (activity_customer_id) REFERENCES activity_customer (id),
  CONSTRAINT fk_attendee_import FOREIGN KEY (source_import_task_id) REFERENCES import_task (id),
  CONSTRAINT fk_attendee_created_by FOREIGN KEY (created_by) REFERENCES admin_user (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE activity_product (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  activity_id BIGINT UNSIGNED NOT NULL,
  customer_type VARCHAR(16) NOT NULL,
  rebate_status VARCHAR(16) NOT NULL,
  business_key VARCHAR(320) NOT NULL,
  material_code VARCHAR(100) NULL,
  material_name VARCHAR(255) NOT NULL,
  category_name VARCHAR(200) NULL,
  product_line VARCHAR(200) NULL,
  brand_name VARCHAR(100) NULL,
  variety_name VARCHAR(100) NULL,
  specification VARCHAR(200) NULL,
  case_pack VARCHAR(100) NULL,
  bottle_price DECIMAL(18,4) NULL,
  case_price DECIMAL(18,4) NOT NULL,
  ton_case_factor DECIMAL(18,8) NOT NULL,
  is_gift_box BOOLEAN NOT NULL DEFAULT FALSE,
  is_branch_customized BOOLEAN NOT NULL DEFAULT FALSE,
  sort_no INT NOT NULL DEFAULT 0,
  data_status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  source_import_task_id BIGINT UNSIGNED NOT NULL,
  lock_version INT UNSIGNED NOT NULL DEFAULT 0,
  deactivated_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_activity_product_business (activity_id, business_key),
  KEY idx_product_catalog (activity_id, customer_type, data_status, rebate_status, sort_no, id),
  KEY idx_product_material_code (activity_id, material_code),
  CONSTRAINT fk_product_activity FOREIGN KEY (activity_id) REFERENCES activity (id),
  CONSTRAINT fk_product_import FOREIGN KEY (source_import_task_id) REFERENCES import_task (id),
  CONSTRAINT ck_product_customer_type CHECK (customer_type IN ('GENERAL', 'SPECIAL')),
  CONSTRAINT ck_product_rebate CHECK (rebate_status IN ('PARTICIPATING', 'NOT_PARTICIPATING')),
  CONSTRAINT ck_product_status CHECK (data_status IN ('ACTIVE', 'INCOMPLETE', 'INACTIVE')),
  CONSTRAINT ck_product_price CHECK (case_price >= 0 AND ton_case_factor >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE activity_product_branch_scope (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  activity_product_id BIGINT UNSIGNED NOT NULL,
  branch_name VARCHAR(200) NOT NULL,
  normalized_branch_name VARCHAR(200) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_product_branch_scope (activity_product_id, normalized_branch_name),
  CONSTRAINT fk_product_branch_product FOREIGN KEY (activity_product_id) REFERENCES activity_product (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE product_image (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  activity_product_id BIGINT UNSIGNED NOT NULL,
  stored_file_id BIGINT UNSIGNED NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  sort_no INT NOT NULL DEFAULT 0,
  source_type VARCHAR(20) NOT NULL,
  match_status VARCHAR(20) NOT NULL DEFAULT 'CONFIRMED',
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  deleted_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_product_image_file (activity_product_id, stored_file_id),
  KEY idx_product_image_sort (activity_product_id, deleted_at, sort_no, id),
  CONSTRAINT fk_product_image_product FOREIGN KEY (activity_product_id) REFERENCES activity_product (id),
  CONSTRAINT fk_product_image_file FOREIGN KEY (stored_file_id) REFERENCES stored_file (id),
  CONSTRAINT fk_product_image_created_by FOREIGN KEY (created_by) REFERENCES admin_user (id),
  CONSTRAINT ck_product_image_source CHECK (source_type IN ('ZIP_IMPORT', 'MANUAL')),
  CONSTRAINT ck_product_image_match CHECK (match_status IN ('MATCHED', 'PENDING', 'UNMATCHED', 'CONFIRMED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE customer_order (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  activity_id BIGINT UNSIGNED NOT NULL,
  activity_customer_id BIGINT UNSIGNED NOT NULL,
  order_no VARCHAR(64) NOT NULL,
  status VARCHAR(20) NOT NULL,
  customer_type VARCHAR(16) NOT NULL,
  region_code VARCHAR(16) NULL,
  branch_name_snapshot VARCHAR(200) NULL,
  dealer_short_name_snapshot VARCHAR(200) NULL,
  dealer_full_name_snapshot VARCHAR(255) NOT NULL,
  current_version_no INT UNSIGNED NOT NULL,
  total_quantity BIGINT UNSIGNED NOT NULL,
  total_tons DECIMAL(18,6) NOT NULL,
  total_amount DECIMAL(18,2) NOT NULL,
  first_submitted_at DATETIME(3) NOT NULL,
  last_submitted_at DATETIME(3) NOT NULL,
  last_modified_at DATETIME(3) NOT NULL,
  withdrawn_at DATETIME(3) NULL,
  withdrawn_reason VARCHAR(500) NULL,
  last_modified_source VARCHAR(20) NOT NULL,
  last_modified_admin_id BIGINT UNSIGNED NULL,
  lock_version INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_order_no (order_no),
  UNIQUE KEY uk_order_activity_customer (activity_id, activity_customer_id),
  KEY idx_order_activity_status_submit (activity_id, status, last_submitted_at),
  KEY idx_order_activity_customer_filter (activity_id, customer_type, region_code, branch_name_snapshot),
  CONSTRAINT fk_order_activity FOREIGN KEY (activity_id) REFERENCES activity (id),
  CONSTRAINT fk_order_customer FOREIGN KEY (activity_customer_id) REFERENCES activity_customer (id),
  CONSTRAINT fk_order_admin FOREIGN KEY (last_modified_admin_id) REFERENCES admin_user (id),
  CONSTRAINT ck_order_status CHECK (status IN ('SUBMITTED', 'WITHDRAWN')),
  CONSTRAINT ck_order_customer_type CHECK (customer_type IN ('GENERAL', 'SPECIAL')),
  CONSTRAINT ck_order_source CHECK (last_modified_source IN ('H5', 'ADMIN', 'SYSTEM')),
  CONSTRAINT ck_order_totals CHECK (total_quantity > 0 AND total_tons >= 0 AND total_amount >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE order_item (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id BIGINT UNSIGNED NOT NULL,
  activity_product_id BIGINT UNSIGNED NOT NULL,
  line_no INT UNSIGNED NOT NULL,
  material_code VARCHAR(100) NULL,
  material_name VARCHAR(255) NOT NULL,
  category_name VARCHAR(200) NULL,
  product_line VARCHAR(200) NULL,
  brand_name VARCHAR(100) NULL,
  variety_name VARCHAR(100) NULL,
  specification VARCHAR(200) NULL,
  case_pack VARCHAR(100) NULL,
  rebate_status VARCHAR(16) NOT NULL,
  is_gift_box BOOLEAN NOT NULL,
  primary_image_object_key VARCHAR(512) NULL,
  quantity BIGINT UNSIGNED NOT NULL,
  case_price DECIMAL(18,4) NOT NULL,
  line_amount DECIMAL(18,2) NOT NULL,
  ton_case_factor DECIMAL(18,8) NOT NULL,
  line_tons DECIMAL(18,6) NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_order_item_product (order_id, activity_product_id),
  UNIQUE KEY uk_order_item_line (order_id, line_no),
  CONSTRAINT fk_order_item_order FOREIGN KEY (order_id) REFERENCES customer_order (id),
  CONSTRAINT fk_order_item_product FOREIGN KEY (activity_product_id) REFERENCES activity_product (id),
  CONSTRAINT ck_order_item_rebate CHECK (rebate_status IN ('PARTICIPATING', 'NOT_PARTICIPATING')),
  CONSTRAINT ck_order_item_values CHECK (quantity > 0 AND case_price >= 0 AND line_amount >= 0 AND ton_case_factor >= 0 AND line_tons >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE order_version (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  activity_id BIGINT UNSIGNED NOT NULL,
  order_id BIGINT UNSIGNED NOT NULL,
  version_no INT UNSIGNED NOT NULL,
  customer_type VARCHAR(16) NOT NULL,
  region_code VARCHAR(16) NULL,
  branch_name_snapshot VARCHAR(200) NULL,
  dealer_short_name_snapshot VARCHAR(200) NULL,
  dealer_full_name_snapshot VARCHAR(255) NOT NULL,
  total_quantity BIGINT UNSIGNED NOT NULL,
  total_tons DECIMAL(18,6) NOT NULL,
  total_amount DECIMAL(18,2) NOT NULL,
  submitted_source VARCHAR(20) NOT NULL,
  submitted_by_admin_id BIGINT UNSIGNED NULL,
  submitted_at DATETIME(3) NOT NULL,
  request_idempotency_key VARCHAR(128) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_order_version_no (order_id, version_no),
  UNIQUE KEY uk_order_version_idempotency (order_id, request_idempotency_key),
  KEY idx_order_version_activity_time (activity_id, submitted_at),
  CONSTRAINT fk_order_version_activity FOREIGN KEY (activity_id) REFERENCES activity (id),
  CONSTRAINT fk_order_version_order FOREIGN KEY (order_id) REFERENCES customer_order (id),
  CONSTRAINT fk_order_version_admin FOREIGN KEY (submitted_by_admin_id) REFERENCES admin_user (id),
  CONSTRAINT ck_order_version_customer CHECK (customer_type IN ('GENERAL', 'SPECIAL')),
  CONSTRAINT ck_order_version_region CHECK (region_code IS NULL OR region_code IN ('EAST', 'SOUTH', 'NORTH_1', 'NORTH_2')),
  CONSTRAINT ck_order_version_source CHECK (submitted_source IN ('H5', 'ADMIN')),
  CONSTRAINT ck_order_version_totals CHECK (total_quantity > 0 AND total_tons >= 0 AND total_amount >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE order_version_item (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_version_id BIGINT UNSIGNED NOT NULL,
  line_no INT UNSIGNED NOT NULL,
  activity_product_id BIGINT UNSIGNED NULL,
  material_code VARCHAR(100) NULL,
  material_name VARCHAR(255) NOT NULL,
  category_name VARCHAR(200) NULL,
  product_line VARCHAR(200) NULL,
  brand_name VARCHAR(100) NULL,
  variety_name VARCHAR(100) NULL,
  specification VARCHAR(200) NULL,
  case_pack VARCHAR(100) NULL,
  customer_type VARCHAR(16) NOT NULL,
  rebate_status VARCHAR(16) NOT NULL,
  is_gift_box BOOLEAN NOT NULL,
  primary_image_object_key VARCHAR(512) NULL,
  quantity BIGINT UNSIGNED NOT NULL,
  case_price DECIMAL(18,4) NOT NULL,
  line_amount DECIMAL(18,2) NOT NULL,
  ton_case_factor DECIMAL(18,8) NOT NULL,
  line_tons DECIMAL(18,6) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_order_version_item_line (order_version_id, line_no),
  KEY idx_order_version_item_product_line (order_version_id, product_line),
  CONSTRAINT fk_version_item_version FOREIGN KEY (order_version_id) REFERENCES order_version (id),
  CONSTRAINT fk_version_item_product FOREIGN KEY (activity_product_id) REFERENCES activity_product (id),
  CONSTRAINT ck_version_item_customer CHECK (customer_type IN ('GENERAL', 'SPECIAL')),
  CONSTRAINT ck_version_item_rebate CHECK (rebate_status IN ('PARTICIPATING', 'NOT_PARTICIPATING')),
  CONSTRAINT ck_version_item_values CHECK (quantity > 0 AND case_price >= 0 AND line_amount >= 0 AND ton_case_factor >= 0 AND line_tons >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE order_operation (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  activity_id BIGINT UNSIGNED NOT NULL,
  order_id BIGINT UNSIGNED NOT NULL,
  operation_type VARCHAR(24) NOT NULL,
  source VARCHAR(20) NOT NULL,
  admin_user_id BIGINT UNSIGNED NULL,
  order_version_no INT UNSIGNED NULL,
  reason VARCHAR(500) NULL,
  trace_id VARCHAR(64) NULL,
  occurred_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_order_operation_order_time (order_id, occurred_at),
  KEY idx_order_operation_activity_time (activity_id, occurred_at),
  CONSTRAINT fk_order_operation_activity FOREIGN KEY (activity_id) REFERENCES activity (id),
  CONSTRAINT fk_order_operation_order FOREIGN KEY (order_id) REFERENCES customer_order (id),
  CONSTRAINT fk_order_operation_admin FOREIGN KEY (admin_user_id) REFERENCES admin_user (id),
  CONSTRAINT ck_order_operation_type CHECK (operation_type IN ('FIRST_SUBMIT', 'MODIFY_SUBMIT', 'WITHDRAW', 'RESUBMIT')),
  CONSTRAINT ck_order_operation_source CHECK (source IN ('H5', 'ADMIN', 'SYSTEM'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE api_idempotency (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  activity_id BIGINT UNSIGNED NOT NULL,
  actor_type VARCHAR(16) NOT NULL,
  actor_id BIGINT UNSIGNED NOT NULL,
  endpoint_code VARCHAR(64) NOT NULL,
  idempotency_key VARCHAR(128) NOT NULL,
  request_hash BINARY(32) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'PROCESSING',
  http_status SMALLINT UNSIGNED NULL,
  response_json JSON NULL,
  resource_type VARCHAR(64) NULL,
  resource_id BIGINT UNSIGNED NULL,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  completed_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_api_idempotency (activity_id, actor_type, actor_id, endpoint_code, idempotency_key),
  KEY idx_api_idempotency_expiry (expires_at, status),
  CONSTRAINT fk_api_idempotency_activity FOREIGN KEY (activity_id) REFERENCES activity (id),
  CONSTRAINT ck_api_idempotency_actor CHECK (actor_type IN ('H5_CUSTOMER', 'ADMIN')),
  CONSTRAINT ck_api_idempotency_status CHECK (status IN ('PROCESSING', 'COMPLETED', 'FAILED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE visit_event (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  activity_id BIGINT UNSIGNED NOT NULL,
  activity_customer_id BIGINT UNSIGNED NULL,
  event_type VARCHAR(32) NOT NULL,
  customer_type VARCHAR(16) NULL,
  success BOOLEAN NOT NULL DEFAULT TRUE,
  failure_code VARCHAR(64) NULL,
  session_id_hash BINARY(32) NULL,
  ip_address VARBINARY(16) NULL,
  user_agent VARCHAR(512) NULL,
  occurred_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_visit_event_activity_type_time (activity_id, event_type, occurred_at),
  KEY idx_visit_event_customer_time (activity_customer_id, occurred_at),
  CONSTRAINT fk_visit_event_activity FOREIGN KEY (activity_id) REFERENCES activity (id),
  CONSTRAINT fk_visit_event_customer FOREIGN KEY (activity_customer_id) REFERENCES activity_customer (id),
  CONSTRAINT ck_visit_event_type CHECK (event_type IN ('H5_OPEN', 'PHONE_VERIFY', 'PRODUCT_VIEW', 'ORDER_SUBMIT_ATTEMPT', 'ORDER_SUBMIT_SUCCESS', 'ORDER_SUBMIT_FAILURE')),
  CONSTRAINT ck_visit_event_customer_type CHECK (customer_type IS NULL OR customer_type IN ('GENERAL', 'SPECIAL'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE lottery_rule (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  activity_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(200) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  created_by BIGINT UNSIGNED NOT NULL,
  updated_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_lottery_rule_activity_status (activity_id, status),
  CONSTRAINT fk_lottery_rule_activity FOREIGN KEY (activity_id) REFERENCES activity (id),
  CONSTRAINT fk_lottery_rule_created_by FOREIGN KEY (created_by) REFERENCES admin_user (id),
  CONSTRAINT fk_lottery_rule_updated_by FOREIGN KEY (updated_by) REFERENCES admin_user (id),
  CONSTRAINT ck_lottery_rule_status CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE lottery_round (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  activity_id BIGINT UNSIGNED NOT NULL,
  lottery_rule_id BIGINT UNSIGNED NOT NULL,
  round_no INT UNSIGNED NOT NULL,
  name VARCHAR(200) NOT NULL,
  prize_name VARCHAR(200) NULL,
  winner_count INT UNSIGNED NOT NULL,
  candidate_scope VARCHAR(20) NOT NULL,
  customer_type VARCHAR(16) NOT NULL DEFAULT 'ALL',
  minimum_order_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  qualification_cutoff_at DATETIME(3) NULL,
  exclude_previous_winners BOOLEAN NOT NULL DEFAULT TRUE,
  display_name_type VARCHAR(20) NOT NULL DEFAULT 'SHORT_NAME',
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  current_attempt_no INT UNSIGNED NOT NULL DEFAULT 0,
  candidate_count INT UNSIGNED NULL,
  result_hash BINARY(32) NULL,
  drawn_at DATETIME(3) NULL,
  drawn_by BIGINT UNSIGNED NULL,
  completed_at DATETIME(3) NULL,
  reset_at DATETIME(3) NULL,
  reset_by BIGINT UNSIGNED NULL,
  reset_reason VARCHAR(500) NULL,
  lock_version INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_lottery_round_rule_no (lottery_rule_id, round_no),
  KEY idx_lottery_round_activity_status (activity_id, status, round_no),
  CONSTRAINT fk_lottery_round_activity FOREIGN KEY (activity_id) REFERENCES activity (id),
  CONSTRAINT fk_lottery_round_rule FOREIGN KEY (lottery_rule_id) REFERENCES lottery_rule (id),
  CONSTRAINT fk_lottery_round_drawn_by FOREIGN KEY (drawn_by) REFERENCES admin_user (id),
  CONSTRAINT fk_lottery_round_reset_by FOREIGN KEY (reset_by) REFERENCES admin_user (id),
  CONSTRAINT ck_lottery_round_scope CHECK (candidate_scope IN ('ALL_CUSTOMERS', 'ATTENDEES', 'VALID_ORDERS')),
  CONSTRAINT ck_lottery_round_customer CHECK (customer_type IN ('ALL', 'GENERAL', 'SPECIAL')),
  CONSTRAINT ck_lottery_round_status CHECK (status IN ('DRAFT', 'READY', 'DRAWING', 'DRAWN', 'COMPLETED', 'RESET')),
  CONSTRAINT ck_lottery_round_count CHECK (winner_count > 0 AND minimum_order_amount >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE lottery_draw_attempt (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  activity_id BIGINT UNSIGNED NOT NULL,
  round_id BIGINT UNSIGNED NOT NULL,
  attempt_no INT UNSIGNED NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAWN',
  candidate_count INT UNSIGNED NOT NULL,
  winner_count INT UNSIGNED NOT NULL,
  rule_snapshot_json JSON NOT NULL,
  result_hash BINARY(32) NOT NULL,
  drawn_at DATETIME(3) NOT NULL,
  drawn_by BIGINT UNSIGNED NOT NULL,
  invalidated_at DATETIME(3) NULL,
  invalidated_by BIGINT UNSIGNED NULL,
  invalidated_reason VARCHAR(500) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_lottery_attempt_round_no (round_id, attempt_no),
  KEY idx_lottery_attempt_activity_status (activity_id, status, drawn_at),
  CONSTRAINT fk_lottery_attempt_activity FOREIGN KEY (activity_id) REFERENCES activity (id),
  CONSTRAINT fk_lottery_attempt_round FOREIGN KEY (round_id) REFERENCES lottery_round (id),
  CONSTRAINT fk_lottery_attempt_drawn_by FOREIGN KEY (drawn_by) REFERENCES admin_user (id),
  CONSTRAINT fk_lottery_attempt_invalidated_by FOREIGN KEY (invalidated_by) REFERENCES admin_user (id),
  CONSTRAINT ck_lottery_attempt_status CHECK (status IN ('DRAWN', 'INVALIDATED')),
  CONSTRAINT ck_lottery_attempt_counts CHECK (attempt_no > 0 AND candidate_count >= winner_count AND winner_count > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE lottery_candidate_snapshot (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  activity_id BIGINT UNSIGNED NOT NULL,
  round_id BIGINT UNSIGNED NOT NULL,
  draw_attempt_id BIGINT UNSIGNED NOT NULL,
  activity_customer_id BIGINT UNSIGNED NOT NULL,
  dealer_short_name_snapshot VARCHAR(200) NULL,
  dealer_full_name_snapshot VARCHAR(255) NOT NULL,
  customer_type VARCHAR(16) NOT NULL,
  region_code VARCHAR(16) NULL,
  branch_name_snapshot VARCHAR(200) NULL,
  phone_masked_snapshot VARCHAR(32) NULL,
  qualification_source VARCHAR(20) NOT NULL,
  qualifying_order_id BIGINT UNSIGNED NULL,
  qualifying_order_amount DECIMAL(18,2) NULL,
  random_sort_key BINARY(32) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_lottery_candidate_attempt_customer (draw_attempt_id, activity_customer_id),
  KEY idx_lottery_candidate_attempt_random (draw_attempt_id, random_sort_key),
  KEY idx_lottery_candidate_round (round_id, draw_attempt_id),
  CONSTRAINT fk_lottery_candidate_activity FOREIGN KEY (activity_id) REFERENCES activity (id),
  CONSTRAINT fk_lottery_candidate_round FOREIGN KEY (round_id) REFERENCES lottery_round (id),
  CONSTRAINT fk_lottery_candidate_attempt FOREIGN KEY (draw_attempt_id) REFERENCES lottery_draw_attempt (id),
  CONSTRAINT fk_lottery_candidate_customer FOREIGN KEY (activity_customer_id) REFERENCES activity_customer (id),
  CONSTRAINT fk_lottery_candidate_order FOREIGN KEY (qualifying_order_id) REFERENCES customer_order (id),
  CONSTRAINT ck_lottery_candidate_customer CHECK (customer_type IN ('GENERAL', 'SPECIAL')),
  CONSTRAINT ck_lottery_candidate_source CHECK (qualification_source IN ('ALL_CUSTOMERS', 'ATTENDEES', 'VALID_ORDERS'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE lottery_winner (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  activity_id BIGINT UNSIGNED NOT NULL,
  round_id BIGINT UNSIGNED NOT NULL,
  draw_attempt_id BIGINT UNSIGNED NOT NULL,
  candidate_snapshot_id BIGINT UNSIGNED NOT NULL,
  activity_customer_id BIGINT UNSIGNED NOT NULL,
  winner_position INT UNSIGNED NOT NULL,
  dealer_display_name_snapshot VARCHAR(255) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'VALID',
  invalidated_reason VARCHAR(500) NULL,
  invalidated_at DATETIME(3) NULL,
  invalidated_by BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_lottery_winner_attempt_customer (draw_attempt_id, activity_customer_id),
  UNIQUE KEY uk_lottery_winner_attempt_position (draw_attempt_id, winner_position),
  KEY idx_lottery_winner_activity_status (activity_id, status, created_at),
  CONSTRAINT fk_lottery_winner_activity FOREIGN KEY (activity_id) REFERENCES activity (id),
  CONSTRAINT fk_lottery_winner_round FOREIGN KEY (round_id) REFERENCES lottery_round (id),
  CONSTRAINT fk_lottery_winner_attempt FOREIGN KEY (draw_attempt_id) REFERENCES lottery_draw_attempt (id),
  CONSTRAINT fk_lottery_winner_candidate FOREIGN KEY (candidate_snapshot_id) REFERENCES lottery_candidate_snapshot (id),
  CONSTRAINT fk_lottery_winner_customer FOREIGN KEY (activity_customer_id) REFERENCES activity_customer (id),
  CONSTRAINT fk_lottery_winner_invalidated_by FOREIGN KEY (invalidated_by) REFERENCES admin_user (id),
  CONSTRAINT ck_lottery_winner_status CHECK (status IN ('VALID', 'INVALIDATED')),
  CONSTRAINT ck_lottery_winner_position CHECK (winner_position > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE export_task (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  activity_id BIGINT UNSIGNED NOT NULL,
  export_type VARCHAR(32) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  filter_json JSON NULL,
  result_file_id BIGINT UNSIGNED NULL,
  row_count INT UNSIGNED NULL,
  failure_code VARCHAR(64) NULL,
  failure_message VARCHAR(1000) NULL,
  expires_at DATETIME(3) NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  started_at DATETIME(3) NULL,
  completed_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_export_task_activity_created (activity_id, export_type, created_at),
  KEY idx_export_task_status_created (status, created_at),
  CONSTRAINT fk_export_task_activity FOREIGN KEY (activity_id) REFERENCES activity (id),
  CONSTRAINT fk_export_task_file FOREIGN KEY (result_file_id) REFERENCES stored_file (id),
  CONSTRAINT fk_export_task_created_by FOREIGN KEY (created_by) REFERENCES admin_user (id),
  CONSTRAINT ck_export_task_type CHECK (export_type IN ('ORDER_SUMMARY', 'ORDER_ITEMS', 'ORDER_VERSIONS', 'VISIT_FUNNEL', 'LOTTERY_WINNERS', 'IMPORT_ERRORS')),
  CONSTRAINT ck_export_task_status CHECK (status IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'EXPIRED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE audit_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  activity_id BIGINT UNSIGNED NULL,
  actor_type VARCHAR(16) NOT NULL,
  admin_user_id BIGINT UNSIGNED NULL,
  action_code VARCHAR(64) NOT NULL,
  object_type VARCHAR(64) NOT NULL,
  object_id VARCHAR(128) NULL,
  reason VARCHAR(500) NULL,
  before_json JSON NULL,
  after_json JSON NULL,
  result VARCHAR(16) NOT NULL,
  error_code VARCHAR(64) NULL,
  trace_id VARCHAR(64) NOT NULL,
  ip_address VARBINARY(16) NULL,
  user_agent VARCHAR(512) NULL,
  occurred_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_audit_activity_time (activity_id, occurred_at),
  KEY idx_audit_actor_time (admin_user_id, occurred_at),
  KEY idx_audit_object_time (object_type, object_id, occurred_at),
  KEY idx_audit_action_time (action_code, occurred_at),
  CONSTRAINT fk_audit_activity FOREIGN KEY (activity_id) REFERENCES activity (id),
  CONSTRAINT fk_audit_admin FOREIGN KEY (admin_user_id) REFERENCES admin_user (id),
  CONSTRAINT ck_audit_actor CHECK (actor_type IN ('ADMIN', 'H5_CUSTOMER', 'SYSTEM')),
  CONSTRAINT ck_audit_result CHECK (result IN ('SUCCESS', 'FAILURE'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE domain_event_outbox (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  activity_id BIGINT UNSIGNED NOT NULL,
  aggregate_type VARCHAR(64) NOT NULL,
  aggregate_id VARCHAR(128) NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  payload_json JSON NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  retry_count INT UNSIGNED NOT NULL DEFAULT 0,
  available_at DATETIME(3) NOT NULL,
  published_at DATETIME(3) NULL,
  last_error VARCHAR(1000) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_outbox_status_available (status, available_at, id),
  KEY idx_outbox_activity_created (activity_id, created_at),
  CONSTRAINT fk_outbox_activity FOREIGN KEY (activity_id) REFERENCES activity (id),
  CONSTRAINT ck_outbox_status CHECK (status IN ('PENDING', 'PUBLISHED', 'FAILED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- END V001__initial_schema.sql

-- BEGIN V002__confirmed_order_and_catalog_rules.sql
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

-- END V002__confirmed_order_and_catalog_rules.sql

-- BEGIN V003__widen_rebate_status.sql
ALTER TABLE activity_product
  MODIFY COLUMN rebate_status VARCHAR(20) NOT NULL;

ALTER TABLE order_item
  MODIFY COLUMN rebate_status VARCHAR(20) NOT NULL;

ALTER TABLE order_version_item
  MODIFY COLUMN rebate_status VARCHAR(20) NOT NULL;

-- END V003__widen_rebate_status.sql

-- BEGIN V004__attendance_matching_status.sql
-- 到场名单每次全量替换，并基于当前白名单重新计算精确关联结果。

ALTER TABLE activity_attendee
  ADD COLUMN match_status VARCHAR(32) NOT NULL DEFAULT 'UNMATCHED' AFTER activity_customer_id,
  ADD COLUMN match_method VARCHAR(32) NULL AFTER match_status,
  ADD COLUMN match_reason_code VARCHAR(64) NULL AFTER match_method,
  ADD KEY idx_attendee_activity_match (activity_id, data_version_id, match_status, is_active),
  ADD CONSTRAINT ck_attendee_match_status CHECK (match_status IN ('MATCHED', 'PENDING_CONFIRMATION', 'UNMATCHED')),
  ADD CONSTRAINT ck_attendee_match_method CHECK (match_method IS NULL OR match_method IN ('PHONE', 'FULL_NAME', 'SHORT_NAME', 'MANUAL'));

UPDATE activity_attendee
SET match_status = IF(activity_customer_id IS NULL, 'UNMATCHED', 'MATCHED'),
    match_method = IF(activity_customer_id IS NULL, NULL, 'MANUAL'),
    match_reason_code = IF(activity_customer_id IS NULL, 'LEGACY_UNMATCHED', NULL);

-- END V004__attendance_matching_status.sql

-- BEGIN V005__product_import_image_decisions.sql
ALTER TABLE import_task
  ADD COLUMN image_decisions_json JSON NULL AFTER auxiliary_file_id;

-- END V005__product_import_image_decisions.sql

-- BEGIN V006__product_image_review_candidates.sql
CREATE TABLE product_image_review_candidate (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  activity_id BIGINT UNSIGNED NOT NULL,
  data_version_id BIGINT UNSIGNED NOT NULL,
  import_task_id BIGINT UNSIGNED NOT NULL,
  stored_file_id BIGINT UNSIGNED NOT NULL,
  archive_path VARCHAR(1000) NOT NULL,
  material_code VARCHAR(128) NOT NULL,
  normalized_material_code VARCHAR(128) NOT NULL,
  material_name VARCHAR(500) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  resolved_by BIGINT UNSIGNED NULL,
  resolved_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_image_review_version_file_code (data_version_id, stored_file_id, normalized_material_code),
  KEY idx_image_review_activity_version_status (activity_id, data_version_id, status, normalized_material_code),
  CONSTRAINT fk_image_review_activity FOREIGN KEY (activity_id) REFERENCES activity (id),
  CONSTRAINT fk_image_review_version FOREIGN KEY (data_version_id) REFERENCES import_publish_version (id),
  CONSTRAINT fk_image_review_task FOREIGN KEY (import_task_id) REFERENCES import_task (id),
  CONSTRAINT fk_image_review_file FOREIGN KEY (stored_file_id) REFERENCES stored_file (id),
  CONSTRAINT fk_image_review_resolver FOREIGN KEY (resolved_by) REFERENCES admin_user (id),
  CONSTRAINT ck_image_review_status CHECK (status IN ('PENDING', 'SELECTED', 'EXCLUDED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- END V006__product_image_review_candidates.sql

-- BEGIN V007__attendance_preview_whitelist_version.sql
ALTER TABLE import_task
  ADD COLUMN match_base_version_id BIGINT UNSIGNED NULL AFTER auxiliary_file_id,
  ADD KEY idx_import_task_match_base_version (match_base_version_id),
  ADD CONSTRAINT fk_import_task_match_base_version
    FOREIGN KEY (match_base_version_id) REFERENCES import_publish_version (id);

-- END V007__attendance_preview_whitelist_version.sql

-- BEGIN V008__activity_lifecycle_timestamps.sql
ALTER TABLE activity
  ADD COLUMN published_at DATETIME(3) NULL AFTER updated_at,
  ADD COLUMN actual_started_at DATETIME(3) NULL AFTER published_at,
  ADD COLUMN closed_at DATETIME(3) NULL AFTER actual_started_at;

-- END V008__activity_lifecycle_timestamps.sql

-- BEGIN V009__cancel_superseded_import_previews.sql
UPDATE import_task t
JOIN activity_data_binding b
  ON b.activity_id = t.activity_id
 AND b.data_type = t.import_type
JOIN import_publish_version v
  ON v.id = b.current_version_id
SET t.status = 'CANCELLED'
WHERE t.id < v.source_import_task_id
  AND t.status IN ('UPLOADED', 'PARSING', 'PREVIEW_READY');

-- END V009__cancel_superseded_import_previews.sql

-- BEGIN V010__h5_order_draft.sql
CREATE TABLE h5_order_draft (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  activity_id BIGINT UNSIGNED NOT NULL,
  activity_customer_id BIGINT UNSIGNED NOT NULL,
  base_order_version INT UNSIGNED NOT NULL DEFAULT 0,
  items_json JSON NOT NULL,
  lock_version INT UNSIGNED NOT NULL DEFAULT 0,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_h5_order_draft_customer (activity_id, activity_customer_id),
  KEY idx_h5_order_draft_expires (expires_at),
  CONSTRAINT fk_h5_order_draft_activity FOREIGN KEY (activity_id) REFERENCES activity (id),
  CONSTRAINT fk_h5_order_draft_customer FOREIGN KEY (activity_customer_id) REFERENCES activity_customer (id),
  CONSTRAINT ck_h5_order_draft_items CHECK (JSON_TYPE(items_json) = 'ARRAY' AND JSON_LENGTH(items_json) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- END V010__h5_order_draft.sql

-- BEGIN V011__normalize_h5_draft_timestamps_to_utc.sql
-- V010 initially relied on CURRENT_TIMESTAMP while the MySQL container runs in Asia/Shanghai.
-- Correct only timestamps that are clearly in the future relative to UTC, so UTC-based installs are unchanged.
UPDATE h5_order_draft
SET created_at = DATE_SUB(created_at, INTERVAL 8 HOUR)
WHERE created_at > DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 1 HOUR);

UPDATE h5_order_draft
SET updated_at = DATE_SUB(updated_at, INTERVAL 8 HOUR)
WHERE updated_at > DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 1 HOUR);

-- END V011__normalize_h5_draft_timestamps_to_utc.sql

-- BEGIN V012__activity_finish_and_dashboard_snapshots.sql
ALTER TABLE activity
  ADD COLUMN event_ends_at DATETIME(3) NULL AFTER ends_at,
  ADD COLUMN finished_at DATETIME(3) NULL AFTER closed_at;

ALTER TABLE activity DROP CHECK ck_activity_status;
ALTER TABLE activity
  ADD CONSTRAINT ck_activity_status
  CHECK (status IN ('DRAFT', 'SCHEDULED', 'ACTIVE', 'CLOSED', 'FINISHED', 'ARCHIVED'));

ALTER TABLE activity
  ADD CONSTRAINT ck_activity_event_time
  CHECK (event_ends_at IS NULL OR ends_at <= event_ends_at);

CREATE TABLE activity_dashboard_snapshot (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  activity_id BIGINT UNSIGNED NOT NULL,
  snapshot_key VARCHAR(200) NOT NULL,
  payload_json JSON NOT NULL,
  generated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_activity_dashboard_snapshot (activity_id, snapshot_key),
  CONSTRAINT fk_activity_dashboard_snapshot_activity
    FOREIGN KEY (activity_id) REFERENCES activity (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- END V012__activity_finish_and_dashboard_snapshots.sql

-- BEGIN V013__product_volume_price_tier.sql
CREATE TABLE activity_product_price_tier (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  activity_product_id BIGINT UNSIGNED NOT NULL,
  min_quantity BIGINT UNSIGNED NOT NULL,
  case_price DECIMAL(18,4) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_product_price_tier (activity_product_id),
  CONSTRAINT fk_product_price_tier_product FOREIGN KEY (activity_product_id) REFERENCES activity_product (id),
  CONSTRAINT ck_product_price_tier_values CHECK (min_quantity >= 2 AND case_price > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE order_item
  ADD COLUMN applied_tier_min_quantity BIGINT UNSIGNED NULL AFTER case_price,
  ADD CONSTRAINT ck_order_item_applied_tier CHECK (applied_tier_min_quantity IS NULL OR applied_tier_min_quantity >= 2);

ALTER TABLE order_version_item
  ADD COLUMN applied_tier_min_quantity BIGINT UNSIGNED NULL AFTER case_price,
  ADD CONSTRAINT ck_order_version_item_applied_tier CHECK (applied_tier_min_quantity IS NULL OR applied_tier_min_quantity >= 2);

-- END V013__product_volume_price_tier.sql

-- BEGIN V014__synchronize_whitelist_regions.sql
-- Repair legacy whitelist rows where an admin-entered region name was stored directly as region_code.
-- Only regionalized activities are affected; activities with no active regions remain unregionalized.
INSERT INTO activity_region(activity_id, region_code, region_name, sort_no, is_active)
SELECT orphan.activity_id,
       CONCAT('R_', UPPER(SUBSTRING(SHA2(orphan.region_name, 256), 1, 12))),
       orphan.region_name,
       1000 + ROW_NUMBER() OVER (PARTITION BY orphan.activity_id ORDER BY orphan.region_name) * 10,
       TRUE
FROM (
  SELECT DISTINCT c.activity_id, TRIM(c.region_code) AS region_name
  FROM activity_customer c
  WHERE c.customer_type = 'GENERAL'
    AND c.region_code IS NOT NULL
    AND TRIM(c.region_code) <> ''
    AND EXISTS (
      SELECT 1 FROM activity_region configured
      WHERE configured.activity_id = c.activity_id AND configured.is_active = TRUE
    )
    AND NOT EXISTS (
      SELECT 1 FROM activity_region matched
      WHERE matched.activity_id = c.activity_id
        AND matched.is_active = TRUE
        AND (matched.region_code = c.region_code OR matched.region_name = TRIM(c.region_code))
    )
) orphan
ON DUPLICATE KEY UPDATE is_active = TRUE;

UPDATE activity_customer c
JOIN activity_region r
  ON r.activity_id = c.activity_id
 AND r.region_name = TRIM(c.region_code)
 AND r.is_active = TRUE
SET c.region_code = r.region_code
WHERE c.customer_type = 'GENERAL'
  AND c.region_code IS NOT NULL
  AND c.region_code <> r.region_code;

-- END V014__synchronize_whitelist_regions.sql

-- BEGIN V015__derive_regions_from_whitelist.sql
-- The active whitelist is now the only source of H5 region options.
-- Keep activity_region as an internal dictionary and canonicalize any remaining legacy names.
INSERT INTO activity_region(activity_id, region_code, region_name, sort_no, is_active)
SELECT orphan.activity_id,
       CONCAT('R_', UPPER(SUBSTRING(SHA2(orphan.region_name, 256), 1, 12))),
       orphan.region_name,
       1000 + ROW_NUMBER() OVER (PARTITION BY orphan.activity_id ORDER BY orphan.region_name) * 10,
       TRUE
FROM (
  SELECT DISTINCT c.activity_id, TRIM(c.region_code) AS region_name
  FROM activity_customer c
  WHERE c.customer_type = 'GENERAL'
    AND c.region_code IS NOT NULL
    AND TRIM(c.region_code) <> ''
    AND NOT EXISTS (
      SELECT 1 FROM activity_region matched
      WHERE matched.activity_id = c.activity_id
        AND (matched.region_code = c.region_code OR matched.region_name = TRIM(c.region_code))
    )
) orphan
ON DUPLICATE KEY UPDATE is_active = TRUE;

UPDATE activity_customer c
JOIN activity_region r
  ON r.activity_id = c.activity_id
 AND r.region_name = TRIM(c.region_code)
SET c.region_code = r.region_code
WHERE c.customer_type = 'GENERAL'
  AND c.region_code IS NOT NULL
  AND c.region_code <> r.region_code;

-- END V015__derive_regions_from_whitelist.sql

-- BEGIN V016__incremental_product_volume_pricing.sql
ALTER TABLE activity_product_price_tier
  ADD COLUMN pricing_mode VARCHAR(20) NOT NULL DEFAULT 'WHOLE_ORDER' AFTER case_price,
  ADD CONSTRAINT ck_product_price_tier_mode CHECK (pricing_mode IN ('WHOLE_ORDER', 'INCREMENTAL'));

ALTER TABLE order_item
  ADD COLUMN base_case_price DECIMAL(18,4) NULL AFTER applied_tier_min_quantity,
  ADD COLUMN base_price_quantity BIGINT UNSIGNED NULL AFTER base_case_price,
  ADD COLUMN tier_case_price DECIMAL(18,4) NULL AFTER base_price_quantity,
  ADD COLUMN tier_min_quantity BIGINT UNSIGNED NULL AFTER tier_case_price,
  ADD COLUMN tier_price_quantity BIGINT UNSIGNED NULL AFTER tier_min_quantity,
  ADD COLUMN pricing_mode VARCHAR(20) NULL AFTER tier_price_quantity,
  ADD CONSTRAINT ck_order_item_pricing_mode CHECK (pricing_mode IS NULL OR pricing_mode IN ('WHOLE_ORDER', 'INCREMENTAL'));

ALTER TABLE order_version_item
  ADD COLUMN base_case_price DECIMAL(18,4) NULL AFTER applied_tier_min_quantity,
  ADD COLUMN base_price_quantity BIGINT UNSIGNED NULL AFTER base_case_price,
  ADD COLUMN tier_case_price DECIMAL(18,4) NULL AFTER base_price_quantity,
  ADD COLUMN tier_min_quantity BIGINT UNSIGNED NULL AFTER tier_case_price,
  ADD COLUMN tier_price_quantity BIGINT UNSIGNED NULL AFTER tier_min_quantity,
  ADD COLUMN pricing_mode VARCHAR(20) NULL AFTER tier_price_quantity,
  ADD CONSTRAINT ck_order_version_item_pricing_mode CHECK (pricing_mode IS NULL OR pricing_mode IN ('WHOLE_ORDER', 'INCREMENTAL'));

UPDATE order_item
SET base_case_price = case_price, base_price_quantity = quantity
WHERE base_case_price IS NULL;

UPDATE order_version_item
SET base_case_price = case_price, base_price_quantity = quantity
WHERE base_case_price IS NULL;

-- END V016__incremental_product_volume_pricing.sql

-- BEGIN V017__department_accounts_and_activity_scope.sql
-- 部门账号与活动归属：一个部门一个后台账号；活动按部门隔离。

CREATE TABLE department (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  department_code VARCHAR(64) NOT NULL,
  department_name VARCHAR(100) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  lock_version INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_department_code (department_code),
  CONSTRAINT ck_department_status CHECK (status IN ('ACTIVE', 'DISABLED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO department(department_code, department_name, status)
VALUES ('DEFAULT', '默认业务部门', 'ACTIVE');

ALTER TABLE admin_user
  ADD COLUMN department_id BIGINT UNSIGNED NULL AFTER role_code,
  DROP CHECK ck_admin_user_role;

UPDATE admin_user
SET role_code = 'SUPER_ADMIN'
WHERE role_code = 'ADMIN';

ALTER TABLE admin_user
  ADD CONSTRAINT fk_admin_user_department FOREIGN KEY (department_id) REFERENCES department (id),
  ADD CONSTRAINT uk_admin_user_department UNIQUE (department_id),
  ADD CONSTRAINT ck_admin_user_role CHECK (role_code IN ('SUPER_ADMIN', 'DEPARTMENT_ADMIN'));

ALTER TABLE activity
  ADD COLUMN department_id BIGINT UNSIGNED NULL AFTER id;

UPDATE activity a
JOIN department d ON d.department_code = 'DEFAULT'
SET a.department_id = d.id
WHERE a.department_id IS NULL;

ALTER TABLE activity
  MODIFY COLUMN department_id BIGINT UNSIGNED NOT NULL,
  ADD KEY idx_activity_department_status_time (department_id, status, starts_at, ends_at),
  ADD CONSTRAINT fk_activity_department FOREIGN KEY (department_id) REFERENCES department (id);

-- END V017__department_accounts_and_activity_scope.sql

-- BEGIN V018__enforce_admin_department_role.sql
-- 管理员角色与部门归属保持一致：超级管理员不绑定部门，部门账号必须绑定部门。
ALTER TABLE admin_user
  ADD CONSTRAINT ck_admin_user_department_role CHECK (
    (role_code = 'SUPER_ADMIN' AND department_id IS NULL)
    OR (role_code = 'DEPARTMENT_ADMIN' AND department_id IS NOT NULL)
  );

-- END V018__enforce_admin_department_role.sql

-- BEGIN V019__index_department_activity_publication_time.sql
-- 同部门发布时间冲突查询按部门、状态、发布时间和完整活动时间快速定位。
ALTER TABLE activity
  ADD KEY idx_activity_department_publication_time
    (department_id, status, published_at, starts_at, event_ends_at, ends_at);

-- END V019__index_department_activity_publication_time.sql

-- BEGIN V020__unified_product_import_fields.sql
-- 商品导入统一为单 Sheet：客户类型、返利类型可为空，商品名称负责判重，产品说明进入商品目录。
ALTER TABLE activity_product
  ADD COLUMN description TEXT NULL AFTER material_name,
  DROP CHECK ck_product_customer_type,
  DROP CHECK ck_product_rebate,
  ADD CONSTRAINT ck_product_customer_type CHECK (customer_type IN ('GENERAL', 'SPECIAL', 'ALL')),
  ADD CONSTRAINT ck_product_rebate CHECK (rebate_status IN ('PARTICIPATING', 'NOT_PARTICIPATING', 'ALL'));

ALTER TABLE order_item
  DROP CHECK ck_order_item_rebate,
  ADD CONSTRAINT ck_order_item_rebate CHECK (rebate_status IN ('PARTICIPATING', 'NOT_PARTICIPATING', 'ALL'));

ALTER TABLE order_version_item
  DROP CHECK ck_version_item_rebate,
  ADD CONSTRAINT ck_version_item_rebate CHECK (rebate_status IN ('PARTICIPATING', 'NOT_PARTICIPATING', 'ALL'));

ALTER TABLE product_image_review_candidate
  ADD COLUMN normalized_material_name VARCHAR(512) NULL AFTER material_name;

UPDATE product_image_review_candidate
SET normalized_material_name = LOWER(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(material_name), ' ', ''), '　', ''), '-', ''), '_', ''))
WHERE normalized_material_name IS NULL OR normalized_material_name = '';

ALTER TABLE product_image_review_candidate
  MODIFY COLUMN normalized_material_name VARCHAR(512) NOT NULL,
  DROP INDEX uk_image_review_version_file_code,
  DROP INDEX idx_image_review_activity_version_status,
  ADD UNIQUE KEY uk_image_review_version_file_name (data_version_id, stored_file_id, normalized_material_name),
  ADD KEY idx_image_review_activity_version_status (activity_id, data_version_id, status, normalized_material_name);

-- END V020__unified_product_import_fields.sql

-- BEGIN V021__untyped_whitelist_and_branch_identity.sql
-- 白名单统一为单 Sheet：空客户类型代表不区分客户类型（ALL），经销商身份按客户类型 + 全称 + 分公司判重。
ALTER TABLE customer
  ADD COLUMN branch_name VARCHAR(200) NOT NULL DEFAULT '' AFTER normalized_dealer_full_name,
  ADD COLUMN normalized_branch_name VARCHAR(200) NOT NULL DEFAULT '' AFTER branch_name,
  DROP INDEX uk_customer_type_full_name,
  DROP CHECK ck_customer_type,
  ADD UNIQUE KEY uk_customer_type_full_name_branch (customer_type, normalized_dealer_full_name, normalized_branch_name),
  ADD CONSTRAINT ck_customer_type CHECK (customer_type IN ('GENERAL', 'SPECIAL', 'ALL'));

ALTER TABLE activity_customer
  ADD COLUMN normalized_dealer_full_name VARCHAR(255) NOT NULL DEFAULT '' AFTER dealer_full_name,
  DROP CHECK ck_activity_customer_type,
  ADD CONSTRAINT ck_activity_customer_type CHECK (customer_type IN ('GENERAL', 'SPECIAL', 'ALL'));

UPDATE activity_customer
SET normalized_dealer_full_name = LOWER(REPLACE(REPLACE(TRIM(dealer_full_name), ' ', ''), '　', ''))
WHERE normalized_dealer_full_name = '';

UPDATE activity_customer
SET normalized_branch_name = LOWER(REPLACE(REPLACE(TRIM(COALESCE(branch_name, '')), ' ', ''), '　', ''))
WHERE normalized_branch_name IS NULL;

ALTER TABLE activity_customer
  ADD UNIQUE KEY uk_activity_customer_name_branch
    (activity_id, data_version_id, customer_type, normalized_dealer_full_name, normalized_branch_name);

ALTER TABLE customer_order
  DROP CHECK ck_order_customer_type,
  ADD CONSTRAINT ck_order_customer_type CHECK (customer_type IN ('GENERAL', 'SPECIAL', 'ALL'));

ALTER TABLE order_version
  DROP CHECK ck_order_version_customer,
  ADD CONSTRAINT ck_order_version_customer CHECK (customer_type IN ('GENERAL', 'SPECIAL', 'ALL'));

ALTER TABLE order_version_item
  DROP CHECK ck_version_item_customer,
  ADD CONSTRAINT ck_version_item_customer CHECK (customer_type IN ('GENERAL', 'SPECIAL', 'ALL'));

ALTER TABLE visit_event
  DROP CHECK ck_visit_event_customer_type,
  ADD CONSTRAINT ck_visit_event_customer_type CHECK (customer_type IS NULL OR customer_type IN ('GENERAL', 'SPECIAL', 'ALL'));

ALTER TABLE lottery_candidate_snapshot
  DROP CHECK ck_lottery_candidate_customer,
  ADD CONSTRAINT ck_lottery_candidate_customer CHECK (customer_type IN ('GENERAL', 'SPECIAL', 'ALL'));

-- END V021__untyped_whitelist_and_branch_identity.sql

-- BEGIN V022__admin_order_management.sql
ALTER TABLE customer_order
  DROP CHECK ck_order_status,
  DROP CHECK ck_order_source,
  ADD COLUMN created_source VARCHAR(20) NOT NULL DEFAULT 'H5' AFTER dealer_full_name_snapshot,
  ADD COLUMN created_by_admin_id BIGINT UNSIGNED NULL AFTER created_source,
  ADD COLUMN last_modified_admin_id BIGINT UNSIGNED NULL AFTER last_modified_source,
  ADD COLUMN voided_at DATETIME(3) NULL AFTER withdrawn_reason,
  ADD COLUMN voided_reason VARCHAR(500) NULL AFTER voided_at,
  ADD COLUMN voided_by_admin_id BIGINT UNSIGNED NULL AFTER voided_reason,
  ADD CONSTRAINT fk_order_created_admin FOREIGN KEY (created_by_admin_id) REFERENCES admin_user (id),
  ADD CONSTRAINT fk_order_modified_admin FOREIGN KEY (last_modified_admin_id) REFERENCES admin_user (id),
  ADD CONSTRAINT fk_order_voided_admin FOREIGN KEY (voided_by_admin_id) REFERENCES admin_user (id),
  ADD CONSTRAINT ck_order_status CHECK (status IN ('SUBMITTED', 'WITHDRAWN', 'VOIDED')),
  ADD CONSTRAINT ck_order_created_source CHECK (created_source IN ('H5', 'ADMIN')),
  ADD CONSTRAINT ck_order_source CHECK (last_modified_source IN ('H5', 'ADMIN', 'SYSTEM'));

ALTER TABLE order_version
  DROP CHECK ck_order_version_source,
  ADD COLUMN submitted_by_admin_id BIGINT UNSIGNED NULL AFTER submitted_source,
  ADD COLUMN reason VARCHAR(500) NULL AFTER submitted_by_admin_id,
  ADD CONSTRAINT fk_order_version_admin FOREIGN KEY (submitted_by_admin_id) REFERENCES admin_user (id),
  ADD CONSTRAINT ck_order_version_source CHECK (submitted_source IN ('H5', 'ADMIN'));

ALTER TABLE order_operation
  DROP CHECK ck_order_operation_type,
  DROP CHECK ck_order_operation_source,
  ADD COLUMN admin_user_id BIGINT UNSIGNED NULL AFTER source,
  ADD CONSTRAINT fk_order_operation_admin FOREIGN KEY (admin_user_id) REFERENCES admin_user (id),
  ADD CONSTRAINT ck_order_operation_type CHECK (
    operation_type IN ('FIRST_SUBMIT', 'MODIFY_SUBMIT', 'WITHDRAW', 'RESUBMIT',
      'ADMIN_CREATE', 'ADMIN_ADJUST', 'ADMIN_VOID', 'ADMIN_RESTORE')
  ),
  ADD CONSTRAINT ck_order_operation_source CHECK (source IN ('H5', 'ADMIN', 'SYSTEM'));

-- END V022__admin_order_management.sql

-- BEGIN V023__plaintext_phone_storage.sql
ALTER TABLE activity_customer
  ADD COLUMN phone VARCHAR(32) NULL AFTER contact_name,
  ADD COLUMN confirmer_phone VARCHAR(32) NULL AFTER confirmer_name,
  MODIFY COLUMN phone_ciphertext VARBINARY(512) NULL;

ALTER TABLE activity_attendee
  ADD COLUMN phone VARCHAR(32) NULL AFTER branch_name_snapshot;

-- END V023__plaintext_phone_storage.sql

-- BEGIN V024__price_sync_batch.sql
CREATE TABLE price_sync_batch (
  batch_key VARCHAR(128) PRIMARY KEY,
  activity_id BIGINT UNSIGNED NOT NULL,
  admin_id BIGINT UNSIGNED NOT NULL,
  request_hash VARCHAR(64) NOT NULL,
  result_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
);

-- END V024__price_sync_batch.sql

-- BEGIN V025__attendance_branch_full_name_matching.sql
-- 记录现场到场名单按“客户类型 + 分公司 + 经销商全称”关联的匹配依据。
ALTER TABLE activity_attendee
  DROP CHECK ck_attendee_match_method,
  ADD CONSTRAINT ck_attendee_match_method CHECK (match_method IS NULL OR match_method IN ('PHONE', 'FULL_NAME', 'FULL_NAME_BRANCH', 'SHORT_NAME', 'MANUAL'));

-- END V025__attendance_branch_full_name_matching.sql

-- BEGIN V026__department_account_password_policy.sql
-- 部门共享账号由超级管理员统一管理密码，不再要求部门首次登录改密。
-- 超级管理员继续使用 admin_user.must_change_password 的原有安全策略。
UPDATE admin_user u
JOIN department d ON d.id = u.department_id
SET u.display_name = d.department_name,
    u.must_change_password = FALSE,
    u.password_changed_at = COALESCE(u.password_changed_at, UTC_TIMESTAMP(3))
WHERE u.role_code = 'DEPARTMENT_ADMIN';

-- END V026__department_account_password_policy.sql

-- BEGIN V027__lottery_box_count_threshold.sql
ALTER TABLE lottery_round
  ADD COLUMN qualification_metric VARCHAR(20) NOT NULL DEFAULT 'AMOUNT' AFTER minimum_order_amount,
  ADD COLUMN minimum_order_box_count BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER qualification_metric,
  ADD CONSTRAINT ck_lottery_round_qualification_metric
    CHECK (qualification_metric IN ('AMOUNT', 'BOX_COUNT'));

ALTER TABLE lottery_candidate_snapshot
  ADD COLUMN qualifying_order_box_count BIGINT UNSIGNED NULL AFTER qualifying_order_amount;

-- END V027__lottery_box_count_threshold.sql

-- BEGIN V028__lottery_prize_images.sql
ALTER TABLE stored_file
  DROP CHECK ck_stored_file_purpose,
  ADD CONSTRAINT ck_stored_file_purpose
    CHECK (file_purpose IN ('IMPORT_SOURCE', 'PRODUCT_IMAGE', 'IMAGE_ARCHIVE', 'LOTTERY_PRIZE_IMAGE', 'EXPORT_RESULT', 'OTHER'));

ALTER TABLE lottery_round
  ADD COLUMN prize_image_file_id BIGINT UNSIGNED NULL AFTER prize_name,
  ADD KEY idx_lottery_round_prize_image (prize_image_file_id),
  ADD CONSTRAINT fk_lottery_round_prize_image
    FOREIGN KEY (prize_image_file_id) REFERENCES stored_file (id);

-- END V028__lottery_prize_images.sql

-- BEGIN V029__product_identity_includes_material_code.sql
ALTER TABLE import_staging_row
  MODIFY COLUMN row_key VARCHAR(512) NULL;

ALTER TABLE activity_product
  MODIFY COLUMN business_key VARCHAR(512) NOT NULL;

-- END V029__product_identity_includes_material_code.sql

-- BEGIN V030__product_dealer_scope.sql
CREATE TABLE activity_product_dealer_scope (
  activity_product_id BIGINT UNSIGNED NOT NULL,
  normalized_branch_name VARCHAR(200) NOT NULL,
  branch_name VARCHAR(200) NOT NULL,
  PRIMARY KEY (activity_product_id, normalized_branch_name),
  FOREIGN KEY (activity_product_id) REFERENCES activity_product(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE activity_product_dealer_member (
  activity_product_id BIGINT UNSIGNED NOT NULL,
  normalized_branch_name VARCHAR(200) NOT NULL,
  customer_id BIGINT UNSIGNED NOT NULL,
  customer_type VARCHAR(16) NOT NULL,
  normalized_dealer_full_name VARCHAR(255) NOT NULL,
  dealer_full_name VARCHAR(255) NOT NULL,
  PRIMARY KEY (activity_product_id, normalized_branch_name, customer_id),
  FOREIGN KEY (activity_product_id, normalized_branch_name)
    REFERENCES activity_product_dealer_scope(activity_product_id, normalized_branch_name),
  FOREIGN KEY (customer_id) REFERENCES customer(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE product_scope_change_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  activity_id BIGINT UNSIGNED NOT NULL,
  activity_product_id BIGINT UNSIGNED NOT NULL,
  admin_user_id BIGINT UNSIGNED NOT NULL,
  before_json JSON NOT NULL,
  after_json JSON NOT NULL,
  reason VARCHAR(500) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_scope_log_activity (activity_id, activity_product_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- END V030__product_dealer_scope.sql

-- BEGIN V031__reconcile_product_dealer_scope_branch_changes.sql
CREATE TEMPORARY TABLE product_dealer_scope_cleanup (
  activity_product_id BIGINT UNSIGNED NOT NULL PRIMARY KEY
);

INSERT INTO product_dealer_scope_cleanup(activity_product_id)
SELECT DISTINCT n.id
FROM activity_product n
JOIN activity_data_binding b
  ON b.activity_id = n.activity_id AND b.data_type = 'PRODUCT'
JOIN import_publish_version current_version
  ON current_version.id = b.current_version_id
JOIN import_publish_version previous_version
  ON previous_version.activity_id = current_version.activity_id
  AND previous_version.data_type = 'PRODUCT'
  AND previous_version.version_no = (
    SELECT MAX(previous_candidate.version_no)
    FROM import_publish_version previous_candidate
    WHERE previous_candidate.activity_id = current_version.activity_id
      AND previous_candidate.data_type = 'PRODUCT'
      AND previous_candidate.version_no < current_version.version_no
  )
JOIN activity_product o
  ON o.activity_id = n.activity_id
  AND o.data_version_id = previous_version.id
  AND o.business_key = n.business_key
WHERE n.data_version_id = current_version.id
  AND (
    EXISTS (
      SELECT 1
      FROM activity_product_branch_scope old_scope
      LEFT JOIN activity_product_branch_scope new_scope
        ON new_scope.activity_product_id = n.id
        AND new_scope.normalized_branch_name = old_scope.normalized_branch_name
      WHERE old_scope.activity_product_id = o.id
        AND new_scope.id IS NULL
    )
    OR EXISTS (
      SELECT 1
      FROM activity_product_branch_scope new_scope
      LEFT JOIN activity_product_branch_scope old_scope
        ON old_scope.activity_product_id = o.id
        AND old_scope.normalized_branch_name = new_scope.normalized_branch_name
      WHERE new_scope.activity_product_id = n.id
        AND old_scope.id IS NULL
    )
  )
  AND EXISTS (
    SELECT 1 FROM activity_product_dealer_scope stale_scope
    WHERE stale_scope.activity_product_id = n.id
  );

DELETE member_scope
FROM activity_product_dealer_member member_scope
JOIN product_dealer_scope_cleanup cleanup
  ON cleanup.activity_product_id = member_scope.activity_product_id;

DELETE dealer_scope
FROM activity_product_dealer_scope dealer_scope
JOIN product_dealer_scope_cleanup cleanup
  ON cleanup.activity_product_id = dealer_scope.activity_product_id;

DROP TEMPORARY TABLE product_dealer_scope_cleanup;

-- END V031__reconcile_product_dealer_scope_branch_changes.sql

-- BEGIN V032__lottery_order_amount_weighting.sql
ALTER TABLE lottery_round
  ADD COLUMN probability_mode VARCHAR(32) NOT NULL DEFAULT 'EQUAL' AFTER qualification_metric,
  ADD CONSTRAINT ck_lottery_round_probability_mode
    CHECK (probability_mode IN ('EQUAL', 'ORDER_AMOUNT_WEIGHTED'));

-- END V032__lottery_order_amount_weighting.sql

-- BEGIN V033__order_change_review.sql
CREATE TABLE order_change_request (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  activity_id BIGINT UNSIGNED NOT NULL,
  order_id BIGINT UNSIGNED NOT NULL,
  activity_customer_id BIGINT UNSIGNED NOT NULL,
  request_type VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  base_order_version INT UNSIGNED NOT NULL,
  base_lock_version INT UNSIGNED NOT NULL,
  requested_total_quantity BIGINT UNSIGNED NULL,
  requested_total_tons DECIMAL(18,6) NULL,
  requested_total_amount DECIMAL(18,2) NULL,
  requested_items_json JSON NOT NULL,
  customer_note VARCHAR(500) NULL,
  review_reason VARCHAR(500) NULL,
  reviewed_by_admin_id BIGINT UNSIGNED NULL,
  requested_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  reviewed_at DATETIME(3) NULL,
  idempotency_key VARCHAR(128) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_order_change_request_idempotency (activity_id, activity_customer_id, idempotency_key),
  KEY idx_order_change_request_activity_status (activity_id, status, requested_at),
  KEY idx_order_change_request_order_status (order_id, status, requested_at),
  CONSTRAINT fk_order_change_request_activity FOREIGN KEY (activity_id) REFERENCES activity (id),
  CONSTRAINT fk_order_change_request_order FOREIGN KEY (order_id) REFERENCES customer_order (id),
  CONSTRAINT fk_order_change_request_customer FOREIGN KEY (activity_customer_id) REFERENCES activity_customer (id),
  CONSTRAINT fk_order_change_request_admin FOREIGN KEY (reviewed_by_admin_id) REFERENCES admin_user (id),
  CONSTRAINT ck_order_change_request_type CHECK (request_type IN ('MODIFY', 'WITHDRAW')),
  CONSTRAINT ck_order_change_request_status CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CONFLICTED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE order_operation
  DROP CHECK ck_order_operation_type,
  ADD CONSTRAINT ck_order_operation_type CHECK (
    operation_type IN ('FIRST_SUBMIT', 'MODIFY_SUBMIT', 'WITHDRAW', 'RESUBMIT',
      'ADMIN_CREATE', 'ADMIN_ADJUST', 'ADMIN_VOID', 'ADMIN_RESTORE',
      'H5_CHANGE_REQUESTED', 'H5_CHANGE_APPROVED', 'H5_CHANGE_REJECTED')
  );

-- END V033__order_change_review.sql

-- BEGIN V034__order_review_workbench.sql
UPDATE order_change_request SET status='REJECTED', review_reason=COALESCE(review_reason,'订单已发生变化，请重新提交') WHERE status='CONFLICTED';
ALTER TABLE order_change_request DROP CHECK ck_order_change_request_status,
  ADD COLUMN original_order_json JSON NULL,
  ADD CONSTRAINT ck_order_change_request_status CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  ADD COLUMN pending_order_id BIGINT UNSIGNED GENERATED ALWAYS AS (CASE WHEN status='PENDING' THEN order_id ELSE NULL END) STORED,
  ADD UNIQUE KEY uk_order_change_pending (pending_order_id);

-- END V034__order_review_workbench.sql

-- BEGIN V035__department_members.sql
-- One administrator per department, multiple individual members.
ALTER TABLE admin_user
  DROP CHECK ck_admin_user_department_role,
  DROP CHECK ck_admin_user_role,
  ADD KEY idx_admin_user_department (department_id),
  DROP INDEX uk_admin_user_department,
  ADD COLUMN department_admin_scope BIGINT UNSIGNED GENERATED ALWAYS AS
    (CASE WHEN role_code = 'DEPARTMENT_ADMIN' THEN department_id ELSE NULL END) STORED,
  ADD UNIQUE KEY uk_department_admin_scope (department_admin_scope),
  ADD CONSTRAINT ck_admin_user_role CHECK (role_code IN ('SUPER_ADMIN','DEPARTMENT_ADMIN','DEPARTMENT_MEMBER')),
  ADD CONSTRAINT ck_admin_user_department_role CHECK
    ((role_code = 'SUPER_ADMIN' AND department_id IS NULL) OR
     (role_code IN ('DEPARTMENT_ADMIN','DEPARTMENT_MEMBER') AND department_id IS NOT NULL));

CREATE TABLE admin_user_permission (
  admin_user_id BIGINT UNSIGNED NOT NULL,
  permission_code VARCHAR(32) NOT NULL,
  PRIMARY KEY (admin_user_id, permission_code),
  CONSTRAINT fk_member_permission_user FOREIGN KEY (admin_user_id) REFERENCES admin_user(id),
  CONSTRAINT ck_member_permission CHECK (permission_code IN ('OVERVIEW','PRODUCT','WHITELIST','ATTENDANCE','ORDER','LOTTERY'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Do not invent historical identities; old rows retain their actual actor ID.
ALTER TABLE audit_log ADD COLUMN actor_identity_snapshot VARCHAR(255) NULL,
  ADD COLUMN actor_role_snapshot VARCHAR(32) NULL;
ALTER TABLE order_operation ADD COLUMN actor_identity_snapshot VARCHAR(255) NULL,
  ADD COLUMN actor_role_snapshot VARCHAR(32) NULL;
ALTER TABLE order_version ADD COLUMN actor_identity_snapshot VARCHAR(255) NULL;
ALTER TABLE order_change_request ADD COLUMN reviewer_identity_snapshot VARCHAR(255) NULL;

-- END V035__department_members.sql

-- BEGIN V036__sum_available_order_tons.sql
-- Use saved line values only; never reprice or read current catalog factors.
UPDATE order_item SET line_tons = 0, updated_at = updated_at WHERE line_tons IS NULL;
UPDATE order_version_item SET line_tons = 0 WHERE line_tons IS NULL;

UPDATE customer_order o LEFT JOIN (
  SELECT order_id, SUM(line_tons) tons FROM order_item GROUP BY order_id
) i ON i.order_id = o.id
SET o.total_tons = COALESCE(i.tons, 0), o.updated_at = o.updated_at;

UPDATE order_version v LEFT JOIN (
  SELECT order_version_id, SUM(line_tons) tons FROM order_version_item GROUP BY order_version_id
) i ON i.order_version_id = v.id
SET v.total_tons = COALESCE(i.tons, 0);

UPDATE order_change_request r SET requested_total_tons = (
  SELECT COALESCE(SUM(j.tons), 0)
  FROM JSON_TABLE(r.requested_items_json, '$[*]' COLUMNS(tons DECIMAL(18,6) PATH '$.lineTons' NULL ON EMPTY)) j
) WHERE request_type = 'MODIFY';

UPDATE order_change_request r SET original_order_json = JSON_SET(original_order_json, '$.totalTons', (
  SELECT COALESCE(SUM(j.tons), 0)
  FROM JSON_TABLE(r.original_order_json, '$.items[*]' COLUMNS(tons DECIMAL(18,6) PATH '$.lineTons' NULL ON EMPTY)) j
)) WHERE original_order_json IS NOT NULL;

-- Dashboard snapshots already sum available lines. Preserve the snapshots and
-- immutable idempotency response receipts; the UI displays legacy null as zero.

-- END V036__sum_available_order_tons.sql

-- BEGIN V038__activity_live_room_url.sql
ALTER TABLE activity ADD COLUMN live_room_url VARCHAR(2048) NULL;

-- END V038__activity_live_room_url.sql

-- BEGIN V039__activity_backgrounds.sql
ALTER TABLE activity
    ADD COLUMN h5_background_file_id BIGINT UNSIGNED NULL,
    ADD COLUMN desktop_background_file_id BIGINT UNSIGNED NULL,
    ADD CONSTRAINT fk_activity_h5_background FOREIGN KEY (h5_background_file_id) REFERENCES stored_file(id),
    ADD CONSTRAINT fk_activity_desktop_background FOREIGN KEY (desktop_background_file_id) REFERENCES stored_file(id);

ALTER TABLE stored_file DROP CHECK ck_stored_file_purpose;
ALTER TABLE stored_file ADD CONSTRAINT ck_stored_file_purpose CHECK (
    file_purpose IN ('IMPORT_SOURCE', 'PRODUCT_IMAGE', 'IMAGE_ARCHIVE', 'EXPORT_RESULT', 'OTHER', 'LOTTERY_PRIZE_IMAGE', 'ACTIVITY_BACKGROUND')
);

-- END V039__activity_backgrounds.sql

-- BEGIN V040__dashboard_order_summaries.sql
-- Derived data only. Existing orders deliberately remain on the raw-query fallback until rebuilt.
CREATE TABLE order_dashboard_stat (
  order_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  dirty BOOLEAN NOT NULL DEFAULT TRUE,
  item_count BIGINT NOT NULL DEFAULT 0,
  all_tons DECIMAL(38,6) NULL,
  eligible_tons DECIMAL(38,6) NULL,
  rebuilt_at DATETIME(3) NULL,
  CONSTRAINT fk_dashboard_stat_order FOREIGN KEY (order_id) REFERENCES customer_order(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE order_dashboard_product_line_stat (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  order_id BIGINT UNSIGNED NOT NULL,
  product_line VARCHAR(200) NULL,
  is_gift_box BOOLEAN NOT NULL,
  line_amount DECIMAL(38,2) NULL,
  quantity DECIMAL(38,0) NULL,
  KEY idx_dashboard_line_order (order_id),
  CONSTRAINT fk_dashboard_line_order FOREIGN KEY (order_id) REFERENCES customer_order(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Mark only the changed order. This also protects reads after maintenance SQL or an older app write.
-- Do not aggregate per detail row: normal writes rebuild once at the end of the business transaction.
CREATE TRIGGER dashboard_item_insert AFTER INSERT ON order_item FOR EACH ROW
  INSERT INTO order_dashboard_stat(order_id, dirty) VALUES (NEW.order_id, TRUE)
  ON DUPLICATE KEY UPDATE dirty = TRUE;

CREATE TRIGGER dashboard_item_delete AFTER DELETE ON order_item FOR EACH ROW
  INSERT INTO order_dashboard_stat(order_id, dirty) VALUES (OLD.order_id, TRUE)
  ON DUPLICATE KEY UPDATE dirty = TRUE;

DELIMITER $$
CREATE TRIGGER dashboard_item_update AFTER UPDATE ON order_item FOR EACH ROW
BEGIN
  INSERT INTO order_dashboard_stat(order_id, dirty) VALUES (OLD.order_id, TRUE)
  ON DUPLICATE KEY UPDATE dirty = TRUE;
  IF NEW.order_id <> OLD.order_id THEN
    INSERT INTO order_dashboard_stat(order_id, dirty) VALUES (NEW.order_id, TRUE)
    ON DUPLICATE KEY UPDATE dirty = TRUE;
  END IF;
END$$
DELIMITER ;

-- END V040__dashboard_order_summaries.sql

-- BEGIN V041__drop_order_item_dashboard_triggers.sql
-- Per-row triggers rewrote order_dashboard_stat once for every order line. The summary reader stays off on the
-- H5 submit path. When it is enabled, DashboardSummaryStore.refresh marks the order dirty once at the end of the
-- business transaction and rebuilds. Raw SQL that changes order_item no longer marks the order dirty; use
-- DashboardSummaryCommand (check / rebuild / repair).

DROP TRIGGER IF EXISTS dashboard_item_insert;
DROP TRIGGER IF EXISTS dashboard_item_delete;
DROP TRIGGER IF EXISTS dashboard_item_update;

-- END V041__drop_order_item_dashboard_triggers.sql

-- BEGIN V042__activity_info_stream_version.sql
-- Public activity synchronization is independent of admin optimistic locking and order events.
ALTER TABLE activity ADD COLUMN public_info_version BIGINT NOT NULL DEFAULT 1;

-- END V042__activity_info_stream_version.sql

-- BEGIN V043__product_catalog_cache_version.sql
-- Shared H5 catalog snapshots have their own revision, including image and visibility changes.
ALTER TABLE activity ADD COLUMN product_catalog_version BIGINT NOT NULL DEFAULT 1;

-- END V043__product_catalog_cache_version.sql

-- BEGIN V044__ranking_filters.sql
-- History stores the complete filterable basis, independently of displayed TopN results.
CREATE TABLE activity_ranking_snapshot (
  activity_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  options_json JSON NOT NULL,
  data_version BIGINT NOT NULL,
  generated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_ranking_snapshot_activity FOREIGN KEY (activity_id) REFERENCES activity(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE activity_ranking_order_snapshot (
  activity_id BIGINT UNSIGNED NOT NULL,
  id BIGINT UNSIGNED NOT NULL,
  customer_type VARCHAR(16) NOT NULL,
  region_code VARCHAR(64) NULL,
  dealer_full_name_snapshot VARCHAR(255) NOT NULL,
  branch_name_snapshot VARCHAR(200) NULL,
  total_amount DECIMAL(18,2) NOT NULL,
  total_quantity BIGINT UNSIGNED NOT NULL,
  last_submitted_at DATETIME(3) NOT NULL,
  all_tons DECIMAL(38,6) NULL,
  eligible_tons DECIMAL(38,6) NULL,
  PRIMARY KEY (activity_id, id),
  KEY idx_ranking_snapshot_customer (activity_id, customer_type, region_code),
  KEY idx_ranking_snapshot_region (activity_id, region_code),
  CONSTRAINT fk_ranking_snapshot_order_activity FOREIGN KEY (activity_id) REFERENCES activity_ranking_snapshot(activity_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE activity_ranking_product_snapshot (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  activity_id BIGINT UNSIGNED NOT NULL,
  order_id BIGINT UNSIGNED NOT NULL,
  product_line VARCHAR(200) NULL,
  variety_name VARCHAR(100) NULL,
  amount DECIMAL(38,2) NOT NULL,
  quantity DECIMAL(38,0) NOT NULL,
  all_tons DECIMAL(38,6) NULL,
  eligible_tons DECIMAL(38,6) NULL,
  KEY idx_ranking_snapshot_product (activity_id, order_id, product_line, variety_name),
  KEY idx_ranking_snapshot_variety (activity_id, order_id, variety_name),
  CONSTRAINT fk_ranking_snapshot_product_activity FOREIGN KEY (activity_id) REFERENCES activity_ranking_snapshot(activity_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- END V044__ranking_filters.sql

-- BEGIN V045__lottery_product_filters_and_tons.sql
ALTER TABLE lottery_round
  DROP CHECK ck_lottery_round_qualification_metric,
  ADD COLUMN minimum_order_tons DECIMAL(18,6) NOT NULL DEFAULT 0,
  ADD COLUMN product_line VARCHAR(200) NULL,
  ADD COLUMN product_line_unassigned BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN varieties_json JSON NULL,
  ADD COLUMN include_unspecified_variety BOOLEAN NOT NULL DEFAULT FALSE,
  ADD CONSTRAINT ck_lottery_round_qualification_metric CHECK (qualification_metric IN ('AMOUNT','BOX_COUNT','TONS')),
  ADD CONSTRAINT ck_lottery_round_tons CHECK (minimum_order_tons >= 0);

ALTER TABLE lottery_candidate_snapshot
  ADD COLUMN qualifying_order_tons DECIMAL(18,6) NULL,
  ADD COLUMN missing_tonnage_items INT UNSIGNED NOT NULL DEFAULT 0;

-- END V045__lottery_product_filters_and_tons.sql

-- BEGIN V046__lottery_box_and_tons_weighting.sql
ALTER TABLE lottery_round
  DROP CHECK ck_lottery_round_probability_mode,
  ADD CONSTRAINT ck_lottery_round_probability_mode
    CHECK (probability_mode IN ('EQUAL', 'ORDER_AMOUNT_WEIGHTED', 'ORDER_BOX_COUNT_WEIGHTED', 'ORDER_TONS_WEIGHTED')),
  ADD CONSTRAINT ck_lottery_round_weight_metric
    CHECK ((probability_mode <> 'ORDER_BOX_COUNT_WEIGHTED' OR qualification_metric = 'BOX_COUNT')
       AND (probability_mode <> 'ORDER_TONS_WEIGHTED' OR qualification_metric = 'TONS'));

-- END V046__lottery_box_and_tons_weighting.sql

-- BEGIN V047__multiple_price_tiers.sql
ALTER TABLE activity_product_price_tier
  DROP INDEX uk_product_price_tier,
  ADD UNIQUE KEY uk_product_price_tier (activity_product_id, min_quantity);

ALTER TABLE order_item ADD COLUMN pricing_details JSON NULL;
ALTER TABLE order_version_item ADD COLUMN pricing_details JSON NULL;

-- The product-leading index supports selecting only orders affected by a product price change.
CREATE INDEX idx_order_item_product_order ON order_item (activity_product_id, order_id);

-- END V047__multiple_price_tiers.sql

-- BEGIN V048__independent_first_price_tier.sql
-- Store the first price explicitly, independently of the ordinary product case price.
ALTER TABLE activity_product_price_tier
  DROP CHECK ck_product_price_tier_values,
  ADD CONSTRAINT ck_product_price_tier_values CHECK (min_quantity >= 1 AND case_price > 0);

-- Preserve the old pricing result. Current orders and immutable history are not rewritten.
INSERT INTO activity_product_price_tier(activity_product_id, min_quantity, case_price, pricing_mode)
SELECT p.id, 1, p.case_price, t.pricing_mode
FROM activity_product p
JOIN (
  SELECT activity_product_id, MIN(pricing_mode) AS pricing_mode
  FROM activity_product_price_tier
  GROUP BY activity_product_id
  HAVING MIN(min_quantity) > 1
) t ON t.activity_product_id = p.id
WHERE p.case_price > 0;

-- Existing cached catalogs must load the complete first-price rules after the upgrade.
UPDATE activity a
SET product_catalog_version = product_catalog_version + 1
WHERE EXISTS (
  SELECT 1 FROM activity_product p
  JOIN activity_product_price_tier t ON t.activity_product_id = p.id AND t.min_quantity = 1
  WHERE p.activity_id = a.id
);

-- END V048__independent_first_price_tier.sql

-- BEGIN V049__index_activity_customer_phone_lookup.sql
-- Phone-first H5 verification, including the missing/null publication-binding compatibility path.
-- Keep the lookup prefix independent of data_version_id and customer_type.
ALTER TABLE activity_customer
  ADD KEY idx_ac_activity_phone (activity_id, phone_lookup_hash, is_active);

-- END V049__index_activity_customer_phone_lookup.sql

CREATE TABLE deployment_schema_history (
  version VARCHAR(64) PRIMARY KEY,
  applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  description VARCHAR(255) NOT NULL
) ENGINE=InnoDB;
INSERT INTO deployment_schema_history(version,description)
VALUES ('V049','Fresh schema V001-V049; V037 data-only Java migration not applicable to empty database');
