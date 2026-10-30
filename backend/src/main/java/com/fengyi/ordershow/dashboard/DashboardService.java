package com.fengyi.ordershow.dashboard;

import com.fengyi.ordershow.common.UtcTime;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengyi.ordershow.activity.ActivityFinishedEvent;
import com.fengyi.ordershow.activity.ActivityService;
import com.fengyi.ordershow.common.DomainException;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Service;

@Service
@org.springframework.transaction.annotation.Transactional(isolation = org.springframework.transaction.annotation.Isolation.REPEATABLE_READ)
public class DashboardService {
  private final JdbcTemplate jdbc;
  private final ActivityService activities;
  private final ObjectMapper json;
  private DashboardSummaryStore summaries;

  public enum RankingMetric {
    AMOUNT, TONS;

    static RankingMetric from(String value) {
      if (value == null || value.isBlank() || "AMOUNT".equalsIgnoreCase(value.trim())) return AMOUNT;
      if ("TONS".equalsIgnoreCase(value.trim())) return TONS;
      throw DomainException.badRequest("RANKING_METRIC_INVALID", "排行口径只支持 AMOUNT 或 TONS");
    }
  }

  public DashboardService(JdbcTemplate jdbc, ActivityService activities, ObjectMapper json) {
    this.jdbc = jdbc; this.activities = activities; this.json = json;
  }

  @org.springframework.beans.factory.annotation.Autowired
  public DashboardService(JdbcTemplate jdbc, ActivityService activities, ObjectMapper json, DashboardSummaryStore summaries) {
    this(jdbc, activities, json);
    this.summaries = summaries;
  }

  private boolean useSummary(long activityId) {
    return summaries != null && summaries.useSummary(activityId);
  }

  public Dashboard ranking(String activityCode) {
    return ranking(activityCode, null, null);
  }

  public Dashboard ranking(String activityCode, String customerType, String regionCode) {
    return ranking(activityCode, customerType, regionCode, RankingMetric.AMOUNT);
  }

  public Dashboard ranking(String activityCode, String customerType, String regionCode, String metric) {
    return ranking(activityCode, customerType, regionCode, RankingMetric.from(metric));
  }

  private Dashboard ranking(String activityCode, String customerType, String regionCode, RankingMetric metric) {
    var activity = activities.byCode(activityCode);
    String normalizedCustomerType = normalizeRankingCustomerType(customerType);
    if (isHistorical(activity.status())) {
      return snapshot(rankingKey(metric, normalizedCustomerType, regionCode), activity.id(), Dashboard.class,
          () -> liveRanking(activity, normalizedCustomerType, regionCode, 0, metric));
    }
    return liveRanking(activity, normalizedCustomerType, regionCode, 0, metric);
  }

  static String normalizeRankingCustomerType(String customerType) {
    if (customerType == null) return null;
    String normalized = customerType.trim().toUpperCase(Locale.ROOT);
    return normalized.isEmpty() || "ALL".equals(normalized) ? null : normalized;
  }

  private Dashboard liveRanking(ActivityService.ActivityView activity, String customerType, String regionCode) {
    return liveRanking(activity, customerType, regionCode, 0, RankingMetric.AMOUNT);
  }

  private Dashboard liveRanking(ActivityService.ActivityView activity, String customerType, String regionCode, int minimumTopN) {
    return liveRanking(activity, customerType, regionCode, minimumTopN, RankingMetric.AMOUNT);
  }

  private Dashboard liveRanking(ActivityService.ActivityView activity, String customerType, String regionCode,
                                int minimumTopN, RankingMetric metric) {
    return liveRanking(activity, customerType, regionCode, minimumTopN, metric, null);
  }

  private Dashboard liveRanking(ActivityService.ActivityView activity, String customerType, String regionCode,
                                int minimumTopN, RankingMetric metric, List<ProductLineTotal> reportLines) {
    Map<String, Object> totals = orderTotals(activity.id(), customerType, regionCode);
    long skuCount = skuCount(activity.id(), customerType, regionCode);
    RankingRows ranks = rankingRows(activity, customerType, regionCode, minimumTopN, metric);
    totals.put("total_tons", ranks.totalTons());
    totals.put("dealer_count", totals.get("order_count"));
    totals.put("sku_count", skuCount);
    return new Dashboard(activity.id(), activity.name(), activity.status(), totals, ranks.companies(), ranks.branches(),
        reportLines == null ? productLines(activity.id(), customerType, regionCode) : reportLines,
        latestOrders(activity.id(), customerType, regionCode),
        dashboardVersion(activity.id()), Instant.now());
  }

  // Shared SQL primitives. Page readers compose only their own dependencies; the legacy
  // assembly above remains responsible for the existing admin API and stored snapshot format.
  Map<String, Object> orderTotals(long activityId, String customerType, String regionCode) {
    return new LinkedHashMap<>(jdbc.queryForMap("""
        SELECT COUNT(*) order_count, COALESCE(SUM(total_quantity), 0) total_quantity,
          COALESCE(SUM(total_amount), 0) total_amount,
          COUNT(DISTINCT branch_name_snapshot) branch_count
        FROM customer_order WHERE activity_id = ? AND status = 'SUBMITTED'
          AND (? IS NULL OR ? = '' OR customer_type = ?)
          AND (? IS NULL OR ? = '' OR region_code = ?)
        """, activityId, customerType, customerType, customerType, regionCode, regionCode, regionCode));
  }

  long skuCount(long activityId, String customerType, String regionCode) {
    Long skuCount = jdbc.queryForObject("""
        SELECT COUNT(DISTINCT i.activity_product_id)
        FROM order_item i JOIN customer_order o ON o.id = i.order_id
        WHERE o.activity_id = ? AND o.status = 'SUBMITTED'
          AND (? IS NULL OR ? = '' OR o.customer_type = ?)
          AND (? IS NULL OR ? = '' OR o.region_code = ?)
        """, Long.class, activityId, customerType, customerType, customerType, regionCode, regionCode, regionCode);
    return skuCount == null ? 0L : skuCount;
  }

  private RankingRows rankingRows(ActivityService.ActivityView activity, String customerType, String regionCode,
                                  int minimumTopN, RankingMetric metric) {
    return rankingRows(activity, customerType, regionCode, metric,
        Math.max(activity.companyRankingTopN(), minimumTopN), Math.max(activity.branchRankingTopN(), minimumTopN));
  }

  RankingRows rankingRows(ActivityService.ActivityView activity, String customerType, String regionCode,
                          RankingMetric metric, int companyLimit, int branchLimit) {
    boolean tons = metric == RankingMetric.TONS;
    // A grouped CTE is materialized once for both rankings, after selecting this activity's orders.
    // Preserve V036's distinction between missing weights and a genuinely calculated zero weight.
    String join = tons ? "JOIN" : "LEFT JOIN";
    String companyOrder = tons ? "t.tons DESC, o.total_amount DESC, o.last_submitted_at, o.id"
        : "o.total_amount DESC, o.last_submitted_at, o.id";
    String branchOrder = tons ? "tons DESC, amount DESC, name" : "amount DESC, name";
    String sql = """
        WITH scoped_orders AS (
          SELECT id, dealer_full_name_snapshot, branch_name_snapshot, total_amount, total_quantity, last_submitted_at
          FROM customer_order WHERE activity_id = ? AND status = 'SUBMITTED'
            AND (? IS NULL OR ? = '' OR customer_type = ?)
            AND (? IS NULL OR ? = '' OR region_code = ?)
        ), item_tons AS (
          %s
        ), company_ranks AS (
          SELECT ROW_NUMBER() OVER (ORDER BY %s) rank_no,
            o.dealer_full_name_snapshot name, o.branch_name_snapshot branch,
            o.total_amount amount, o.total_quantity quantity, t.tons
          FROM scoped_orders o %s item_tons t ON t.order_id = o.id %s
        ), branch_totals AS (
          SELECT o.branch_name_snapshot name, SUM(o.total_amount) amount, SUM(o.total_quantity) quantity, SUM(t.tons) tons
          FROM scoped_orders o %s item_tons t ON t.order_id = o.id
          GROUP BY o.branch_name_snapshot %s
        ), branch_ranks AS (
          SELECT ROW_NUMBER() OVER (ORDER BY %s) rank_no, name, amount, quantity, tons FROM branch_totals
        )
        SELECT 0 section, rank_no, name, branch, amount, quantity, tons FROM company_ranks WHERE rank_no <= ?
        UNION ALL
        SELECT 1 section, rank_no, name, NULL branch, amount, quantity, tons FROM branch_ranks WHERE rank_no <= ?
        UNION ALL
        SELECT 2 section, 0 rank_no, NULL name, NULL branch, NULL amount, NULL quantity, COALESCE(SUM(all_tons), 0) tons
        FROM item_tons
        ORDER BY section, rank_no
        """.formatted(DashboardSummaryStore.tonsSource(useSummary(activity.id()), tons), companyOrder, join, tons ? "WHERE t.tons IS NOT NULL" : "", join,
            tons ? "HAVING SUM(t.tons) IS NOT NULL" : "", branchOrder);
    List<RankRow> companies = new ArrayList<>();
    List<RankRow> branches = new ArrayList<>();
    BigDecimal[] totalTons = {BigDecimal.ZERO};
    jdbc.query(sql, rs -> {
      if (rs.getInt("section") == 2) {
        totalTons[0] = rs.getBigDecimal("tons");
        return;
      }
      var row = new RankRow(rs.getInt("rank_no"), rs.getString("name"), rs.getString("branch"),
          rs.getBigDecimal("amount"), rs.getLong("quantity"), rs.getBigDecimal("tons"));
      (rs.getInt("section") == 0 ? companies : branches).add(row);
    }, activity.id(), customerType, customerType, customerType, regionCode, regionCode, regionCode,
        companyLimit, branchLimit);
    return new RankingRows(companies, branches, totalTons[0]);
  }

  record RankingRows(List<RankRow> companies, List<RankRow> branches, BigDecimal totalTons) {}

  public Report report(String activityCode, String reportCode) {
    var activity = activities.byCode(activityCode);
    if (isHistorical(activity.status())) {
      Report frozen = snapshot("REPORT", activity.id(), Report.class, () -> liveReport(activity, "FINAL"));
      return new Report(reportCode, frozen.dashboard(), frozen.customerTypes(), frozen.regions(),
          frozen.generalProductLines(), frozen.specialProductLines(), frozen.giftCustomerTypes(),
          frozen.topGeneral(), frozen.topSpecial(), frozen.trend(), frozen.regionProductLines(), frozen.generalRegions());
    }
    return liveReport(activity, reportCode);
  }

  private Report liveReport(ActivityService.ActivityView activity, String reportCode) {
    ReportProductLines lines = reportProductLines(activity.id());
    Dashboard dashboard = liveRanking(activity, null, null, 15, RankingMetric.AMOUNT, lines.all());
    List<RegionTotal> regions = regions(activity.id());
    return new Report(reportCode, dashboard, customerTypes(activity.id()), regions,
        lines.general(), lines.special(), giftTypes(activity.id()),
        topCustomers(activity.id(), "GENERAL"), topCustomers(activity.id(), "SPECIAL"),
        trend(activity, dashboard.generatedAt()), lines.regions(),
        generalRegions(activity, regions, lines.regions(), lines.general()));
  }

  List<CustomerTypeTotal> customerTypes(long activityId) {
    return jdbc.query("""
        SELECT customer_type, COUNT(*) order_count, SUM(total_amount) amount, SUM(total_quantity) quantity
        FROM customer_order WHERE activity_id = ? AND status = 'SUBMITTED' GROUP BY customer_type ORDER BY customer_type
        """, (rs, rowNum) -> new CustomerTypeTotal(rs.getString(1), rs.getLong(2), rs.getBigDecimal(3), rs.getLong(4)), activityId);
  }

  List<TrendPoint> trend(ActivityService.ActivityView activity, Instant generatedAt) {
    Instant trendStart = activity.actualStartedAt() == null ? activity.startsAt() : activity.actualStartedAt();
    Instant trendEnd = activity.closedAt() == null ? generatedAt : activity.closedAt();
    if (trendEnd.isAfter(activity.endsAt())) trendEnd = activity.endsAt();
    return trendEnd.isBefore(trendStart) ? List.of() : jdbc.query("""
        SELECT CONCAT(DATE_FORMAT(last_submitted_at, '%Y-%m-%dT%H:00:00'), 'Z') bucket,
          SUM(total_amount) amount, COUNT(*) orders
        FROM customer_order
        WHERE activity_id = ? AND status = 'SUBMITTED'
          AND last_submitted_at >= ? AND last_submitted_at <= ?
        GROUP BY bucket ORDER BY bucket
        """, (rs, rowNum) -> new TrendPoint(rs.getString(1), rs.getBigDecimal(2), rs.getLong(3)),
        activity.id(), UtcTime.database(trendStart), UtcTime.database(trendEnd));
  }

  List<RegionTotal> regions(long activityId) {
    return jdbc.query("""
        SELECT COALESCE(region_code, 'UNASSIGNED'), SUM(total_amount), COUNT(*)
        FROM customer_order WHERE activity_id = ? AND status = 'SUBMITTED' AND customer_type = 'GENERAL'
        GROUP BY region_code ORDER BY SUM(total_amount) DESC
        """, (rs, rowNum) -> new RegionTotal(rs.getString(1), rs.getBigDecimal(2), rs.getLong(3)), activityId);
  }

  List<CustomerTypeTotal> giftTypes(long activityId) {
    return jdbc.query("""
        WITH scoped_orders AS (
          SELECT id,customer_type FROM customer_order WHERE activity_id = ? AND status = 'SUBMITTED'
        ), line_items AS (%s)
        SELECT o.customer_type, COUNT(DISTINCT o.id), SUM(i.line_amount), SUM(i.quantity)
        FROM line_items i JOIN scoped_orders o ON o.id = i.order_id
        WHERE i.is_gift_box = TRUE
        GROUP BY o.customer_type ORDER BY o.customer_type
        """.formatted(DashboardSummaryStore.lineSource(useSummary(activityId))),
        (rs, rowNum) -> new CustomerTypeTotal(rs.getString(1), rs.getLong(2), rs.getBigDecimal(3), rs.getLong(4)), activityId);
  }

  ReportProductLines reportProductLines(long activityId) {
    List<ProductLineTotal> all = new ArrayList<>();
    List<ProductLineTotal> general = new ArrayList<>();
    List<ProductLineTotal> special = new ArrayList<>();
    List<RegionProductLineTotal> regions = new ArrayList<>();
    // Collapse detail rows once; subsequent channel/region groupings only read this small grouped result.
    // Group on the original nullable keys before applying display labels, as the individual queries did.
    jdbc.query("""
        WITH scoped_orders AS (
          SELECT id,customer_type,region_code FROM customer_order WHERE activity_id = ? AND status = 'SUBMITTED'
        ), line_items AS (%s), product_totals AS (
          SELECT o.customer_type, o.region_code, i.product_line, SUM(i.line_amount) amount, SUM(i.quantity) quantity
          FROM line_items i JOIN scoped_orders o ON o.id = i.order_id
          GROUP BY o.customer_type, o.region_code, i.product_line
        )
        SELECT * FROM (
          SELECT 0 section, NULL region_code, NULL region_sort, product_line product_sort,
            COALESCE(product_line, '其他') product_line, SUM(amount) amount, SUM(quantity) quantity
          FROM product_totals GROUP BY product_line
          UNION ALL
          SELECT 1, NULL, NULL, product_line, COALESCE(product_line, '其他'), SUM(amount), SUM(quantity)
          FROM product_totals WHERE customer_type = 'GENERAL' GROUP BY product_line
          UNION ALL
          SELECT 2, NULL, NULL, product_line, COALESCE(product_line, '其他'), SUM(amount), SUM(quantity)
          FROM product_totals WHERE customer_type = 'SPECIAL' GROUP BY product_line
          UNION ALL
          SELECT 3, COALESCE(region_code, 'UNASSIGNED'), region_code, product_line,
            COALESCE(product_line, '其他'), SUM(amount), SUM(quantity)
          FROM product_totals WHERE customer_type = 'GENERAL' GROUP BY region_code, product_line
        ) report_lines
        ORDER BY section, region_sort, amount DESC, CASE WHEN section = 3 THEN product_sort END
        """.formatted(DashboardSummaryStore.lineSource(useSummary(activityId))), rs -> {
      int section = rs.getInt("section");
      if (section == 3) {
        regions.add(new RegionProductLineTotal(rs.getString("region_code"), rs.getString("product_line"),
            rs.getBigDecimal("amount"), rs.getLong("quantity")));
      } else {
        List<ProductLineTotal> target = section == 0 ? all : section == 1 ? general : special;
        target.add(new ProductLineTotal(rs.getString("product_line"), rs.getBigDecimal("amount"), rs.getLong("quantity")));
      }
    }, activityId);
    return new ReportProductLines(all, general, special, regions);
  }

  record ReportProductLines(List<ProductLineTotal> all, List<ProductLineTotal> general,
                                    List<ProductLineTotal> special, List<RegionProductLineTotal> regions) {}

  List<GeneralRegion> generalRegions(ActivityService.ActivityView activity, List<RegionTotal> totals,
                                              List<RegionProductLineTotal> regionLines,
                                              List<ProductLineTotal> generalProductLines) {
    Map<String, RegionTotal> totalsByCode = new LinkedHashMap<>();
    totals.forEach(total -> totalsByCode.put(total.regionCode(), total));
    Map<String, Map<String, RegionProductLineTotal>> linesByCode = new LinkedHashMap<>();
    for (var line : regionLines) {
      linesByCode.computeIfAbsent(line.regionCode(), ignored -> new LinkedHashMap<>()).put(line.productLine(), line);
    }
    List<ActivityService.RegionView> definitions = new ArrayList<>(activity.regions());
    Map<String, String> historicalNames = new LinkedHashMap<>();
    List<ActivityService.RegionView> dictionary = jdbc.query("""
        SELECT region_code, region_name FROM activity_region WHERE activity_id = ? ORDER BY id
        """, (rs, rowNum) -> new ActivityService.RegionView(rs.getString(1), rs.getString(2), rowNum), activity.id());
    dictionary.forEach(region -> historicalNames.putIfAbsent(region.code(), region.name()));
    for (String code : totalsByCode.keySet()) {
      if (definitions.stream().noneMatch(region -> region.code().equals(code))) {
        String name = "UNASSIGNED".equals(code) ? "未分大区" : historicalNames.getOrDefault(code, code);
        definitions.add(new ActivityService.RegionView(code, name, 10_000 + definitions.size()));
      }
    }
    if (activity.regions().isEmpty() && definitions.stream().allMatch(region -> "UNASSIGNED".equals(region.code()))) {
      return List.of();
    }
    return definitions.stream().map(region -> {
      RegionTotal total = totalsByCode.get(region.code());
      Map<String, RegionProductLineTotal> rows = linesByCode.getOrDefault(region.code(), Map.of());
      List<ProductLineTotal> productLines = generalProductLines.stream().map(line -> {
        RegionProductLineTotal value = rows.get(line.productLine());
        return value == null ? new ProductLineTotal(line.productLine(), BigDecimal.ZERO, 0)
            : new ProductLineTotal(value.productLine(), value.amount(), value.quantity());
      }).toList();
      return new GeneralRegion(region.code(), region.name(), region.sortNo(), total == null ? 0 : total.orderCount(),
          total == null ? BigDecimal.ZERO : total.amount(), productLines);
    }).toList();
  }

  @EventListener
  public void freezeFinalSnapshots(ActivityFinishedEvent event) {
    var activity = activities.byId(event.activityId());
    if (!"FINISHED".equals(activity.status())) return;
    replaceFinalSnapshots(activity);
  }

  /** Refreshes finished activity snapshots after an administrator changes an order. Archived results stay frozen. */
  public void refreshFinalSnapshots(long activityId) {
    var activity = activities.byId(activityId);
    if ("FINISHED".equals(activity.status())) replaceFinalSnapshots(activity);
  }

  private void replaceFinalSnapshots(ActivityService.ActivityView activity) {
    for (var metric : RankingMetric.values()) {
      replaceSnapshot(activity.id(), rankingKey(metric, null, null), liveRanking(activity, null, null, 0, metric));
      replaceSnapshot(activity.id(), rankingKey(metric, "GENERAL", null), liveRanking(activity, "GENERAL", null, 0, metric));
      replaceSnapshot(activity.id(), rankingKey(metric, "SPECIAL", null), liveRanking(activity, "SPECIAL", null, 0, metric));
      for (var region : activity.regions()) {
        replaceSnapshot(activity.id(), rankingKey(metric, "GENERAL", region.code()), liveRanking(activity, "GENERAL", region.code(), 0, metric));
      }
    }
    replaceSnapshot(activity.id(), "REPORT", liveReport(activity, "FINAL"));
  }

  private String rankingKey(RankingMetric metric, String customerType, String regionCode) {
    String suffix = (customerType == null ? "ALL" : customerType) + ":" + (regionCode == null ? "ALL" : regionCode);
    return metric == RankingMetric.AMOUNT ? "RANKING:" + suffix : "RANKING_TONS:" + suffix;
  }

  static boolean isHistorical(String status) {
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

  private void replaceSnapshot(long activityId, String key, Object value) {
    try {
      jdbc.update("""
          INSERT INTO activity_dashboard_snapshot(activity_id, snapshot_key, payload_json)
          VALUES (?, ?, CAST(? AS JSON))
          ON DUPLICATE KEY UPDATE payload_json = VALUES(payload_json), generated_at = UTC_TIMESTAMP(3)
          """, activityId, key, json.writeValueAsString(value));
    } catch (JsonProcessingException exception) {
      throw new IllegalStateException("最终看板快照更新失败", exception);
    }
  }

  List<RankRow> topCustomers(long activityId, String customerType) {
    return jdbc.query("""
        SELECT dealer_full_name_snapshot, branch_name_snapshot, total_amount, total_quantity, total_tons
        FROM customer_order WHERE activity_id = ? AND status = 'SUBMITTED' AND customer_type = ?
        ORDER BY total_amount DESC, last_submitted_at, id LIMIT 5
        """, (rs, rowNum) -> new RankRow(rowNum + 1, rs.getString(1), rs.getString(2), rs.getBigDecimal(3),
        rs.getLong(4), rs.getBigDecimal(5)), activityId, customerType);
  }

  private List<ProductLineTotal> productLines(long activityId, String customerType, String regionCode) {
    return jdbc.query("""
        WITH scoped_orders AS (
          SELECT id FROM customer_order WHERE activity_id = ? AND status = 'SUBMITTED'
            AND (? IS NULL OR ? = '' OR customer_type = ?)
            AND (? IS NULL OR ? = '' OR region_code = ?)
        ), line_items AS (%s)
        SELECT COALESCE(product_line, '其他') product_line, SUM(line_amount) amount, SUM(quantity) quantity
        FROM line_items
        GROUP BY product_line ORDER BY amount DESC
        """.formatted(DashboardSummaryStore.lineSource(useSummary(activityId))),
        (rs, rowNum) -> new ProductLineTotal(rs.getString(1), rs.getBigDecimal(2), rs.getLong(3)), activityId,
        customerType, customerType, customerType, regionCode, regionCode, regionCode);
  }

  private List<LatestOrder> latestOrders(long activityId, String customerType, String regionCode) {
    return jdbc.query("""
        SELECT order_no, dealer_full_name_snapshot, branch_name_snapshot, total_amount, last_submitted_at
        FROM customer_order WHERE activity_id = ? AND status = 'SUBMITTED'
          AND (? IS NULL OR ? = '' OR customer_type = ?)
          AND (? IS NULL OR ? = '' OR region_code = ?)
        ORDER BY last_submitted_at DESC LIMIT 20
        """, (rs, rowNum) -> new LatestOrder(rs.getString(1), rs.getString(2), rs.getString(3), rs.getBigDecimal(4), UtcTime.read(rs, 5)),
        activityId, customerType, customerType, customerType, regionCode, regionCode, regionCode);
  }

  String dashboardVersion(long activityId) {
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
  public record GeneralRegion(String regionCode, String regionName, int sortNo, long orderCount, BigDecimal amount,
                              List<ProductLineTotal> productLines) {
    public GeneralRegion {
      if ("UNASSIGNED".equals(regionCode)) regionName = "未分大区";
    }
  }
  public record Dashboard(long activityId, String activityName, String status, Map<String, Object> totals,
                          List<RankRow> companies, List<RankRow> branches, List<ProductLineTotal> productLines,
                          List<LatestOrder> latestOrders, String version, Instant generatedAt) {}
  public record Report(String reportCode, Dashboard dashboard, List<CustomerTypeTotal> customerTypes,
                       List<RegionTotal> regions, List<ProductLineTotal> generalProductLines,
                       List<ProductLineTotal> specialProductLines, List<CustomerTypeTotal> giftCustomerTypes,
                       List<RankRow> topGeneral, List<RankRow> topSpecial, List<TrendPoint> trend,
                       List<RegionProductLineTotal> regionProductLines, List<GeneralRegion> generalRegions) {}
}
