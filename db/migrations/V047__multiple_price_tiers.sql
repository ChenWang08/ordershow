ALTER TABLE activity_product_price_tier
  DROP INDEX uk_product_price_tier,
  ADD UNIQUE KEY uk_product_price_tier (activity_product_id, min_quantity);

ALTER TABLE order_item ADD COLUMN pricing_details JSON NULL;
ALTER TABLE order_version_item ADD COLUMN pricing_details JSON NULL;

-- The product-leading index supports selecting only orders affected by a product price change.
CREATE INDEX idx_order_item_product_order ON order_item (activity_product_id, order_id);
