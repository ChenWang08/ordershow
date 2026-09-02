package com.fengyi.ordershow.order;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import org.junit.jupiter.api.Test;

class OrderServicePricingTest {
  private static final BigDecimal BASE_PRICE = new BigDecimal("136.00");
  private static final BigDecimal TIER_PRICE = new BigDecimal("134.00");

  @Test
  void keepsBasePriceBelowTheTierThreshold() {
    var applied = OrderService.calculatePrice(BASE_PRICE, 1500L, TIER_PRICE, "WHOLE_ORDER", 1499);

    assertThat(applied.casePriceSnapshot()).isEqualByComparingTo("136.00");
    assertThat(applied.appliedTierMinQuantity()).isNull();
    assertThat(applied.baseQuantity()).isEqualTo(1499);
    assertThat(applied.tierQuantity()).isZero();
    assertThat(applied.lineAmount()).isEqualByComparingTo("203864.00");
  }

  @Test
  void appliesTheDiscountToEveryCaseAtTheThreshold() {
    var applied = OrderService.calculatePrice(BASE_PRICE, 1500L, TIER_PRICE, "WHOLE_ORDER", 1500);

    assertThat(applied.casePriceSnapshot()).isEqualByComparingTo("134.00");
    assertThat(applied.appliedTierMinQuantity()).isEqualTo(1500L);
    assertThat(applied.baseQuantity()).isZero();
    assertThat(applied.tierQuantity()).isEqualTo(1500);
    assertThat(applied.lineAmount()).isEqualByComparingTo("201000.00");
  }

  @Test
  void keepsTheDiscountAboveTheThreshold() {
    var applied = OrderService.calculatePrice(BASE_PRICE, 1500L, TIER_PRICE, "WHOLE_ORDER", 1501);

    assertThat(applied.casePriceSnapshot()).isEqualByComparingTo("134.00");
    assertThat(applied.lineAmount()).isEqualByComparingTo("201134.00");
  }

  @Test
  void pricesOnlyTheThresholdAndExcessCasesAtTheIncrementalPrice() {
    var below = OrderService.calculatePrice(BASE_PRICE, 1500L, TIER_PRICE, "INCREMENTAL", 1499);
    var threshold = OrderService.calculatePrice(BASE_PRICE, 1500L, TIER_PRICE, "INCREMENTAL", 1500);
    var above = OrderService.calculatePrice(BASE_PRICE, 1500L, TIER_PRICE, "INCREMENTAL", 1501);

    assertThat(below.lineAmount()).isEqualByComparingTo("203864.00");
    assertThat(below.baseQuantity()).isEqualTo(1499);
    assertThat(below.tierQuantity()).isZero();
    assertThat(threshold.lineAmount()).isEqualByComparingTo("203998.00");
    assertThat(threshold.baseQuantity()).isEqualTo(1499);
    assertThat(threshold.tierQuantity()).isEqualTo(1);
    assertThat(above.lineAmount()).isEqualByComparingTo("204132.00");
    assertThat(above.baseQuantity()).isEqualTo(1499);
    assertThat(above.tierQuantity()).isEqualTo(2);
  }

  @Test
  void keepsLegacyProductsOnTheirBasePrice() {
    var applied = OrderService.calculatePrice(BASE_PRICE, null, null, null, 1500);

    assertThat(applied.casePriceSnapshot()).isEqualByComparingTo("136.00");
    assertThat(applied.appliedTierMinQuantity()).isNull();
    assertThat(applied.lineAmount()).isEqualByComparingTo("204000.00");
  }
}
