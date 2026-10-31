package com.fengyi.ordershow.order;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.List;
import com.fengyi.ordershow.common.TierPricing;
import com.fengyi.ordershow.common.TierPricing.Step;
import com.fengyi.ordershow.common.TierPricing.Segment;
import com.fengyi.ordershow.common.TierPricing.Details;

/** Pure pricing rules shared by order writes and catalog price synchronization. */
final class OrderPricingCalculator {
  private OrderPricingCalculator() {}

  static boolean samePriceValue(Object first, Object second) {
    return first == null || second == null ? first == second
        : new BigDecimal(first.toString()).compareTo(new BigDecimal(second.toString())) == 0;
  }

  static BigDecimal calculateTons(long quantity, BigDecimal tonCaseFactor) {
    return tonCaseFactor == null || tonCaseFactor.signum() <= 0 ? BigDecimal.ZERO.setScale(6)
        : BigDecimal.valueOf(quantity).divide(tonCaseFactor, 6, RoundingMode.HALF_UP);
  }

  static PricingResult calculatePrice(BigDecimal basePrice, Long tierMinQuantity, BigDecimal tierCasePrice, String pricingMode, long quantity) {
    return calculatePrice(basePrice, tierMinQuantity == null || tierCasePrice == null ? List.of() : List.of(new Step(tierMinQuantity, tierCasePrice)), pricingMode, quantity);
  }

  static PricingResult calculatePrice(BigDecimal basePrice, List<Step> tiers, String pricingMode, long quantity) {
    if (tiers == null || tiers.isEmpty()) {
      return new PricingResult(basePrice, basePrice, quantity, null, null, 0, null, null,
          basePrice.multiply(BigDecimal.valueOf(quantity)).setScale(2, RoundingMode.HALF_UP));
    }
    basePrice = TierPricing.basePrice(basePrice, tiers);
    List<Step> discounts = tiers.getFirst().minQuantity() == 1 ? tiers.subList(1, tiers.size()) : tiers;
    String mode = pricingMode == null || pricingMode.isBlank() ? "WHOLE_ORDER" : pricingMode;
    Step first = discounts.isEmpty() ? null : discounts.getFirst();
    Step applied = null;
    for (Step tier : discounts) { if (quantity >= tier.minQuantity()) applied = tier; else break; }
    var segments = new ArrayList<Segment>();
    BigDecimal amount = BigDecimal.ZERO;
    long baseQuantity = 0;
    if ("INCREMENTAL".equals(mode)) {
      for (int index = -1; index < discounts.size(); index++) {
        long start = index < 0 ? 1 : discounts.get(index).minQuantity();
        Long end = index + 1 < discounts.size() ? discounts.get(index + 1).minQuantity() - 1 : null;
        long charged = Math.max(0, Math.min(quantity, end == null ? quantity : end) - start + 1);
        if (charged == 0) break;
        BigDecimal price = index < 0 ? basePrice : discounts.get(index).casePrice();
        BigDecimal next = amount.add(price.multiply(BigDecimal.valueOf(charged)));
        // Allocate rounding on the running total so displayed segments add up to the line amount.
        segments.add(new Segment(start, end, charged, price, next.setScale(2, RoundingMode.HALF_UP).subtract(amount.setScale(2, RoundingMode.HALF_UP))));
        amount = next;
        if (index < 0) baseQuantity = charged;
      }
    } else {
      BigDecimal price = applied == null ? basePrice : applied.casePrice();
      amount = price.multiply(BigDecimal.valueOf(quantity));
      if (quantity > 0) segments.add(new Segment(applied == null ? 1 : applied.minQuantity(), null, quantity, price, amount.setScale(2, RoundingMode.HALF_UP)));
      baseQuantity = applied == null ? quantity : 0;
    }
    Step effective = applied == null ? first : applied;
    return new PricingResult("INCREMENTAL".equals(mode) || applied == null ? basePrice : applied.casePrice(), basePrice,
        baseQuantity, effective == null ? null : effective.casePrice(), effective == null ? null : effective.minQuantity(), quantity - baseQuantity, mode,
        applied == null ? null : applied.minQuantity(), amount.setScale(2, RoundingMode.HALF_UP), new Details(tiers, segments));
  }
  record PricingResult(BigDecimal casePriceSnapshot, BigDecimal baseCasePrice, long baseQuantity, BigDecimal tierCasePrice,
                       Long tierMinQuantity, long tierQuantity, String pricingMode, Long appliedTierMinQuantity, BigDecimal lineAmount,
                       Details pricingDetails) {
    PricingResult(BigDecimal casePriceSnapshot, BigDecimal baseCasePrice, long baseQuantity, BigDecimal tierCasePrice,
        Long tierMinQuantity, long tierQuantity, String pricingMode, Long appliedTierMinQuantity, BigDecimal lineAmount) {
      this(casePriceSnapshot, baseCasePrice, baseQuantity, tierCasePrice, tierMinQuantity, tierQuantity, pricingMode, appliedTierMinQuantity, lineAmount, null);
    }
  }
}
