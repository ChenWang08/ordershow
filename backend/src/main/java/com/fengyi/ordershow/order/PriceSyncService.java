package com.fengyi.ordershow.order;

import static com.fengyi.ordershow.order.OrderPricingCalculator.samePriceValue;

import com.fengyi.ordershow.activity.ActivityService;
import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.dashboard.DashboardService;
import java.math.BigDecimal;
import java.util.Map;
import java.util.Objects;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Only current order prices change; customer submissions and old versions are preserved. */
@Service
public class PriceSyncService {
  private final PriceSyncRepository prices;
  private final OrderRepository orders;
  private final DashboardService dashboards;
  private final ActivityService activities;

  public PriceSyncService(PriceSyncRepository prices, OrderRepository orders, DashboardService dashboards,
                          ActivityService activities) {
    this.prices = prices;
    this.orders = orders;
    this.dashboards = dashboards;
    this.activities = activities;
  }

  @Transactional
  public int sync(long activityId, long productId, BigDecimal base, Long threshold, BigDecimal tier, String mode) {
    orders.lockPricing(activityId);
    var rows = prices.submittedItems(activityId, productId);
    if (rows.isEmpty()) return 0;
    if (base == null || base.signum() <= 0) {
      throw DomainException.unprocessable("PRODUCT_PRICE_REQUIRED", "已有订单的商品价格必须大于零");
    }
    int count = 0;
    for (var row : rows) {
      var price = OrderPricingCalculator.calculatePrice(base, threshold, tier, mode, row.quantity());
      if (samePriceValue(price.baseCasePrice(), row.baseCasePrice() == null ? row.casePrice() : row.baseCasePrice())
          && samePriceValue(price.casePriceSnapshot(), row.casePrice())
          && samePriceValue(price.tierCasePrice(), row.tierCasePrice())
          && samePriceValue(price.tierMinQuantity(), row.tierMinQuantity())
          && Objects.equals(price.pricingMode(), row.pricingMode())
          && samePriceValue(price.lineAmount(), row.lineAmount())) continue;

      prices.updateItem(row.id(), price);
      prices.updateOrderTotal(row.orderId());
      orders.writeOutbox(activityId, row.orderId(), "ORDER_PRICE_UPDATED", Map.of("orderId", row.orderId()));
      count++;
    }
    if (count > 0) dashboards.refreshFinalSnapshots(activityId);
    return count;
  }

  @Transactional
  public int backfill(long activityId) {
    orders.lockPricing(activityId);
    if (!"ACTIVE".equals(activities.byId(activityId).status())) {
      throw DomainException.conflict("ACTIVITY_NOT_ACTIVE", "只补处理指定的进行中活动");
    }
    var products = prices.currentProducts(activityId);
    int count = 0;
    for (var product : products) {
      count += sync(activityId, product.id(), product.casePrice(), product.minQuantity(), product.tierPrice(), product.pricingMode());
    }
    return count;
  }
}
