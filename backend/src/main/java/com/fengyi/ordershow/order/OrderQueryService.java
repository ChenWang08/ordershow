package com.fengyi.ordershow.order;

import com.fengyi.ordershow.common.UtcTime;

import com.fengyi.ordershow.common.PageResponse;
import com.fengyi.ordershow.order.OrderService.OrderSummary;
import com.fengyi.ordershow.security.CryptoService;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/** Read-only list and export queries share the same activity and search filters. */
@Service
public class OrderQueryService {
  private final JdbcTemplate jdbc;
  private final CryptoService crypto;

  public OrderQueryService(JdbcTemplate jdbc, CryptoService crypto) {
    this.jdbc = jdbc;
    this.crypto = crypto;
  }

  /** Activity-wide counts; list search and customer-type filters intentionally do not apply. */
  public OrderCounts adminOrderCounts(long activityId) {
    var counts = jdbc.queryForObject("""
        SELECT COUNT(*) total,
          COALESCE(SUM(o.status = 'SUBMITTED'), 0) submitted,
          COALESCE(SUM(o.status = 'WITHDRAWN'), 0) withdrawn,
          COALESCE(SUM(o.status = 'VOIDED'), 0) voided
        FROM customer_order o JOIN activity_customer c ON c.id = o.activity_customer_id
        WHERE o.activity_id = ?
        """, (rs, row) -> new OrderCounts(rs.getLong("total"), rs.getLong("submitted"),
            rs.getLong("withdrawn"), rs.getLong("voided"), 0), activityId);
    Long pending = jdbc.queryForObject(
        "SELECT COUNT(*) FROM order_change_request WHERE activity_id = ? AND status = 'PENDING'",
        Long.class, activityId);
    return new OrderCounts(counts.all(), counts.submitted(), counts.withdrawn(), counts.voided(),
        pending == null ? 0 : pending);
  }

  public record OrderCounts(long all, long submitted, long withdrawn, long voided, long pending) {}

  public PageResponse<OrderSummary> adminOrders(long activityId, String status, String customerType, String keyword,
                                                 int page, int size, String traceId) {
    int safePage = Math.max(page, 1), safeSize = Math.min(Math.max(size, 1), 200), offset = (safePage - 1) * safeSize;
    String where = orderFilterSql();
    Object[] args = orderFilterArgs(activityId, status, customerType, keyword);
    Long total = jdbc.queryForObject("SELECT COUNT(*) FROM customer_order o JOIN activity_customer c ON c.id = o.activity_customer_id" + where, Long.class, args);
    List<Object> pagedArgs = new ArrayList<>(java.util.Arrays.asList(args)); pagedArgs.add(safeSize); pagedArgs.add(offset);
    List<OrderSummary> data = jdbc.query("""
        SELECT o.*, c.phone, c.phone_masked, r.id pending_change_request_id
        FROM customer_order o JOIN activity_customer c ON c.id = o.activity_customer_id
        LEFT JOIN order_change_request r ON r.pending_order_id = o.id AND r.activity_id = o.activity_id
        """ + where + " ORDER BY o.last_modified_at DESC, o.id DESC LIMIT ? OFFSET ?", this::mapSummary, pagedArgs.toArray());
    return PageResponse.of(data, safePage, safeSize, total == null ? 0 : total, traceId);
  }

  public static String orderFilterSql() {
    return " WHERE o.activity_id = ? AND (? IS NULL OR ? = '' OR o.status = ?) AND (? IS NULL OR ? = '' OR o.customer_type = ?) " +
        "AND (? IS NULL OR ? = '' OR o.order_no LIKE CONCAT('%', ?, '%') OR o.dealer_full_name_snapshot LIKE CONCAT('%', ?, '%') " +
        "OR c.phone LIKE CONCAT('%', ?, '%') OR c.phone_lookup_hash = ? OR c.phone_masked LIKE CONCAT('%', ?, '%'))";
  }

  public Object[] orderFilterArgs(long activityId, String status, String customerType, String keyword) {
    String normalizedKeyword = keyword == null ? null : keyword.trim();
    String digits = CryptoService.normalizePhone(normalizedKeyword);
    byte[] phoneHash = digits.length() == 11 ? crypto.lookupHash(digits) : null;
    String phoneSuffix = digits.length() >= 4 ? digits.substring(digits.length() - 4) : null;
    return new Object[]{activityId, status, status, status, customerType, customerType, customerType,
        normalizedKeyword, normalizedKeyword, normalizedKeyword, normalizedKeyword, digits.isEmpty() ? normalizedKeyword : digits, phoneHash, phoneSuffix};
  }

  private OrderSummary mapSummary(ResultSet rs, int rowNum) throws SQLException { return new OrderSummary(rs.getLong("id"), rs.getString("order_no"), rs.getString("status"), rs.getString("created_source"), rs.getString("last_modified_source"), rs.getString("customer_type"), rs.getString("region_code"), rs.getString("branch_name_snapshot"), rs.getString("dealer_full_name_snapshot"), rs.getString("phone"), rs.getString("phone_masked"), rs.getInt("current_version_no"), rs.getInt("lock_version"), rs.getLong("total_quantity"), rs.getBigDecimal("total_tons"), rs.getBigDecimal("total_amount"), UtcTime.read(rs, "first_submitted_at"), UtcTime.read(rs, "last_submitted_at"), UtcTime.read(rs, "last_modified_at"), rs.getObject("pending_change_request_id", Long.class)); }
}
