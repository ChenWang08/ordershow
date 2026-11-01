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
