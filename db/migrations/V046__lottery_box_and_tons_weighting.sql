ALTER TABLE lottery_round
  DROP CHECK ck_lottery_round_probability_mode,
  ADD CONSTRAINT ck_lottery_round_probability_mode
    CHECK (probability_mode IN ('EQUAL', 'ORDER_AMOUNT_WEIGHTED', 'ORDER_BOX_COUNT_WEIGHTED', 'ORDER_TONS_WEIGHTED')),
  ADD CONSTRAINT ck_lottery_round_weight_metric
    CHECK ((probability_mode <> 'ORDER_BOX_COUNT_WEIGHTED' OR qualification_metric = 'BOX_COUNT')
       AND (probability_mode <> 'ORDER_TONS_WEIGHTED' OR qualification_metric = 'TONS'));
