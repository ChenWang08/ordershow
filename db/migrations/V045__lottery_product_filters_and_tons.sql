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
