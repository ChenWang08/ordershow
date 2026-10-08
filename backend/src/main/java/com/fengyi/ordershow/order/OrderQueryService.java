package com.fengyi.ordershow.order;

import com.fengyi.ordershow.common.PageResponse;
import com.fengyi.ordershow.order.OrderService.OrderSummary;
import com.fengyi.ordershow.security.CryptoService;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
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

  public PageResponse<OrderSummary> adminOrders(long activityId, String status, String customerType, String keyword,
                                                 int page, int size, String traceId) {
    int safePage = Math.max(page, 1), safeSize = Math.min(Math.max(size, 1), 200), offset = (safePage - 1) * safeSize;
    String where = orderFilterSql();
    Object[] args = orderFilterArgs(activityId, status, customerType, keyword);
    Long total = jdbc.queryForObject("SELECT COUNT(*) FROM customer_order o JOIN activity_customer c ON c.id = o.activity_customer_id" + where, Long.class, args);
    List<Object> pagedArgs = new ArrayList<>(java.util.Arrays.asList(args)); pagedArgs.add(safeSize); pagedArgs.add(offset);
    List<OrderSummary> data = jdbc.query("""
        SELECT o.*, c.phone, c.phone_masked FROM customer_order o JOIN activity_customer c ON c.id = o.activity_customer_id
        """ + where + " ORDER BY o.last_modified_at DESC, o.id DESC LIMIT ? OFFSET ?", this::mapSummary, pagedArgs.toArray());
    return PageResponse.of(data, safePage, safeSize, total == null ? 0 : total, traceId);
  }

  ExportData exportData(long activityId, String status, String customerType, String keyword) {
    String where = orderFilterSql();
    Object[] args = orderFilterArgs(activityId, status, customerType, keyword);
    List<OrderSummary> orders = jdbc.query("SELECT o.*, c.phone, c.phone_masked FROM customer_order o JOIN activity_customer c ON c.id = o.activity_customer_id" + where + " ORDER BY o.last_modified_at DESC, o.id DESC", this::mapSummary, args);
    List<Map<String, Object>> details = jdbc.queryForList("""
        SELECT o.order_no, o.status, o.created_source, o.customer_type, o.region_code, o.branch_name_snapshot,
          o.dealer_full_name_snapshot, c.phone, c.phone_masked, o.current_version_no, i.line_no, i.material_code,
          i.material_name, i.product_line, i.specification, i.case_pack, i.quantity, i.case_price, i.applied_tier_min_quantity,
          i.base_case_price, i.base_price_quantity, i.tier_case_price, i.tier_min_quantity, i.tier_price_quantity, i.pricing_mode,
          i.line_amount, i.line_tons, o.last_submitted_at
        FROM customer_order o JOIN activity_customer c ON c.id = o.activity_customer_id
        JOIN order_item i ON i.order_id = o.id
        """ + where + " ORDER BY o.last_modified_at DESC, o.id DESC, i.line_no", args);
    String effectiveWhere = where;
    Object[] effectiveArgs = orderFilterArgs(activityId, "SUBMITTED", customerType, keyword);
    List<Map<String, Object>> productTotals = jdbc.queryForList("""
        SELECT i.material_code, i.material_name, i.product_line, i.specification, i.case_pack,
          SUM(i.quantity) total_quantity, SUM(i.line_amount) total_amount,
          COALESCE(SUM(i.line_tons), 0) total_tons,
          COUNT(DISTINCT o.id) order_count
        FROM customer_order o JOIN activity_customer c ON c.id = o.activity_customer_id
        JOIN order_item i ON i.order_id = o.id
        """ + effectiveWhere + " GROUP BY i.material_code, i.material_name, i.product_line, i.specification, i.case_pack ORDER BY i.product_line, i.material_code", effectiveArgs);
    List<Map<String, Object>> branchTotals = jdbc.queryForList("""
        SELECT o.region_code, o.branch_name_snapshot, COUNT(*) order_count, SUM(o.total_quantity) total_quantity,
          COALESCE(SUM(o.total_tons), 0) total_tons,
          SUM(o.total_amount) total_amount
        FROM customer_order o JOIN activity_customer c ON c.id = o.activity_customer_id
        """ + effectiveWhere + " GROUP BY o.region_code, o.branch_name_snapshot ORDER BY o.region_code, o.branch_name_snapshot", effectiveArgs);
    return new ExportData(orders, details, productTotals, branchTotals);
  }

  private static String orderFilterSql() {
    return " WHERE o.activity_id = ? AND (? IS NULL OR ? = '' OR o.status = ?) AND (? IS NULL OR ? = '' OR o.customer_type = ?) " +
        "AND (? IS NULL OR ? = '' OR o.order_no LIKE CONCAT('%', ?, '%') OR o.dealer_full_name_snapshot LIKE CONCAT('%', ?, '%') " +
        "OR c.phone LIKE CONCAT('%', ?, '%') OR c.phone_lookup_hash = ? OR c.phone_masked LIKE CONCAT('%', ?, '%'))";
  }

  private Object[] orderFilterArgs(long activityId, String status, String customerType, String keyword) {
    String normalizedKeyword = keyword == null ? null : keyword.trim();
    String digits = CryptoService.normalizePhone(normalizedKeyword);
    byte[] phoneHash = digits.length() == 11 ? crypto.lookupHash(digits) : null;
    String phoneSuffix = digits.length() >= 4 ? digits.substring(digits.length() - 4) : null;
    return new Object[]{activityId, status, status, status, customerType, customerType, customerType,
        normalizedKeyword, normalizedKeyword, normalizedKeyword, normalizedKeyword, digits.isEmpty() ? normalizedKeyword : digits, phoneHash, phoneSuffix};
  }

  private OrderSummary mapSummary(ResultSet rs, int rowNum) throws SQLException { return new OrderSummary(rs.getLong("id"), rs.getString("order_no"), rs.getString("status"), rs.getString("created_source"), rs.getString("last_modified_source"), rs.getString("customer_type"), rs.getString("region_code"), rs.getString("branch_name_snapshot"), rs.getString("dealer_full_name_snapshot"), rs.getString("phone"), rs.getString("phone_masked"), rs.getInt("current_version_no"), rs.getInt("lock_version"), rs.getLong("total_quantity"), rs.getBigDecimal("total_tons"), rs.getBigDecimal("total_amount"), rs.getTimestamp("first_submitted_at").toInstant(), rs.getTimestamp("last_submitted_at").toInstant(), rs.getTimestamp("last_modified_at").toInstant()); }

  record ExportData(List<OrderSummary> orders, List<Map<String, Object>> details,
                    List<Map<String, Object>> productTotals, List<Map<String, Object>> branchTotals) {}
}
