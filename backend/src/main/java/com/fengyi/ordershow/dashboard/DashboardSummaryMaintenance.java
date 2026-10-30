package com.fengyi.ordershow.dashboard;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.springframework.dao.TransientDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/** Explicit maintenance only: bounded batches, one short transaction per order, resumable by order ID. */
public final class DashboardSummaryMaintenance {
  private final JdbcTemplate jdbc;
  private final DashboardSummaryStore store;
  private final TransactionTemplate write;
  private final TransactionTemplate read;

  public DashboardSummaryMaintenance(JdbcTemplate jdbc, PlatformTransactionManager manager) {
    this.jdbc = jdbc;
    this.store = new DashboardSummaryStore(jdbc, true, "");
    write = new TransactionTemplate(manager);
    write.setIsolationLevel(TransactionDefinition.ISOLATION_READ_COMMITTED);
    write.setTimeout(15);
    read = new TransactionTemplate(manager);
    read.setIsolationLevel(TransactionDefinition.ISOLATION_REPEATABLE_READ);
    read.setReadOnly(true);
    read.setTimeout(15);
  }

  public Batch rebuild(long activityId, long afterId, int limit, boolean force) {
    List<Long> ids = ids(activityId, afterId, limit);
    for (long id : ids) {
      for (int attempt = 0; ; attempt++) {
        try {
          write.executeWithoutResult(status -> {
            // Match business lock order; exclusive price sync and lifecycle changes finish first.
            jdbc.queryForList("SELECT id FROM activity WHERE id=? FOR SHARE", Long.class, activityId);
            if (jdbc.queryForList("SELECT id FROM customer_order WHERE activity_id=? AND id=? FOR UPDATE",
                Long.class, activityId, id).isEmpty()) return;
            if (force) jdbc.update("UPDATE order_dashboard_stat SET dirty=TRUE WHERE order_id=?", id);
            store.refresh(id);
          });
          break;
        } catch (TransientDataAccessException exception) {
          if (attempt >= 2) throw exception;
        }
      }
    }
    return new Batch(ids.size(), ids.isEmpty() ? afterId : ids.getLast(), List.of());
  }

  public Batch reconcile(long activityId, long afterId, int limit) {
    List<Long> ids = ids(activityId, afterId, limit);
    List<Difference> differences = new ArrayList<>();
    for (long id : ids) {
      Difference difference = read.execute(status -> compare(id));
      if (difference != null) differences.add(difference);
    }
    return new Batch(ids.size(), ids.isEmpty() ? afterId : ids.getLast(), differences);
  }

  private List<Long> ids(long activityId, long afterId, int limit) {
    if (activityId <= 0 || afterId < 0 || limit < 1 || limit > 500) {
      throw new IllegalArgumentException("activity must be positive, after nonnegative, batch size 1..500");
    }
    return jdbc.queryForList("SELECT id FROM customer_order WHERE activity_id=? AND id>? ORDER BY id LIMIT ?",
        Long.class, activityId, afterId, limit);
  }

  private Difference compare(long id) {
    var stats = jdbc.queryForList("SELECT item_count,all_tons,eligible_tons,dirty FROM order_dashboard_stat WHERE order_id=?", id);
    if (stats.isEmpty()) return new Difference(id, "MISSING");
    Map<String, Object> actual = stats.getFirst();
    Object dirty = actual.remove("dirty");
    if (Boolean.TRUE.equals(dirty) || "1".equals(String.valueOf(dirty))) return new Difference(id, "DIRTY");
    var expected = jdbc.queryForMap("""
        SELECT COUNT(*) item_count,SUM(line_tons) all_tons,
          SUM(CASE WHEN ton_case_factor IS NOT NULL OR line_tons>0 THEN line_tons END) eligible_tons
        FROM order_item WHERE order_id=?
        """, id);
    if (!canonical(expected).equals(canonical(actual))) return new Difference(id, "TONS_OR_COUNT");
    // Compare with SQL's original collation and NULL equality, including duplicate derived groups.
    Long mismatches = jdbc.queryForObject("""
        WITH expected AS (
          SELECT product_line,is_gift_box,SUM(line_amount) amount,SUM(quantity) quantity
          FROM order_item WHERE order_id=? GROUP BY product_line,is_gift_box
        ), actual AS (
          SELECT product_line,is_gift_box,SUM(line_amount) amount,SUM(quantity) quantity,COUNT(*) copies
          FROM order_dashboard_product_line_stat WHERE order_id=? GROUP BY product_line,is_gift_box
        )
        SELECT COUNT(*) FROM (
          SELECT e.product_line FROM expected e LEFT JOIN actual a
            ON e.product_line <=> a.product_line AND e.is_gift_box=a.is_gift_box
          WHERE a.copies IS NULL OR a.copies<>1 OR NOT(e.amount <=> a.amount) OR NOT(e.quantity <=> a.quantity)
          UNION ALL
          SELECT a.product_line FROM actual a LEFT JOIN expected e
            ON e.product_line <=> a.product_line AND e.is_gift_box=a.is_gift_box
          WHERE e.is_gift_box IS NULL
        ) differences
        """, Long.class, id, id);
    return mismatches != null && mismatches > 0 ? new Difference(id, "PRODUCT_LINE_OR_GIFT") : null;
  }

  private Map<String, String> canonical(Map<String, Object> values) {
    Map<String, String> result = new java.util.TreeMap<>();
    values.forEach((key, value) -> result.put(key, value == null ? "NULL"
        : value instanceof Number ? new BigDecimal(value.toString()).stripTrailingZeros().toPlainString() : value.toString()));
    return result;
  }

  public record Difference(long orderId, String reason) {}
  public record Batch(int checked, long nextAfterId, List<Difference> differences) {}
}
