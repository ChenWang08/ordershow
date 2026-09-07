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
