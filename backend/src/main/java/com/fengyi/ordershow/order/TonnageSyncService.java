package com.fengyi.ordershow.order;

import static com.fengyi.ordershow.order.OrderPricingCalculator.calculateTons;
import static com.fengyi.ordershow.order.OrderPricingCalculator.samePriceValue;

import com.fengyi.ordershow.dashboard.DashboardService;
import java.math.BigDecimal;
import java.util.Map;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Recalculates only current tonnage fields for submitted orders. */
@Service
public class TonnageSyncService {
  private final TonnageSyncRepository tonnage;
  private final OrderRepository orders;
  private final DashboardService dashboards;

  public TonnageSyncService(TonnageSyncRepository tonnage, OrderRepository orders, DashboardService dashboards) {
    this.tonnage = tonnage;
    this.orders = orders;
    this.dashboards = dashboards;
  }

  @Transactional
  public int sync(long activityId, long productId, BigDecimal factor) {
    orders.lockPricing(activityId);
    var rows = tonnage.submittedItems(activityId, productId);
    int count = 0;
    for (var row : rows) {
      BigDecimal lineTons = calculateTons(row.quantity(), factor);
      if (samePriceValue(factor, row.tonCaseFactor()) && samePriceValue(lineTons, row.lineTons())) continue;
      orders.snapshotCurrentVersion(row.orderId());
      tonnage.updateItem(row.id(), factor, lineTons);
      tonnage.updateOrderTotal(row.orderId());
      orders.refreshDashboardSummary(row.orderId());
      orders.writeOutbox(activityId, row.orderId(), "ORDER_TONS_UPDATED", Map.of("orderId", row.orderId()));
      count++;
    }
    if (count > 0) dashboards.refreshFinalSnapshots(activityId);
    return count;
  }
}
