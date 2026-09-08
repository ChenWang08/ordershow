package com.fengyi.ordershow.order;

import java.math.BigDecimal;
import java.math.RoundingMode;

/** Pure pricing rules shared by order writes and catalog price synchronization. */
final class OrderPricingCalculator {
  private OrderPricingCalculator() {}

  static boolean samePriceValue(Object first, Object second) {
    return first == null || second == null ? first == second
        : new BigDecimal(first.toString()).compareTo(new BigDecimal(second.toString())) == 0;
  }

  static PricingResult calculatePrice(BigDecimal basePrice, Long tierMinQuantity, BigDecimal tierCasePrice, String pricingMode, long quantity) {
    if (tierMinQuantity == null || tierCasePrice == null) {
      return new PricingResult(basePrice, basePrice, quantity, null, null, 0, null, null,
          basePrice.multiply(BigDecimal.valueOf(quantity)).setScale(2, RoundingMode.HALF_UP));
    }
    String mode = pricingMode == null || pricingMode.isBlank() ? "WHOLE_ORDER" : pricingMode;
    long baseQuantity;
    long tierQuantity;
    BigDecimal casePriceSnapshot;
    if ("INCREMENTAL".equals(mode)) {
      baseQuantity = Math.min(quantity, tierMinQuantity - 1);
      tierQuantity = Math.max(0, quantity - baseQuantity);
      casePriceSnapshot = basePrice;
    } else {
      boolean applied = quantity >= tierMinQuantity;
      baseQuantity = applied ? 0 : quantity;
      tierQuantity = applied ? quantity : 0;
      casePriceSnapshot = applied ? tierCasePrice : basePrice;
    }
    BigDecimal amount = basePrice.multiply(BigDecimal.valueOf(baseQuantity))
        .add(tierCasePrice.multiply(BigDecimal.valueOf(tierQuantity))).setScale(2, RoundingMode.HALF_UP);
    return new PricingResult(casePriceSnapshot, basePrice, baseQuantity, tierCasePrice, tierMinQuantity, tierQuantity, mode,
        tierQuantity > 0 ? tierMinQuantity : null, amount);
  }
  record PricingResult(BigDecimal casePriceSnapshot, BigDecimal baseCasePrice, long baseQuantity, BigDecimal tierCasePrice,
                       Long tierMinQuantity, long tierQuantity, String pricingMode, Long appliedTierMinQuantity, BigDecimal lineAmount) {}
}
