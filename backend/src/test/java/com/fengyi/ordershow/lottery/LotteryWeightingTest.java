package com.fengyi.ordershow.lottery;

import static org.assertj.core.api.Assertions.*;
import java.math.BigDecimal;
import java.nio.ByteBuffer;
import org.junit.jupiter.api.Test;

class LotteryWeightingTest {
  @Test void selectedMetricUsesActualSubtotalAndMissingValuesAreZero() {
    assertThat(LotteryService.weight("ORDER_AMOUNT_WEIGHTED",new BigDecimal("100"),20L,new BigDecimal("0.01"))).isEqualByComparingTo("100");
    assertThat(LotteryService.weight("ORDER_BOX_COUNT_WEIGHTED",BigDecimal.ZERO,20L,null)).isEqualByComparingTo("20");
    assertThat(LotteryService.weight("ORDER_TONS_WEIGHTED",new BigDecimal("100"),20L,new BigDecimal("0.000001"))).isEqualByComparingTo("0.000001");
    assertThat(LotteryService.weight("ORDER_TONS_WEIGHTED",new BigDecimal("100"),20L,null)).isZero();
    assertThat(LotteryService.weight("ORDER_BOX_COUNT_WEIGHTED",new BigDecimal("100"),null,BigDecimal.ONE)).isZero();
    assertThat(LotteryService.weight("EQUAL",null,null,null)).isEqualByComparingTo("1");
  }

  @Test void exponentialRaceRespectsWeightRatiosAndIsInvariantToUnits() {
    byte[] key=ByteBuffer.allocate(32).putLong(1234567890123456789L).array();
    double small=LotteryService.weightedScore(key,new BigDecimal("100"),new BigDecimal("300"));
    double large=LotteryService.weightedScore(key,new BigDecimal("200"),new BigDecimal("300"));
    assertThat(small).isCloseTo(large*2,within(1e-12));
    assertThat(LotteryService.weightedScore(key,new BigDecimal("0.000001"),new BigDecimal("0.000003"))).isCloseTo(small,within(1e-12));
  }

  @Test void extremeRandomValuesNeverProduceInfiniteOrNegativeScores() {
    for(long bits:new long[]{0,Long.MAX_VALUE,Long.MIN_VALUE,-1}) {
      double score=LotteryService.weightedScore(ByteBuffer.allocate(32).putLong(bits).array(),BigDecimal.ONE,BigDecimal.TEN);
      assertThat(Double.isFinite(score)).isTrue();assertThat(score).isGreaterThan(0);
    }
  }
}
