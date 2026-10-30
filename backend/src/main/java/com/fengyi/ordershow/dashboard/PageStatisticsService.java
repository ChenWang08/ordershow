package com.fengyi.ordershow.dashboard;

import static com.fengyi.ordershow.dashboard.DashboardService.*;

import com.fengyi.ordershow.activity.ActivityService;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

/** Page-specific reads. The legacy service owns the unchanged historical snapshot format.
 * Each HTTP read uses one committed database view, including overview whitelist counts.
 */
@Service
@Transactional(isolation = Isolation.REPEATABLE_READ)
public class PageStatisticsService {
  private final JdbcTemplate jdbc;
  private final ActivityService activities;
  private final DashboardService queries;
  private final DashboardSummaryStore summaries;

  public PageStatisticsService(JdbcTemplate jdbc, ActivityService activities,
                               DashboardService queries, DashboardSummaryStore summaries) {
    this.jdbc = jdbc; this.activities = activities; this.queries = queries; this.summaries = summaries;
  }

  public Overview overview(long activityId) {
    var activity = activities.byId(activityId);
    Map<String, Object> totals;
    Map<String, Long> submitted = new LinkedHashMap<>();
    if (isHistorical(activity.status())) {
      // Match the previous overview's three frozen ranking totals, including old snapshots.
      totals = queries.ranking(activity.code(), null, null).totals();
      for (String type : List.of("GENERAL", "SPECIAL")) {
        var frozen = queries.ranking(activity.code(), type, null).totals();
        submitted.put(type, ((Number) frozen.get("order_count")).longValue());
      }
    } else {
      totals = new LinkedHashMap<>();
      long[] count = {0}, quantity = {0};
      BigDecimal[] amount = {BigDecimal.ZERO};
      jdbc.query("""
          SELECT customer_type, COUNT(*) order_count, COALESCE(SUM(total_quantity),0) quantity,
            COALESCE(SUM(total_amount),0) amount
          FROM customer_order WHERE activity_id=? AND status='SUBMITTED'
          GROUP BY customer_type
          """, (org.springframework.jdbc.core.RowCallbackHandler) rs -> {
        long n = rs.getLong("order_count");
        submitted.put(rs.getString("customer_type"), n);
        count[0] += n; quantity[0] += rs.getLong("quantity"); amount[0] = amount[0].add(rs.getBigDecimal("amount"));
      }, activityId);
      totals.put("order_count", count[0]); totals.put("total_quantity", quantity[0]);
      totals.put("total_amount", amount[0]); totals.put("total_tons", totalTons(activityId));
    }
    Map<String, Long> customers = new LinkedHashMap<>();
    jdbc.query("""
        SELECT c.customer_type, COUNT(*) total FROM activity_customer c
        JOIN activity_data_binding b ON b.activity_id=c.activity_id AND b.data_type='WHITELIST'
          AND b.current_version_id=c.data_version_id
        WHERE c.activity_id=? AND c.is_active=TRUE GROUP BY c.customer_type
        """, (org.springframework.jdbc.core.RowCallbackHandler) rs -> customers.put(rs.getString(1), rs.getLong(2)), activityId);
    return new Overview(selectTotals(totals, "order_count", "total_amount", "total_quantity", "total_tons"),
        submitted, customers.values().stream().mapToLong(Long::longValue).sum(), customers,
        customers.containsKey("ALL") ? "UNSPECIFIED" : "TYPED", Instant.now());
  }

  public Dashboard ranking(String code, String customerType, String regionCode, String metricValue) {
    var activity = activities.byCode(code);
    var metric = RankingMetric.from(metricValue);
    String type = normalizeRankingCustomerType(customerType);
    if (isHistorical(activity.status())) return rankingProjection(queries.ranking(code, type, regionCode, metric.name()));
    var ranks = queries.rankingRows(activity, type, regionCode, metric,
        activity.companyRankingTopN(), activity.branchRankingTopN());
    var totals = queries.orderTotals(activity.id(), type, regionCode);
    totals.put("total_tons", ranks.totalTons());
    totals.put("dealer_count", totals.get("order_count"));
    return rankingProjection(new Dashboard(activity.id(), activity.name(), activity.status(), totals,
        ranks.companies(), ranks.branches(), List.of(), List.of(), queries.dashboardVersion(activity.id()), Instant.now()));
  }

  public Report dashboard(String code) {
    var activity = activities.byCode(code);
    if (isHistorical(activity.status())) return dashboardProjection(queries.report(code, "ORDER_DASHBOARD"));
    var lines = queries.reportProductLines(activity.id());
    var ranks = queries.rankingRows(activity, null, null, RankingMetric.AMOUNT, 15, 15);
    var totals = queries.orderTotals(activity.id(), null, null);
    totals.put("total_tons", ranks.totalTons());
    totals.put("dealer_count", totals.get("order_count"));
    totals.put("sku_count", queries.skuCount(activity.id(), null, null));
    var data = new Dashboard(activity.id(), activity.name(), activity.status(), totals, ranks.companies(), ranks.branches(),
        lines.all(), List.of(), queries.dashboardVersion(activity.id()), Instant.now());
    var regions = queries.regions(activity.id());
    return new Report("ORDER_DASHBOARD", data, queries.customerTypes(activity.id()), regions, lines.general(), lines.special(),
        List.of(), List.of(), List.of(), queries.trend(activity, data.generatedAt()), lines.regions(),
        queries.generalRegions(activity, regions, lines.regions(), lines.general()));
  }

  public Report reports(String code, String reportCode) {
    var activity = activities.byCode(code);
    if (isHistorical(activity.status())) return reportProjection(queries.report(code, reportCode));
    // All nine topics are loaded together: changing the selected report stays a local UI operation.
    var lines = queries.reportProductLines(activity.id());
    var amount = jdbc.queryForObject("""
        SELECT COALESCE(SUM(total_amount),0) FROM customer_order WHERE activity_id=? AND status='SUBMITTED'
        """, BigDecimal.class, activity.id());
    var data = new Dashboard(activity.id(), activity.name(), activity.status(), Map.of("total_amount", amount),
        List.of(), List.of(), lines.all(), List.of(), queries.dashboardVersion(activity.id()), Instant.now());
    var regions = queries.regions(activity.id());
    return new Report(reportCode, data, queries.customerTypes(activity.id()), regions, lines.general(), lines.special(),
        queries.giftTypes(activity.id()), queries.topCustomers(activity.id(), "GENERAL"), queries.topCustomers(activity.id(), "SPECIAL"),
        List.of(), lines.regions(), queries.generalRegions(activity, regions, lines.regions(), lines.general()));
  }

  private BigDecimal totalTons(long activityId) {
    return jdbc.queryForObject("""
        WITH scoped_orders AS (
          SELECT id FROM customer_order WHERE activity_id=? AND status='SUBMITTED'
        ), item_tons AS (%s)
        SELECT COALESCE(SUM(all_tons),0) FROM item_tons
        """.formatted(DashboardSummaryStore.tonsSource(summaries.useSummary(activityId), false)), BigDecimal.class, activityId);
  }

  // Keep the existing JSON envelopes and list fields. Unused compatibility lists are empty;
  // page-used fields are projected identically from live results and stored historical results.
  static Dashboard rankingProjection(Dashboard source) {
    return new Dashboard(source.activityId(), source.activityName(), source.status(),
        selectTotals(source.totals(), "order_count", "dealer_count", "total_quantity", "branch_count", "total_amount", "total_tons"),
        source.companies(), source.branches(), List.of(), List.of(), source.version(), source.generatedAt());
  }

  static Report dashboardProjection(Report source) {
    var d = source.dashboard();
    var data = new Dashboard(d.activityId(), d.activityName(), d.status(), d.totals(),
        d.companies().stream().limit(15).toList(), d.branches().stream().limit(15).toList(), d.productLines(),
        List.of(), d.version(), d.generatedAt());
    return new Report("ORDER_DASHBOARD", data, source.customerTypes(), source.regions(), source.generalProductLines(),
        source.specialProductLines(), List.of(), List.of(), List.of(), source.trend(), source.regionProductLines(), source.generalRegions());
  }

  static Report reportProjection(Report source) {
    var d = source.dashboard();
    var data = new Dashboard(d.activityId(), d.activityName(), d.status(), selectTotals(d.totals(), "total_amount"),
        List.of(), List.of(), d.productLines(), List.of(), d.version(), d.generatedAt());
    return new Report(source.reportCode(), data, source.customerTypes(), source.regions(), source.generalProductLines(),
        source.specialProductLines(), source.giftCustomerTypes(), source.topGeneral(), source.topSpecial(), List.of(),
        source.regionProductLines(), source.generalRegions());
  }

  private static Map<String, Object> selectTotals(Map<String, Object> source, String... keys) {
    Map<String, Object> selected = new LinkedHashMap<>();
    for (String key : keys) if (source.containsKey(key)) selected.put(key, source.get(key));
    return selected;
  }

  public record Overview(Map<String, Object> totals, Map<String, Long> submittedByType, long customerCount,
                         Map<String, Long> customersByType, String customerTypeMode, Instant generatedAt) {}
}
