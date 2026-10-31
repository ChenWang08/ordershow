package com.fengyi.ordershow.order;

import static com.fengyi.ordershow.order.OrderPricingCalculator.samePriceValue;

import com.fengyi.ordershow.activity.ActivityService;
import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.catalog.ProductService.PriceTierView;
import java.util.ArrayList;
import com.fengyi.ordershow.dashboard.DashboardService;
import java.math.BigDecimal;
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
    return sync(activityId, productId, base, threshold == null || tier == null ? null : new PriceTierView(threshold, tier, mode == null ? "WHOLE_ORDER" : mode));
  }

  @Transactional
  public int sync(long activityId, long productId, BigDecimal base, PriceTierView rule) {
    orders.lockPricing(activityId);
    var rows = prices.submittedItems(activityId, productId);
    if (rows.isEmpty()) return 0;
    var effectiveBase = com.fengyi.ordershow.common.TierPricing.basePrice(base, rule == null ? java.util.List.of() : rule.tiers());
    if (effectiveBase == null || effectiveBase.signum() <= 0) {
      throw DomainException.unprocessable("PRODUCT_PRICE_REQUIRED", "已有订单的商品价格必须大于零");
    }
    var changes = new ArrayList<PriceSyncRepository.Change>();
    for (var row : rows) {
      var price = OrderPricingCalculator.calculatePrice(base, rule == null ? java.util.List.of() : rule.tiers(), rule == null ? null : rule.pricingMode(), row.quantity());
      if (samePriceValue(price.baseCasePrice(), row.baseCasePrice() == null ? row.casePrice() : row.baseCasePrice())
          && samePriceValue(price.casePriceSnapshot(), row.casePrice())
          && samePriceValue(price.tierCasePrice(), row.tierCasePrice())
          && samePriceValue(price.tierMinQuantity(), row.tierMinQuantity())
          && Objects.equals(price.pricingMode(), row.pricingMode())
          && samePriceValue(price.lineAmount(), row.lineAmount())
          && Objects.equals(price.pricingDetails(), row.pricingDetails())) continue;
      changes.add(new PriceSyncRepository.Change(row, price));
    }
    // Chunk network traffic only: every chunk stays in the product save transaction and activity lock.
    for (int start = 0; start < changes.size(); start += 200) {
      var batch = changes.subList(start, Math.min(start + 200, changes.size()));
      var orderIds = batch.stream().map(change -> change.row().orderId()).toList();
      orders.snapshotCurrentProductVersions(orderIds, productId);
      prices.applyChanges(activityId, batch);
      orders.refreshPriceSummaries(batch);
    }
    if (!changes.isEmpty()) dashboards.refreshFinalSnapshots(activityId);
    return changes.size();
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
      count += sync(activityId, product.id(), product.casePrice(), product.rule());
    }
    return count;
  }
}
