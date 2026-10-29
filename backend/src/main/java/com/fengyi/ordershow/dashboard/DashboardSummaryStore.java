package com.fengyi.ordershow.dashboard;

import java.util.Arrays;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/** Disposable read model. Never changes orders, history, or historical dashboard snapshots. */
@Repository
public class DashboardSummaryStore {
  private final JdbcTemplate jdbc;
  private final boolean enabled;
  private final Set<Long> activities;

  public DashboardSummaryStore(JdbcTemplate jdbc,
      @Value("${order-show.dashboard.summary-enabled:false}") boolean enabled,
      @Value("${order-show.dashboard.summary-activities:}") String activities) {
    this.jdbc = jdbc;
    this.enabled = enabled;
    this.activities = Arrays.stream(activities.split(",")).map(String::trim).filter(s -> !s.isEmpty())
        .map(Long::valueOf).collect(Collectors.toUnmodifiableSet());
  }

  public boolean useSummary(long activityId) {
    return enabled && (activities.isEmpty() || activities.contains(activityId));
  }

  /** Called after all detail writes, inside the existing order/price transaction. */
  @Transactional(propagation = Propagation.MANDATORY)
  public void refresh(long orderId) {
    // Serialize with item-trigger invalidations BEFORE reading details. This also protects backfill.
    jdbc.update("INSERT IGNORE INTO order_dashboard_stat(order_id, dirty) VALUES (?, TRUE)", orderId);
    var dirty = jdbc.queryForObject("SELECT dirty FROM order_dashboard_stat WHERE order_id = ? FOR UPDATE", Boolean.class, orderId);
    if (!Boolean.TRUE.equals(dirty)) return;
    jdbc.update("DELETE FROM order_dashboard_product_line_stat WHERE order_id = ?", orderId);
    jdbc.update("""
        INSERT INTO order_dashboard_product_line_stat(order_id,product_line,is_gift_box,line_amount,quantity)
        SELECT order_id,product_line,is_gift_box,SUM(line_amount),SUM(quantity)
        FROM order_item WHERE order_id = ? GROUP BY order_id,product_line,is_gift_box
        """, orderId);
    jdbc.update("""
        UPDATE order_dashboard_stat s JOIN (
          SELECT COUNT(*) item_count, SUM(line_tons) all_tons,
            SUM(CASE WHEN ton_case_factor IS NOT NULL OR line_tons > 0 THEN line_tons END) eligible_tons
          FROM order_item WHERE order_id = ?
        ) v SET s.item_count=v.item_count,s.all_tons=v.all_tons,s.eligible_tons=v.eligible_tons,
          s.dirty=FALSE,s.rebuilt_at=UTC_TIMESTAMP(3) WHERE s.order_id = ?
        """, orderId, orderId);
  }

  /** scoped_orders is supplied by each query: never aggregate unrelated activities. */
  static String tonsSource(boolean summary, boolean tons) {
    String weight = tons ? "SUM(CASE WHEN i.ton_case_factor IS NOT NULL OR i.line_tons > 0 THEN i.line_tons END)"
        : "COALESCE(SUM(i.line_tons), 0)";
    String raw = "SELECT i.order_id, " + weight + " tons, SUM(i.line_tons) all_tons "
        + "FROM order_item i JOIN scoped_orders o ON o.id=i.order_id ";
    if (!summary) return raw + "GROUP BY i.order_id";
    // MySQL may otherwise start from order_item (especially with a gift filter),
    // scanning clean orders before checking dirty. Visit scope -> state -> items.
    String fallback = "SELECT STRAIGHT_JOIN i.order_id, " + weight + " tons, SUM(i.line_tons) all_tons "
        + "FROM scoped_orders o LEFT JOIN order_dashboard_stat s ON s.order_id=o.id "
        + "JOIN order_item i ON i.order_id=o.id WHERE s.order_id IS NULL OR s.dirty=TRUE GROUP BY i.order_id";
    return "SELECT s.order_id, " + (tons ? "s.eligible_tons" : "COALESCE(s.all_tons,0)")
        + " tons,s.all_tons FROM order_dashboard_stat s JOIN scoped_orders o ON o.id=s.order_id "
        + "WHERE s.dirty=FALSE AND s.item_count>0 UNION ALL " + fallback;
  }

  static String lineSource(boolean summary) {
    String raw = "SELECT i.order_id,i.product_line,i.is_gift_box,i.line_amount,i.quantity "
        + "FROM order_item i JOIN scoped_orders o ON o.id=i.order_id ";
    if (!summary) return raw;
    return "SELECT i.order_id,i.product_line,i.is_gift_box,i.line_amount,i.quantity "
        + "FROM order_dashboard_product_line_stat i JOIN scoped_orders o ON o.id=i.order_id "
        + "JOIN order_dashboard_stat s ON s.order_id=i.order_id WHERE s.dirty=FALSE UNION ALL "
        + "SELECT STRAIGHT_JOIN i.order_id,i.product_line,i.is_gift_box,i.line_amount,i.quantity "
        + "FROM scoped_orders o LEFT JOIN order_dashboard_stat s ON s.order_id=o.id "
        + "JOIN order_item i ON i.order_id=o.id WHERE s.order_id IS NULL OR s.dirty=TRUE";
  }
}
