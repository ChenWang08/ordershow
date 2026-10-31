package com.fengyi.ordershow.dashboard;

import static com.fengyi.ordershow.dashboard.DashboardService.*;

import com.fengyi.ordershow.activity.ActivityService;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

/** Ranking owns its filter/sort lifecycle; the dashboard's Top15 stays on its existing reader. */
@Service
@Transactional(isolation = Isolation.REPEATABLE_READ)
public class RankingService {
  private final JdbcTemplate jdbc;
  private final ActivityService activities;
  private final RankingStore store;
  private final DashboardSummaryStore summaries;

  public RankingService(JdbcTemplate jdbc, ActivityService activities, RankingStore store, DashboardSummaryStore summaries) {
    this.jdbc = jdbc; this.activities = activities; this.store = store; this.summaries = summaries;
  }

  public RankingStore.Options options(String code) {
    return options(code, new RankingFilter(null, null, false, null, false, null, false, null));
  }

  public RankingStore.Options options(String code, RankingFilter filter) {
    var activity = activities.byCode(code);
    // Opening a screen reads option names only: no totals, ranking or snapshot rebuild.
    return store.options(activity.id(), isHistorical(activity.status()), filter);
  }

  // Numeric results and their version come from one SQL statement. READ_COMMITTED also
  // lets a first historical reader observe a snapshot built while it waited on the activity lock.
  @Transactional(isolation = Isolation.READ_COMMITTED)
  public Dashboard ranking(String code, RankingFilter filter) {
    var activity = activities.byCode(code);
    boolean history = isHistorical(activity.status());
    boolean tons = filter.metric() == RankingMetric.TONS;
    if (history) store.ensureSnapshot(activity.id());
    List<Object> args = new ArrayList<>();
    args.add(activity.id());
    String scope = "o.activity_id=?" + (history ? "" : " AND o.status='SUBMITTED'") + filter.customerScope("o", args);
    String scoped = "SELECT o.* FROM " + (history ? "activity_ranking_order_snapshot" : "customer_order") + " o WHERE " + scope;
    String ctes;
    if (filter.filtersProducts()) {
      String source;
      if (history) {
        source = "SELECT i.order_id,i.product_line,i.variety_name,i.amount,i.quantity,i.all_tons,i.eligible_tons "
            + "FROM activity_ranking_product_snapshot i JOIN scoped_orders o ON o.activity_id=i.activity_id AND o.id=i.order_id";
      } else source = RankingStore.productSource();
      String where = "1=1";
      if (filter.productLineUnassigned()) where += " AND product_line IS NULL";
      else if (filter.productLine() != null) { where += " AND product_line=?"; args.add(filter.productLine()); }
      if (!filter.varieties().isEmpty() || filter.includeUnspecifiedVariety()) {
        List<String> alternatives = new ArrayList<>();
        if (!filter.varieties().isEmpty()) {
          alternatives.add("variety_name IN (" + String.join(",", java.util.Collections.nCopies(filter.varieties().size(), "?")) + ")");
          args.addAll(filter.varieties());
        }
        if (filter.includeUnspecifiedVariety()) alternatives.add("variety_name IS NULL");
        where += " AND (" + String.join(" OR ", alternatives) + ")";
      }
      ctes = "line_values AS (" + source + "), matched_items AS (SELECT order_id,SUM(amount) amount,SUM(quantity) quantity,"
          + "SUM(all_tons) all_tons," + (tons ? "SUM(eligible_tons)" : "COALESCE(SUM(all_tons),0)") + " tons FROM line_values WHERE " + where + " GROUP BY order_id),"
          + "matched AS (SELECT o.id,o.dealer_full_name_snapshot name,o.branch_name_snapshot branch,o.last_submitted_at,"
          + "i.amount,i.quantity,i.all_tons,i.tons FROM scoped_orders o JOIN matched_items i ON i.order_id=o.id)";
    } else if (history) {
      ctes = "matched AS (SELECT id,dealer_full_name_snapshot name,branch_name_snapshot branch,last_submitted_at,"
          + "total_amount amount,total_quantity quantity,all_tons," + (tons ? "eligible_tons" : "COALESCE(all_tons,0)") + " tons FROM scoped_orders)";
    } else {
      ctes = "item_tons AS (" + DashboardSummaryStore.tonsSource(summaries.useSummary(activity.id()), tons) + "),"
          + "matched AS (SELECT o.id,o.dealer_full_name_snapshot name,o.branch_name_snapshot branch,o.last_submitted_at,"
          + "o.total_amount amount,o.total_quantity quantity,t.all_tons,t.tons FROM scoped_orders o LEFT JOIN item_tons t ON t.order_id=o.id)";
    }
    String companySort = (tons ? "tons DESC," : "") + "amount DESC,last_submitted_at,id";
    String branchSort = (tons ? "tons DESC," : "") + "amount DESC,name";
    String metadata = history ? "SELECT data_version version,generated_at FROM activity_ranking_snapshot WHERE activity_id=?"
        : "SELECT COALESCE(MAX(id),0) version,UTC_TIMESTAMP(3) generated_at FROM domain_event_outbox WHERE activity_id=?";
    String sql = "WITH scoped_orders AS (" + scoped + ")," + ctes + ", metadata AS (" + metadata + ")" + """
        , eligible AS (SELECT * FROM matched %s), company_ranks AS (
          SELECT ROW_NUMBER() OVER(ORDER BY %s) rank_no,name,branch,amount,quantity,tons FROM eligible
        ), branch_totals AS (
          SELECT branch name,SUM(amount) amount,SUM(quantity) quantity,SUM(tons) tons FROM matched GROUP BY branch %s
        ), branch_ranks AS (
          SELECT ROW_NUMBER() OVER(ORDER BY %s) rank_no,name,amount,quantity,tons FROM branch_totals
        )
        , sections AS (
        SELECT 0 section,rank_no,name,branch,amount,quantity,tons,0 order_count,0 branch_count FROM company_ranks WHERE rank_no<=?
        UNION ALL
        SELECT 1,rank_no,name,NULL,amount,quantity,tons,0,0 FROM branch_ranks WHERE rank_no<=?
        UNION ALL
        SELECT 2,0,NULL,NULL,COALESCE(SUM(amount),0),COALESCE(SUM(quantity),0),COALESCE(SUM(all_tons),0),
          COUNT(*),COUNT(DISTINCT branch) FROM matched
        ) SELECT r.*,m.version,m.generated_at FROM sections r CROSS JOIN metadata m ORDER BY r.section,r.rank_no
        """.formatted(tons ? "WHERE tons IS NOT NULL" : "", companySort, tons ? "HAVING SUM(tons) IS NOT NULL" : "", branchSort);
    args.add(activity.id()); args.add(activity.companyRankingTopN()); args.add(activity.branchRankingTopN());
    var companies = new ArrayList<RankRow>();
    var branches = new ArrayList<RankRow>();
    Map<String, Object> totals = new LinkedHashMap<>();
    long[] version = {0};
    Instant[] generated = {Instant.now()};
    jdbc.query(sql, (org.springframework.jdbc.core.RowCallbackHandler) rs -> {
      if (rs.getInt("section") == 2) {
        version[0] = rs.getLong("version");
        generated[0] = com.fengyi.ordershow.common.UtcTime.read(rs, "generated_at");
        totals.put("order_count", rs.getLong("order_count")); totals.put("dealer_count", rs.getLong("order_count"));
        totals.put("branch_count", rs.getLong("branch_count")); totals.put("total_amount", rs.getBigDecimal("amount"));
        totals.put("total_quantity", rs.getLong("quantity")); totals.put("total_tons", rs.getBigDecimal("tons"));
      } else {
        var row = new RankRow(rs.getInt("rank_no"), rs.getString("name"), rs.getString("branch"),
            rs.getBigDecimal("amount"), rs.getLong("quantity"), rs.getBigDecimal("tons"));
        (rs.getInt("section") == 0 ? companies : branches).add(row);
      }
    }, args.toArray());
    return new Dashboard(activity.id(), activity.name(), activity.status(), totals, companies, branches,
        List.of(), List.of(), Long.toString(version[0]), generated[0]);
  }
}
