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
