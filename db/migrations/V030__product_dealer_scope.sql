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
