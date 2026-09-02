ALTER TABLE activity_product_price_tier
  ADD COLUMN pricing_mode VARCHAR(20) NOT NULL DEFAULT 'WHOLE_ORDER' AFTER case_price,
  ADD CONSTRAINT ck_product_price_tier_mode CHECK (pricing_mode IN ('WHOLE_ORDER', 'INCREMENTAL'));

ALTER TABLE order_item
  ADD COLUMN base_case_price DECIMAL(18,4) NULL AFTER applied_tier_min_quantity,
  ADD COLUMN base_price_quantity BIGINT UNSIGNED NULL AFTER base_case_price,
  ADD COLUMN tier_case_price DECIMAL(18,4) NULL AFTER base_price_quantity,
  ADD COLUMN tier_min_quantity BIGINT UNSIGNED NULL AFTER tier_case_price,
  ADD COLUMN tier_price_quantity BIGINT UNSIGNED NULL AFTER tier_min_quantity,
  ADD COLUMN pricing_mode VARCHAR(20) NULL AFTER tier_price_quantity,
  ADD CONSTRAINT ck_order_item_pricing_mode CHECK (pricing_mode IS NULL OR pricing_mode IN ('WHOLE_ORDER', 'INCREMENTAL'));

ALTER TABLE order_version_item
  ADD COLUMN base_case_price DECIMAL(18,4) NULL AFTER applied_tier_min_quantity,
  ADD COLUMN base_price_quantity BIGINT UNSIGNED NULL AFTER base_case_price,
  ADD COLUMN tier_case_price DECIMAL(18,4) NULL AFTER base_price_quantity,
  ADD COLUMN tier_min_quantity BIGINT UNSIGNED NULL AFTER tier_case_price,
  ADD COLUMN tier_price_quantity BIGINT UNSIGNED NULL AFTER tier_min_quantity,
  ADD COLUMN pricing_mode VARCHAR(20) NULL AFTER tier_price_quantity,
  ADD CONSTRAINT ck_order_version_item_pricing_mode CHECK (pricing_mode IS NULL OR pricing_mode IN ('WHOLE_ORDER', 'INCREMENTAL'));

UPDATE order_item
SET base_case_price = case_price, base_price_quantity = quantity
WHERE base_case_price IS NULL;

UPDATE order_version_item
SET base_case_price = case_price, base_price_quantity = quantity
WHERE base_case_price IS NULL;
