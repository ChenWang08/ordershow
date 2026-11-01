-- EXISTING V041 DATABASE ONLY. DBA: stop all writers, verify version and back up first.
-- Apply in order; stop on first error. DDL may implicitly commit. Never use --force.
-- V048 inserts first-price tiers and invalidates catalog metadata; original orders/history are preserved.
SET NAMES utf8mb4;
SET time_zone = "+00:00";

-- BEGIN V042__activity_info_stream_version.sql
-- Public activity synchronization is independent of admin optimistic locking and order events.
ALTER TABLE activity ADD COLUMN public_info_version BIGINT NOT NULL DEFAULT 1;

-- END V042__activity_info_stream_version.sql
INSERT INTO deployment_schema_history(version,description) VALUES ('V042','DBA incremental V042__activity_info_stream_version.sql');

-- BEGIN V043__product_catalog_cache_version.sql
-- Shared H5 catalog snapshots have their own revision, including image and visibility changes.
ALTER TABLE activity ADD COLUMN product_catalog_version BIGINT NOT NULL DEFAULT 1;

-- END V043__product_catalog_cache_version.sql
INSERT INTO deployment_schema_history(version,description) VALUES ('V043','DBA incremental V043__product_catalog_cache_version.sql');

-- BEGIN V044__ranking_filters.sql
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

-- END V044__ranking_filters.sql
INSERT INTO deployment_schema_history(version,description) VALUES ('V044','DBA incremental V044__ranking_filters.sql');

-- BEGIN V045__lottery_product_filters_and_tons.sql
ALTER TABLE lottery_round
  DROP CHECK ck_lottery_round_qualification_metric,
  ADD COLUMN minimum_order_tons DECIMAL(18,6) NOT NULL DEFAULT 0,
  ADD COLUMN product_line VARCHAR(200) NULL,
  ADD COLUMN product_line_unassigned BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN varieties_json JSON NULL,
  ADD COLUMN include_unspecified_variety BOOLEAN NOT NULL DEFAULT FALSE,
  ADD CONSTRAINT ck_lottery_round_qualification_metric CHECK (qualification_metric IN ('AMOUNT','BOX_COUNT','TONS')),
  ADD CONSTRAINT ck_lottery_round_tons CHECK (minimum_order_tons >= 0);

ALTER TABLE lottery_candidate_snapshot
  ADD COLUMN qualifying_order_tons DECIMAL(18,6) NULL,
  ADD COLUMN missing_tonnage_items INT UNSIGNED NOT NULL DEFAULT 0;

-- END V045__lottery_product_filters_and_tons.sql
INSERT INTO deployment_schema_history(version,description) VALUES ('V045','DBA incremental V045__lottery_product_filters_and_tons.sql');

-- BEGIN V046__lottery_box_and_tons_weighting.sql
ALTER TABLE lottery_round
  DROP CHECK ck_lottery_round_probability_mode,
  ADD CONSTRAINT ck_lottery_round_probability_mode
    CHECK (probability_mode IN ('EQUAL', 'ORDER_AMOUNT_WEIGHTED', 'ORDER_BOX_COUNT_WEIGHTED', 'ORDER_TONS_WEIGHTED')),
  ADD CONSTRAINT ck_lottery_round_weight_metric
    CHECK ((probability_mode <> 'ORDER_BOX_COUNT_WEIGHTED' OR qualification_metric = 'BOX_COUNT')
       AND (probability_mode <> 'ORDER_TONS_WEIGHTED' OR qualification_metric = 'TONS'));

-- END V046__lottery_box_and_tons_weighting.sql
INSERT INTO deployment_schema_history(version,description) VALUES ('V046','DBA incremental V046__lottery_box_and_tons_weighting.sql');

-- BEGIN V047__multiple_price_tiers.sql
ALTER TABLE activity_product_price_tier
  DROP INDEX uk_product_price_tier,
  ADD UNIQUE KEY uk_product_price_tier (activity_product_id, min_quantity);

ALTER TABLE order_item ADD COLUMN pricing_details JSON NULL;
ALTER TABLE order_version_item ADD COLUMN pricing_details JSON NULL;

-- The product-leading index supports selecting only orders affected by a product price change.
CREATE INDEX idx_order_item_product_order ON order_item (activity_product_id, order_id);

-- END V047__multiple_price_tiers.sql
INSERT INTO deployment_schema_history(version,description) VALUES ('V047','DBA incremental V047__multiple_price_tiers.sql');

-- BEGIN V048__independent_first_price_tier.sql
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

-- END V048__independent_first_price_tier.sql
INSERT INTO deployment_schema_history(version,description) VALUES ('V048','DBA incremental V048__independent_first_price_tier.sql');

-- BEGIN V049__index_activity_customer_phone_lookup.sql
-- Phone-first H5 verification, including the missing/null publication-binding compatibility path.
-- Keep the lookup prefix independent of data_version_id and customer_type.
ALTER TABLE activity_customer
  ADD KEY idx_ac_activity_phone (activity_id, phone_lookup_hash, is_active);

-- END V049__index_activity_customer_phone_lookup.sql
INSERT INTO deployment_schema_history(version,description) VALUES ('V049','DBA incremental V049__index_activity_customer_phone_lookup.sql');
