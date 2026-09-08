package com.fengyi.ordershow.order;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import org.junit.jupiter.api.Test;

class OrderServicePricingTest {
  private static final BigDecimal BASE_PRICE = new BigDecimal("136.00");
  private static final BigDecimal TIER_PRICE = new BigDecimal("134.00");

  @Test
  void comparesNumericValuesWithoutTreatingScaleAsAPriceChange() {
    assertThat(OrderPricingCalculator.samePriceValue(new BigDecimal("1.00"), 1L)).isTrue();
    assertThat(OrderPricingCalculator.samePriceValue(null, null)).isTrue();
    assertThat(OrderPricingCalculator.samePriceValue(null, BigDecimal.ZERO)).isFalse();
    assertThat(OrderPricingCalculator.samePriceValue(new BigDecimal("1.01"), 1L)).isFalse();
  }

  @Test
  void roundsTheCombinedIncrementalAmountOnlyOnce() {
    var price = OrderPricingCalculator.calculatePrice(new BigDecimal("1.005"), 2L, new BigDecimal("0.995"), "INCREMENTAL", 2);
    assertThat(price.lineAmount()).isEqualByComparingTo("2.00");
    assertThat(price.lineAmount().scale()).isEqualTo(2);
  }

  @Test
  void blankModesKeepWholeOrderPricing() {
    for (String mode : new String[]{null, "", " "}) {
      var price = OrderPricingCalculator.calculatePrice(BASE_PRICE, 1500L, TIER_PRICE, mode, 1500);
      assertThat(price.pricingMode()).isEqualTo("WHOLE_ORDER");
      assertThat(price.lineAmount()).isEqualByComparingTo("201000.00");
    }
  }

  @Test
  void incompleteTierConfigurationFallsBackToTheBasePrice() {
    var price = OrderPricingCalculator.calculatePrice(BASE_PRICE, 1500L, null, "INCREMENTAL", 1500);
    assertThat(price.lineAmount()).isEqualByComparingTo("204000.00");
    assertThat(price.appliedTierMinQuantity()).isNull();
    assertThat(price.tierQuantity()).isZero();
  }

  @Test
  void keepsBasePriceBelowTheTierThreshold() {
    var applied = OrderPricingCalculator.calculatePrice(BASE_PRICE, 1500L, TIER_PRICE, "WHOLE_ORDER", 1499);

    assertThat(applied.casePriceSnapshot()).isEqualByComparingTo("136.00");
    assertThat(applied.appliedTierMinQuantity()).isNull();
    assertThat(applied.baseQuantity()).isEqualTo(1499);
    assertThat(applied.tierQuantity()).isZero();
    assertThat(applied.lineAmount()).isEqualByComparingTo("203864.00");
  }

  @Test
  void appliesTheDiscountToEveryCaseAtTheThreshold() {
    var applied = OrderPricingCalculator.calculatePrice(BASE_PRICE, 1500L, TIER_PRICE, "WHOLE_ORDER", 1500);

    assertThat(applied.casePriceSnapshot()).isEqualByComparingTo("134.00");
    assertThat(applied.appliedTierMinQuantity()).isEqualTo(1500L);
    assertThat(applied.baseQuantity()).isZero();
    assertThat(applied.tierQuantity()).isEqualTo(1500);
    assertThat(applied.lineAmount()).isEqualByComparingTo("201000.00");
  }

  @Test
  void keepsTheDiscountAboveTheThreshold() {
    var applied = OrderPricingCalculator.calculatePrice(BASE_PRICE, 1500L, TIER_PRICE, "WHOLE_ORDER", 1501);

    assertThat(applied.casePriceSnapshot()).isEqualByComparingTo("134.00");
    assertThat(applied.lineAmount()).isEqualByComparingTo("201134.00");
  }

  @Test
  void pricesOnlyTheThresholdAndExcessCasesAtTheIncrementalPrice() {
    var below = OrderPricingCalculator.calculatePrice(BASE_PRICE, 1500L, TIER_PRICE, "INCREMENTAL", 1499);
    var threshold = OrderPricingCalculator.calculatePrice(BASE_PRICE, 1500L, TIER_PRICE, "INCREMENTAL", 1500);
    var above = OrderPricingCalculator.calculatePrice(BASE_PRICE, 1500L, TIER_PRICE, "INCREMENTAL", 1501);

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
    var applied = OrderPricingCalculator.calculatePrice(BASE_PRICE, null, null, null, 1500);

    assertThat(applied.casePriceSnapshot()).isEqualByComparingTo("136.00");
    assertThat(applied.appliedTierMinQuantity()).isNull();
    assertThat(applied.lineAmount()).isEqualByComparingTo("204000.00");
  }
}
