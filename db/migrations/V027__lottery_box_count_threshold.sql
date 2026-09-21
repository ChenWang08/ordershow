ALTER TABLE lottery_round
  ADD COLUMN qualification_metric VARCHAR(20) NOT NULL DEFAULT 'AMOUNT' AFTER minimum_order_amount,
  ADD COLUMN minimum_order_box_count BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER qualification_metric,
  ADD CONSTRAINT ck_lottery_round_qualification_metric
    CHECK (qualification_metric IN ('AMOUNT', 'BOX_COUNT'));

ALTER TABLE lottery_candidate_snapshot
  ADD COLUMN qualifying_order_box_count BIGINT UNSIGNED NULL AFTER qualifying_order_amount;
