package com.fengyi.ordershow.order;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** Tonnage synchronization updates only current rows of submitted orders. */
@Repository
public class TonnageSyncRepository {
  private final JdbcTemplate jdbc;

  public TonnageSyncRepository(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  List<CurrentItem> submittedItems(long activityId, long productId) {
    return jdbc.query("""
        SELECT i.id, i.order_id, i.quantity, i.ton_case_factor, i.line_tons
        FROM order_item i JOIN customer_order o ON o.id = i.order_id
        WHERE o.activity_id = ? AND o.status = 'SUBMITTED' AND i.activity_product_id = ?
        ORDER BY o.id
        """, (rs, rowNum) -> new CurrentItem(rs.getLong("id"), rs.getLong("order_id"), rs.getLong("quantity"),
        rs.getBigDecimal("ton_case_factor"), rs.getBigDecimal("line_tons")), activityId, productId);
  }

  void updateItem(long itemId, BigDecimal factor, BigDecimal lineTons) {
    jdbc.update("UPDATE order_item SET ton_case_factor = ?, line_tons = ? WHERE id = ?", factor, lineTons, itemId);
  }

  void updateOrderTotal(long orderId) {
    jdbc.update("""
        UPDATE customer_order
        SET total_tons = (
          SELECT CASE WHEN COUNT(*) = COUNT(line_tons) THEN SUM(line_tons) ELSE NULL END
          FROM order_item WHERE order_id = ?
        ), lock_version = lock_version + 1, last_modified_at = UTC_TIMESTAMP(3)
        WHERE id = ?
        """, orderId, orderId);
  }

  record CurrentItem(long id, long orderId, long quantity, BigDecimal tonCaseFactor, BigDecimal lineTons) {}
}
