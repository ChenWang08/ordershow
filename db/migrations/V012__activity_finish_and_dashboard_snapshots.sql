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
