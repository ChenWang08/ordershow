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
