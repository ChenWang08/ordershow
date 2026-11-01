package com.fengyi.ordershow.order;

import java.math.BigDecimal;
import java.util.List;
import com.fengyi.ordershow.order.OrderPricingCalculator.PricingResult;
import com.fengyi.ordershow.common.TierPricing.Step;

final class OrderData {
  private OrderData() {}
  record OrderRow(long id, long customerId, String status, int version, int lockVersion) {}
  record ProductSnapshot(long id, String materialCode, String materialName, String categoryName, String productLine, String brandName, String varietyName, String specification, String casePack, String customerType, String rebateStatus, boolean giftBox, BigDecimal casePrice, BigDecimal tonCaseFactor, String imageKey, Long priceTierMinQuantity, BigDecimal priceTierCasePrice, String priceTierPricingMode, List<Step> priceTiers) {
    ProductSnapshot(long id, String materialCode, String materialName, String categoryName, String productLine, String brandName, String varietyName, String specification, String casePack, String customerType, String rebateStatus, boolean giftBox, BigDecimal casePrice, BigDecimal tonCaseFactor, String imageKey, Long priceTierMinQuantity, BigDecimal priceTierCasePrice, String priceTierPricingMode) {
      this(id, materialCode, materialName, categoryName, productLine, brandName, varietyName, specification, casePack, customerType, rebateStatus, giftBox, casePrice, tonCaseFactor, imageKey, priceTierMinQuantity, priceTierCasePrice, priceTierPricingMode,
          priceTierMinQuantity == null || priceTierCasePrice == null ? List.of() : List.of(new Step(priceTierMinQuantity, priceTierCasePrice)));
    }
    ProductSnapshot withTiers(List<Step> tiers) {
      return new ProductSnapshot(id, materialCode, materialName, categoryName, productLine, brandName, varietyName, specification, casePack, customerType, rebateStatus, giftBox, casePrice, tonCaseFactor, imageKey,
          tiers.isEmpty() ? null : tiers.getFirst().minQuantity(), tiers.isEmpty() ? null : tiers.getFirst().casePrice(), priceTierPricingMode, tiers);
    }
  }
  record CalculatedItem(int lineNo, ProductSnapshot product, long quantity, PricingResult pricing, BigDecimal lineTons) {}
  record CalculatedOrder(List<CalculatedItem> items, long totalQuantity, BigDecimal totalTons, BigDecimal totalAmount) {}
  record CustomerSnapshot(long id, String customerType, String regionCode, String branchName,
                                  String dealerShortName, String dealerFullName) {}
  record IdempotencyResult(boolean replay) {}
}
