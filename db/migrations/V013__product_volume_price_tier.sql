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
