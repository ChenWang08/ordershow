package com.fengyi.ordershow.order;

import com.fengyi.ordershow.activity.ActivityService;
import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.dashboard.DashboardService;
import java.math.BigDecimal;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Only current order prices change; customer submissions and old versions are preserved. */
@Service
public class PriceSyncService {
  private final JdbcTemplate jdbc;
  private final OrderService orders;
  private final DashboardService dashboards;
  private final ActivityService activities;
  public PriceSyncService(JdbcTemplate jdbc, OrderService orders, DashboardService dashboards, ActivityService activities) {
    this.jdbc=jdbc; this.orders=orders; this.dashboards=dashboards; this.activities=activities;
  }
  @Transactional
  public int sync(long activityId,long productId,BigDecimal base,Long threshold,BigDecimal tier,String mode) {
    orders.lockPricing(activityId);
    var rows=jdbc.queryForList("SELECT i.* FROM order_item i JOIN customer_order o ON o.id=i.order_id WHERE o.activity_id=? AND o.status='SUBMITTED' AND i.activity_product_id=? ORDER BY o.id",activityId,productId);
    if(rows.isEmpty()) return 0;
    if(base==null || base.signum()<=0) throw DomainException.unprocessable("PRODUCT_PRICE_REQUIRED","已有订单的商品价格必须大于零");
    int count=0;
    for(var row:rows) {
      var p=OrderService.calculatePrice(base,threshold,tier,mode,((Number)row.get("quantity")).longValue());
      if(same(p.baseCasePrice(),row.get("base_case_price")==null?row.get("case_price"):row.get("base_case_price"))
          && same(p.casePriceSnapshot(),row.get("case_price")) && same(p.tierCasePrice(),row.get("tier_case_price"))
          && same(p.tierMinQuantity(),row.get("tier_min_quantity")) && Objects.equals(p.pricingMode(),row.get("pricing_mode"))
          && same(p.lineAmount(),row.get("line_amount"))) continue;
      long orderId=((Number)row.get("order_id")).longValue();
      jdbc.update("""
          UPDATE order_item SET case_price=?,base_case_price=?,base_price_quantity=?,tier_case_price=?,
            tier_min_quantity=?,tier_price_quantity=?,pricing_mode=?,applied_tier_min_quantity=?,line_amount=? WHERE id=?
          """,p.casePriceSnapshot(),p.baseCasePrice(),p.baseQuantity(),p.tierCasePrice(),p.tierMinQuantity(),p.tierQuantity(),p.pricingMode(),p.appliedTierMinQuantity(),p.lineAmount(),row.get("id"));
      jdbc.update("UPDATE customer_order SET total_amount=(SELECT SUM(line_amount) FROM order_item WHERE order_id=?),lock_version=lock_version+1,last_modified_at=UTC_TIMESTAMP(3) WHERE id=?",orderId,orderId);
      orders.writeOutbox(activityId,orderId,"ORDER_PRICE_UPDATED",Map.of("orderId",orderId));
      count++;
    }
    if(count>0) dashboards.refreshFinalSnapshots(activityId);
    return count;
  }
  @Transactional
  public int backfill(long activityId) {
    orders.lockPricing(activityId);
    if(!"ACTIVE".equals(activities.byId(activityId).status())) throw DomainException.conflict("ACTIVITY_NOT_ACTIVE","只补处理指定的进行中活动");
    var products=jdbc.queryForList("""
        SELECT p.id,p.case_price,t.min_quantity,t.case_price tier_price,t.pricing_mode
        FROM activity_product p JOIN activity_data_binding b ON b.activity_id=p.activity_id AND b.data_type='PRODUCT' AND b.current_version_id=p.data_version_id
        LEFT JOIN activity_product_price_tier t ON t.activity_product_id=p.id WHERE p.activity_id=? ORDER BY p.id
        """,activityId);
    int count=0;
    for(var p:products) count+=sync(activityId,((Number)p.get("id")).longValue(),(BigDecimal)p.get("case_price"),
        p.get("min_quantity")==null?null:((Number)p.get("min_quantity")).longValue(),(BigDecimal)p.get("tier_price"),(String)p.get("pricing_mode"));
    return count;
  }
  static boolean same(Object a,Object b) {
    return a==null || b==null ? a==b : new BigDecimal(a.toString()).compareTo(new BigDecimal(b.toString()))==0;
  }
}
