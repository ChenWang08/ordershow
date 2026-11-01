-- Store the first price explicitly, independently of the ordinary product case price.
ALTER TABLE activity_product_price_tier
  DROP CHECK ck_product_price_tier_values,
  ADD CONSTRAINT ck_product_price_tier_values CHECK (min_quantity >= 1 AND case_price > 0);

-- Preserve the old pricing result. Current orders and immutable history are not rewritten.
INSERT INTO activity_product_price_tier(activity_product_id, min_quantity, case_price, pricing_mode)
SELECT p.id, 1, p.case_price, t.pricing_mode
FROM activity_product p
JOIN (
  SELECT activity_product_id, MIN(pricing_mode) AS pricing_mode
  FROM activity_product_price_tier
  GROUP BY activity_product_id
  HAVING MIN(min_quantity) > 1
) t ON t.activity_product_id = p.id
WHERE p.case_price > 0;

-- Existing cached catalogs must load the complete first-price rules after the upgrade.
UPDATE activity a
SET product_catalog_version = product_catalog_version + 1
WHERE EXISTS (
  SELECT 1 FROM activity_product p
  JOIN activity_product_price_tier t ON t.activity_product_id = p.id AND t.min_quantity = 1
  WHERE p.activity_id = a.id
);
