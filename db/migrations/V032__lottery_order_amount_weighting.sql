ALTER TABLE lottery_round
  ADD COLUMN probability_mode VARCHAR(32) NOT NULL DEFAULT 'EQUAL' AFTER qualification_metric,
  ADD CONSTRAINT ck_lottery_round_probability_mode
    CHECK (probability_mode IN ('EQUAL', 'ORDER_AMOUNT_WEIGHTED'));
