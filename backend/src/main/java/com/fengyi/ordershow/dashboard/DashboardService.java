package com.fengyi.ordershow.dashboard;

import com.fengyi.ordershow.activity.ActivityService;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class DashboardService {
  private final JdbcTemplate jdbc;
  private final ActivityService activities;

  public DashboardService(JdbcTemplate jdbc, ActivityService activities) { this.jdbc = jdbc; this.activities = activities; }

  public Dashboard ranking(String activityCode) {
    return ranking(activityCode, null, null);
  }

  public Dashboard ranking(String activityCode, String customerType, String regionCode) {
    var activity = activities.byCode(activityCode);
    Map<String, Object> totals = jdbc.queryForMap("""
        SELECT COUNT(*) order_count, COALESCE(SUM(total_quantity), 0) total_quantity,
          COALESCE(SUM(total_amount), 0) total_amount,
          CASE WHEN SUM(total_tons IS NULL) > 0 THEN NULL ELSE COALESCE(SUM(total_tons), 0) END total_tons,
          COUNT(DISTINCT branch_name_snapshot) branch_count
        FROM customer_order WHERE activity_id = ? AND status = 'SUBMITTED'
          AND (? IS NULL OR ? = '' OR customer_type = ?)
          AND (? IS NULL OR ? = '' OR region_code = ?)
        """, activity.id(), customerType, customerType, customerType, regionCode, regionCode, regionCode);
    List<RankRow> companies = jdbc.query("""
        SELECT id, dealer_full_name_snapshot name, branch_name_snapshot branch, total_amount amount, total_quantity quantity, total_tons tons
        FROM customer_order WHERE activity_id = ? AND status = 'SUBMITTED'
          AND (? IS NULL OR ? = '' OR customer_type = ?)
          AND (? IS NULL OR ? = '' OR region_code = ?)
        ORDER BY total_amount DESC, last_submitted_at, id LIMIT ?
        """, (rs, rowNum) -> new RankRow(rowNum + 1, rs.getString("name"), rs.getString("branch"),
        rs.getBigDecimal("amount"), rs.getLong("quantity"), rs.getBigDecimal("tons")), activity.id(),
        customerType, customerType, customerType, regionCode, regionCode, regionCode, activity.companyRankingTopN());
    List<RankRow> branches = jdbc.query("""
        SELECT branch_name_snapshot name, SUM(total_amount) amount, SUM(total_quantity) quantity,
          CASE WHEN SUM(total_tons IS NULL) > 0 THEN NULL ELSE SUM(total_tons) END tons
        FROM customer_order WHERE activity_id = ? AND status = 'SUBMITTED'
          AND (? IS NULL OR ? = '' OR customer_type = ?)
          AND (? IS NULL OR ? = '' OR region_code = ?)
        GROUP BY branch_name_snapshot ORDER BY amount DESC, name LIMIT ?
        """, (rs, rowNum) -> new RankRow(rowNum + 1, rs.getString("name"), null,
        rs.getBigDecimal("amount"), rs.getLong("quantity"), rs.getBigDecimal("tons")), activity.id(),
        customerType, customerType, customerType, regionCode, regionCode, regionCode, activity.branchRankingTopN());
    return new Dashboard(activity.id(), activity.name(), activity.status(), totals, companies, branches,
        productLines(activity.id(), customerType, regionCode), latestOrders(activity.id(), customerType, regionCode),
        dashboardVersion(activity.id()), Instant.now());
  }

  public Report report(String activityCode, String reportCode) {
    Dashboard dashboard = ranking(activityCode);
    List<CustomerTypeTotal> types = jdbc.query("""
        SELECT customer_type, COUNT(*) order_count, SUM(total_amount) amount, SUM(total_quantity) quantity
        FROM customer_order WHERE activity_id = ? AND status = 'SUBMITTED' GROUP BY customer_type ORDER BY customer_type
        """, (rs, rowNum) -> new CustomerTypeTotal(rs.getString(1), rs.getLong(2), rs.getBigDecimal(3), rs.getLong(4)), dashboard.activityId());
    List<TrendPoint> trend = jdbc.query("""
        SELECT DATE_FORMAT(last_submitted_at, '%Y-%m-%d %H:00:00') bucket, SUM(total_amount) amount, COUNT(*) orders
        FROM customer_order WHERE activity_id = ? AND status = 'SUBMITTED'
        GROUP BY bucket ORDER BY bucket
        """, (rs, rowNum) -> new TrendPoint(rs.getString(1), rs.getBigDecimal(2), rs.getLong(3)), dashboard.activityId());
    List<RegionTotal> regions = jdbc.query("""
        SELECT COALESCE(region_code, 'UNASSIGNED'), SUM(total_amount), COUNT(*)
        FROM customer_order WHERE activity_id = ? AND status = 'SUBMITTED' AND customer_type = 'GENERAL'
        GROUP BY region_code ORDER BY SUM(total_amount) DESC
        """, (rs, rowNum) -> new RegionTotal(rs.getString(1), rs.getBigDecimal(2), rs.getLong(3)), dashboard.activityId());
    List<CustomerTypeTotal> giftTypes = jdbc.query("""
        SELECT o.customer_type, COUNT(DISTINCT o.id), SUM(i.line_amount), SUM(i.quantity)
        FROM order_item i JOIN customer_order o ON o.id = i.order_id
        WHERE o.activity_id = ? AND o.status = 'SUBMITTED' AND i.is_gift_box = TRUE
        GROUP BY o.customer_type ORDER BY o.customer_type
        """, (rs, rowNum) -> new CustomerTypeTotal(rs.getString(1), rs.getLong(2), rs.getBigDecimal(3), rs.getLong(4)), dashboard.activityId());
    return new Report(reportCode, dashboard, types, regions, productLines(dashboard.activityId(), "GENERAL", null),
        productLines(dashboard.activityId(), "SPECIAL", null), giftTypes, topCustomers(dashboard.activityId(), "GENERAL"),
        topCustomers(dashboard.activityId(), "SPECIAL"), trend);
  }

  private List<RankRow> topCustomers(long activityId, String customerType) {
    return jdbc.query("""
        SELECT dealer_full_name_snapshot, branch_name_snapshot, total_amount, total_quantity, total_tons
        FROM customer_order WHERE activity_id = ? AND status = 'SUBMITTED' AND customer_type = ?
        ORDER BY total_amount DESC, last_submitted_at, id LIMIT 5
        """, (rs, rowNum) -> new RankRow(rowNum + 1, rs.getString(1), rs.getString(2), rs.getBigDecimal(3),
        rs.getLong(4), rs.getBigDecimal(5)), activityId, customerType);
  }

  private List<ProductLineTotal> productLines(long activityId, String customerType, String regionCode) {
    return jdbc.query("""
        SELECT COALESCE(product_line, '其他') product_line, SUM(line_amount) amount, SUM(quantity) quantity
        FROM order_item i JOIN customer_order o ON o.id = i.order_id
        WHERE o.activity_id = ? AND o.status = 'SUBMITTED'
          AND (? IS NULL OR ? = '' OR o.customer_type = ?)
          AND (? IS NULL OR ? = '' OR o.region_code = ?)
        GROUP BY product_line ORDER BY amount DESC
        """, (rs, rowNum) -> new ProductLineTotal(rs.getString(1), rs.getBigDecimal(2), rs.getLong(3)), activityId,
        customerType, customerType, customerType, regionCode, regionCode, regionCode);
  }

  private List<LatestOrder> latestOrders(long activityId, String customerType, String regionCode) {
    return jdbc.query("""
        SELECT order_no, dealer_full_name_snapshot, branch_name_snapshot, total_amount, last_submitted_at
        FROM customer_order WHERE activity_id = ? AND status = 'SUBMITTED'
          AND (? IS NULL OR ? = '' OR customer_type = ?)
          AND (? IS NULL OR ? = '' OR region_code = ?)
        ORDER BY last_submitted_at DESC LIMIT 20
        """, (rs, rowNum) -> new LatestOrder(rs.getString(1), rs.getString(2), rs.getString(3), rs.getBigDecimal(4), rs.getTimestamp(5).toInstant()),
        activityId, customerType, customerType, customerType, regionCode, regionCode, regionCode);
  }

  private String dashboardVersion(long activityId) {
    Long value = jdbc.queryForObject("SELECT COALESCE(MAX(id), 0) FROM domain_event_outbox WHERE activity_id = ?", Long.class, activityId);
    return Long.toString(value == null ? 0 : value);
  }

  public record RankRow(int rank, String name, String branch, BigDecimal amount, long quantity, BigDecimal tons) {}
  public record ProductLineTotal(String productLine, BigDecimal amount, long quantity) {}
  public record LatestOrder(String orderNo, String dealerName, String branchName, BigDecimal amount, Instant submittedAt) {}
  public record CustomerTypeTotal(String customerType, long orderCount, BigDecimal amount, long quantity) {}
  public record RegionTotal(String regionCode, BigDecimal amount, long orderCount) {}
  public record TrendPoint(String bucket, BigDecimal amount, long orders) {}
  public record Dashboard(long activityId, String activityName, String status, Map<String, Object> totals,
                          List<RankRow> companies, List<RankRow> branches, List<ProductLineTotal> productLines,
                          List<LatestOrder> latestOrders, String version, Instant generatedAt) {}
  public record Report(String reportCode, Dashboard dashboard, List<CustomerTypeTotal> customerTypes,
                       List<RegionTotal> regions, List<ProductLineTotal> generalProductLines,
                       List<ProductLineTotal> specialProductLines, List<CustomerTypeTotal> giftCustomerTypes,
                       List<RankRow> topGeneral, List<RankRow> topSpecial, List<TrendPoint> trend) {}
}
