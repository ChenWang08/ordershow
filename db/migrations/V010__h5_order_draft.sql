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
