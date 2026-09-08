package com.fengyi.ordershow.order;

import java.math.BigDecimal;
import java.util.List;
import com.fengyi.ordershow.order.OrderPricingCalculator.PricingResult;

final class OrderData {
  private OrderData() {}
  record OrderRow(long id, long customerId, String status, int version, int lockVersion) {}
  record ProductSnapshot(long id, String materialCode, String materialName, String categoryName, String productLine, String brandName, String varietyName, String specification, String casePack, String customerType, String rebateStatus, boolean giftBox, BigDecimal casePrice, BigDecimal tonCaseFactor, String imageKey, Long priceTierMinQuantity, BigDecimal priceTierCasePrice, String priceTierPricingMode) {}
  record CalculatedItem(int lineNo, ProductSnapshot product, long quantity, PricingResult pricing, BigDecimal lineTons) {}
  record CalculatedOrder(List<CalculatedItem> items, long totalQuantity, BigDecimal totalTons, BigDecimal totalAmount) {}
  record CustomerSnapshot(long id, String customerType, String regionCode, String branchName,
                                  String dealerShortName, String dealerFullName) {}
  record IdempotencyResult(boolean replay) {}
}
