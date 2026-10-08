package com.fengyi.ordershow.order;

import java.math.BigDecimal;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.assertEquals;

class OrderPricingCalculatorTest {
  @Test void missingAndInvalidFactorsContributeZero() {
    for (BigDecimal factor : new BigDecimal[]{null, BigDecimal.ZERO, new BigDecimal("-10")}) {
      assertEquals(new BigDecimal("0.000000"), OrderPricingCalculator.calculateTons(20, factor));
    }
  }

  @Test void mixedLinesRetainAvailableTonsAndSixDigitPrecision() {
    BigDecimal total = OrderPricingCalculator.calculateTons(20, new BigDecimal("100"))
        .add(OrderPricingCalculator.calculateTons(30, null))
        .add(OrderPricingCalculator.calculateTons(1, new BigDecimal("3")));
    assertEquals(new BigDecimal("0.533333"), total);
  }
}
