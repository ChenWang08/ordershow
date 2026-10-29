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
