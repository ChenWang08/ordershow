package com.fengyi.ordershow.dashboard;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengyi.ordershow.activity.ActivityFinishedEvent;
import com.fengyi.ordershow.activity.ActivityService;
import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Service;

@Service
public class DashboardService {
  private final JdbcTemplate jdbc;
  private final ActivityService activities;
  private final ObjectMapper json;

  public DashboardService(JdbcTemplate jdbc, ActivityService activities, ObjectMapper json) {
    this.jdbc = jdbc; this.activities = activities; this.json = json;
  }

  public Dashboard ranking(String activityCode) {
    return ranking(activityCode, null, null);
  }

  public Dashboard ranking(String activityCode, String customerType, String regionCode) {
    var activity = activities.byCode(activityCode);
    if (isHistorical(activity.status())) {
      return snapshot(rankingKey(customerType, regionCode), activity.id(), Dashboard.class,
          () -> liveRanking(activity, customerType, regionCode));
    }
    return liveRanking(activity, customerType, regionCode);
  }

  private Dashboard liveRanking(ActivityService.ActivityView activity, String customerType, String regionCode) {
    return liveRanking(activity, customerType, regionCode, 0);
  }

  private Dashboard liveRanking(ActivityService.ActivityView activity, String customerType, String regionCode, int minimumTopN) {
    Map<String, Object> totals = new LinkedHashMap<>(jdbc.queryForMap("""
        SELECT COUNT(*) order_count, COALESCE(SUM(total_quantity), 0) total_quantity,
          COALESCE(SUM(total_amount), 0) total_amount,
          COUNT(DISTINCT branch_name_snapshot) branch_count
        FROM customer_order WHERE activity_id = ? AND status = 'SUBMITTED'
          AND (? IS NULL OR ? = '' OR customer_type = ?)
          AND (? IS NULL OR ? = '' OR region_code = ?)
        """, activity.id(), customerType, customerType, customerType, regionCode, regionCode, regionCode));
    BigDecimal totalTons = jdbc.queryForObject("""
        SELECT SUM(i.line_tons)
        FROM order_item i JOIN customer_order o ON o.id = i.order_id
        WHERE o.activity_id = ? AND o.status = 'SUBMITTED'
          AND (? IS NULL OR ? = '' OR o.customer_type = ?)
          AND (? IS NULL OR ? = '' OR o.region_code = ?)
        """, BigDecimal.class, activity.id(), customerType, customerType, customerType, regionCode, regionCode, regionCode);
    totals.put("total_tons", totalTons);
    totals.put("dealer_count", totals.get("order_count"));
    Long skuCount = jdbc.queryForObject("""
        SELECT COUNT(DISTINCT i.activity_product_id)
        FROM order_item i JOIN customer_order o ON o.id = i.order_id
        WHERE o.activity_id = ? AND o.status = 'SUBMITTED'
          AND (? IS NULL OR ? = '' OR o.customer_type = ?)
          AND (? IS NULL OR ? = '' OR o.region_code = ?)
        """, Long.class, activity.id(), customerType, customerType, customerType, regionCode, regionCode, regionCode);
    totals.put("sku_count", skuCount == null ? 0L : skuCount);
    List<RankRow> companies = jdbc.query("""
        SELECT o.id, o.dealer_full_name_snapshot name, o.branch_name_snapshot branch, o.total_amount amount,
          o.total_quantity quantity, item_tons.tons
        FROM customer_order o
        LEFT JOIN (SELECT order_id, SUM(line_tons) tons FROM order_item GROUP BY order_id) item_tons ON item_tons.order_id = o.id
        WHERE o.activity_id = ? AND o.status = 'SUBMITTED'
          AND (? IS NULL OR ? = '' OR o.customer_type = ?)
          AND (? IS NULL OR ? = '' OR o.region_code = ?)
        ORDER BY o.total_amount DESC, o.last_submitted_at, o.id LIMIT ?
        """, (rs, rowNum) -> new RankRow(rowNum + 1, rs.getString("name"), rs.getString("branch"),
        rs.getBigDecimal("amount"), rs.getLong("quantity"), rs.getBigDecimal("tons")), activity.id(),
        customerType, customerType, customerType, regionCode, regionCode, regionCode, Math.max(activity.companyRankingTopN(), minimumTopN));
    List<RankRow> branches = jdbc.query("""
        SELECT o.branch_name_snapshot name, SUM(o.total_amount) amount, SUM(o.total_quantity) quantity,
          SUM(item_tons.tons) tons
        FROM customer_order o
        LEFT JOIN (SELECT order_id, SUM(line_tons) tons FROM order_item GROUP BY order_id) item_tons ON item_tons.order_id = o.id
        WHERE o.activity_id = ? AND o.status = 'SUBMITTED'
          AND (? IS NULL OR ? = '' OR o.customer_type = ?)
          AND (? IS NULL OR ? = '' OR o.region_code = ?)
        GROUP BY o.branch_name_snapshot ORDER BY amount DESC, name LIMIT ?
        """, (rs, rowNum) -> new RankRow(rowNum + 1, rs.getString("name"), null,
        rs.getBigDecimal("amount"), rs.getLong("quantity"), rs.getBigDecimal("tons")), activity.id(),
        customerType, customerType, customerType, regionCode, regionCode, regionCode, Math.max(activity.branchRankingTopN(), minimumTopN));
    return new Dashboard(activity.id(), activity.name(), activity.status(), totals, companies, branches,
        productLines(activity.id(), customerType, regionCode), latestOrders(activity.id(), customerType, regionCode),
        dashboardVersion(activity.id()), Instant.now());
  }

  public Report report(String activityCode, String reportCode) {
    var activity = activities.byCode(activityCode);
    if (isHistorical(activity.status())) {
      Report frozen = snapshot("REPORT", activity.id(), Report.class, () -> liveReport(activity, "FINAL"));
      return new Report(reportCode, frozen.dashboard(), frozen.customerTypes(), frozen.regions(),
          frozen.generalProductLines(), frozen.specialProductLines(), frozen.giftCustomerTypes(),
          frozen.topGeneral(), frozen.topSpecial(), frozen.trend(), frozen.regionProductLines());
    }
    return liveReport(activity, reportCode);
  }

  private Report liveReport(ActivityService.ActivityView activity, String reportCode) {
    Dashboard dashboard = liveRanking(activity, null, null, 15);
    List<CustomerTypeTotal> types = jdbc.query("""
        SELECT customer_type, COUNT(*) order_count, SUM(total_amount) amount, SUM(total_quantity) quantity
        FROM customer_order WHERE activity_id = ? AND status = 'SUBMITTED' GROUP BY customer_type ORDER BY customer_type
        """, (rs, rowNum) -> new CustomerTypeTotal(rs.getString(1), rs.getLong(2), rs.getBigDecimal(3), rs.getLong(4)), dashboard.activityId());
    Instant trendStart = activity.actualStartedAt() == null ? activity.startsAt() : activity.actualStartedAt();
    Instant trendEnd = activity.closedAt() == null ? dashboard.generatedAt() : activity.closedAt();
    if (trendEnd.isAfter(activity.endsAt())) trendEnd = activity.endsAt();
    List<TrendPoint> trend = trendEnd.isBefore(trendStart) ? List.of() : jdbc.query("""
        SELECT CONCAT(DATE_FORMAT(last_submitted_at, '%Y-%m-%dT%H:00:00'), 'Z') bucket,
          SUM(total_amount) amount, COUNT(*) orders
        FROM customer_order
        WHERE activity_id = ? AND status = 'SUBMITTED'
          AND last_submitted_at >= ? AND last_submitted_at <= ?
        GROUP BY bucket ORDER BY bucket
        """, (rs, rowNum) -> new TrendPoint(rs.getString(1), rs.getBigDecimal(2), rs.getLong(3)),
        dashboard.activityId(), Timestamp.from(trendStart), Timestamp.from(trendEnd));
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
    List<RegionProductLineTotal> regionProductLines = jdbc.query("""
        SELECT COALESCE(o.region_code, 'UNASSIGNED'), COALESCE(i.product_line, '其他'),
          SUM(i.line_amount), SUM(i.quantity)
        FROM order_item i JOIN customer_order o ON o.id = i.order_id
        WHERE o.activity_id = ? AND o.status = 'SUBMITTED' AND o.customer_type = 'GENERAL'
        GROUP BY o.region_code, i.product_line
        ORDER BY o.region_code, SUM(i.line_amount) DESC, i.product_line
        """, (rs, rowNum) -> new RegionProductLineTotal(rs.getString(1), rs.getString(2),
        rs.getBigDecimal(3), rs.getLong(4)), dashboard.activityId());
    return new Report(reportCode, dashboard, types, regions, productLines(dashboard.activityId(), "GENERAL", null),
        productLines(dashboard.activityId(), "SPECIAL", null), giftTypes, topCustomers(dashboard.activityId(), "GENERAL"),
        topCustomers(dashboard.activityId(), "SPECIAL"), trend, regionProductLines);
  }

  @EventListener
  public void freezeFinalSnapshots(ActivityFinishedEvent event) {
    var activity = activities.byId(event.activityId());
    if (!"FINISHED".equals(activity.status())) return;
    storeSnapshot(activity.id(), rankingKey(null, null), liveRanking(activity, null, null));
    storeSnapshot(activity.id(), rankingKey("GENERAL", null), liveRanking(activity, "GENERAL", null));
    storeSnapshot(activity.id(), rankingKey("SPECIAL", null), liveRanking(activity, "SPECIAL", null));
    for (var region : activity.regions()) {
      storeSnapshot(activity.id(), rankingKey("GENERAL", region.code()), liveRanking(activity, "GENERAL", region.code()));
    }
    storeSnapshot(activity.id(), "REPORT", liveReport(activity, "FINAL"));
  }

  private String rankingKey(String customerType, String regionCode) {
    return "RANKING:" + (customerType == null ? "ALL" : customerType) + ":" + (regionCode == null ? "ALL" : regionCode);
  }

  private boolean isHistorical(String status) {
    return "FINISHED".equals(status) || "ARCHIVED".equals(status);
  }

  private <T> T snapshot(String key, long activityId, Class<T> type, java.util.function.Supplier<T> fallback) {
    List<String> values = jdbc.queryForList(
        "SELECT CAST(payload_json AS CHAR) FROM activity_dashboard_snapshot WHERE activity_id = ? AND snapshot_key = ?",
        String.class, activityId, key);
    if (!values.isEmpty()) {
      try { return json.readValue(values.getFirst(), type); }
      catch (JsonProcessingException exception) { throw new IllegalStateException("历史看板快照无法读取", exception); }
    }
    T value = fallback.get();
    storeSnapshot(activityId, key, value);
    return value;
  }

  private void storeSnapshot(long activityId, String key, Object value) {
    try {
      jdbc.update("""
          INSERT INTO activity_dashboard_snapshot(activity_id, snapshot_key, payload_json)
          VALUES (?, ?, CAST(? AS JSON))
          ON DUPLICATE KEY UPDATE snapshot_key = VALUES(snapshot_key)
          """, activityId, key, json.writeValueAsString(value));
    } catch (JsonProcessingException exception) {
      throw new IllegalStateException("最终看板快照生成失败", exception);
    }
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
  public record RegionProductLineTotal(String regionCode, String productLine, BigDecimal amount, long quantity) {}
  public record Dashboard(long activityId, String activityName, String status, Map<String, Object> totals,
                          List<RankRow> companies, List<RankRow> branches, List<ProductLineTotal> productLines,
                          List<LatestOrder> latestOrders, String version, Instant generatedAt) {}
  public record Report(String reportCode, Dashboard dashboard, List<CustomerTypeTotal> customerTypes,
                       List<RegionTotal> regions, List<ProductLineTotal> generalProductLines,
                       List<ProductLineTotal> specialProductLines, List<CustomerTypeTotal> giftCustomerTypes,
                       List<RankRow> topGeneral, List<RankRow> topSpecial, List<TrendPoint> trend,
                       List<RegionProductLineTotal> regionProductLines) {}
}
