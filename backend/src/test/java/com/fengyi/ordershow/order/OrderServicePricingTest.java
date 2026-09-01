package com.fengyi.ordershow.order;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import org.junit.jupiter.api.Test;

class OrderServicePricingTest {
  private static final BigDecimal BASE_PRICE = new BigDecimal("136.00");
  private static final BigDecimal TIER_PRICE = new BigDecimal("134.00");

  @Test
  void keepsBasePriceBelowTheTierThreshold() {
    var applied = OrderService.appliedPrice(BASE_PRICE, 1500L, TIER_PRICE, 1499);

    assertThat(applied.casePrice()).isEqualByComparingTo("136.00");
    assertThat(applied.tierMinQuantity()).isNull();
    assertThat(applied.casePrice().multiply(BigDecimal.valueOf(1499))).isEqualByComparingTo("203864.00");
  }

  @Test
  void appliesTheDiscountToEveryCaseAtTheThreshold() {
    var applied = OrderService.appliedPrice(BASE_PRICE, 1500L, TIER_PRICE, 1500);

    assertThat(applied.casePrice()).isEqualByComparingTo("134.00");
    assertThat(applied.tierMinQuantity()).isEqualTo(1500L);
    assertThat(applied.casePrice().multiply(BigDecimal.valueOf(1500))).isEqualByComparingTo("201000.00");
  }

  @Test
  void keepsTheDiscountAboveTheThreshold() {
    var applied = OrderService.appliedPrice(BASE_PRICE, 1500L, TIER_PRICE, 1501);

    assertThat(applied.casePrice()).isEqualByComparingTo("134.00");
    assertThat(applied.casePrice().multiply(BigDecimal.valueOf(1501))).isEqualByComparingTo("201134.00");
  }

  @Test
  void keepsLegacyProductsOnTheirBasePrice() {
    var applied = OrderService.appliedPrice(BASE_PRICE, null, null, 1500);

    assertThat(applied.casePrice()).isEqualByComparingTo("136.00");
    assertThat(applied.tierMinQuantity()).isNull();
  }
}
