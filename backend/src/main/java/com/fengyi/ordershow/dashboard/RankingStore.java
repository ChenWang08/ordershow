package com.fengyi.ordershow.dashboard;

import static com.fengyi.ordershow.dashboard.DashboardService.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fengyi.ordershow.common.DomainException;
import java.math.BigDecimal;
import java.util.List;
import java.util.ArrayList;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** Shared storage only: this model never invokes another page's statistics reader. */
@Repository
public class RankingStore {
  private final JdbcTemplate jdbc;
  private final ObjectMapper json;

  public RankingStore(JdbcTemplate jdbc, ObjectMapper json) { this.jdbc = jdbc; this.json = json; }

  public Options options(long activityId, boolean historical) {
    return options(activityId, historical, new RankingFilter(null, null, false, null, false, null, false, null));
  }

  public Options options(long activityId, boolean historical, RankingFilter filter) {
    if (historical) {
      var frozen = jdbc.queryForList("SELECT CAST(options_json AS CHAR) FROM activity_ranking_snapshot WHERE activity_id=?",
          String.class, activityId);
      if (!frozen.isEmpty()) {
        try {
          var saved = json.readValue(frozen.getFirst(), FrozenOptions.class);
          if (saved.scopes() == null) {
            if (filter.customerType() != null || filter.regionCode() != null || filter.regionUnassigned())
              throw DomainException.conflict("RANKING_OPTIONS_SCOPE_UNAVAILABLE", "旧历史活动缺少联动资料，请使用全部客户、全部大区查看");
            return new Options(saved.customers(), saved.products());
          }
          return new Options(saved.customers(), productChoices(saved.scopes().stream().filter(scope ->
              (filter.customerType() == null || filter.customerType().equals(scope.customerType()))
              && (!filter.regionUnassigned() || scope.regionCode() == null)
              && (filter.regionCode() == null || filter.regionCode().equals(scope.regionCode()))).toList()));
        }
        catch (DomainException e) { throw e; }
        catch (Exception e) { throw new IllegalStateException("历史筛选选项读取失败", e); }
      }
    }
    return new Options(customerOptions(activityId), productChoices(productScopes(activityId, filter)));
  }

  private List<CustomerOption> customerOptions(long activityId) {
    return jdbc.query("""
        WITH customer_values AS (
          SELECT c.customer_type,NULLIF(TRIM(c.region_code),'') region_code FROM activity_customer c
          JOIN activity_data_binding b ON b.activity_id=c.activity_id AND b.data_type='WHITELIST'
            AND b.current_version_id=c.data_version_id WHERE c.activity_id=? AND c.is_active=TRUE
          UNION
          SELECT customer_type,NULLIF(TRIM(region_code),'') FROM customer_order WHERE activity_id=? AND status='SUBMITTED'
        )
        SELECT v.customer_type,v.region_code,COALESCE(r.region_name,v.region_code,'未填写') region_name
        FROM customer_values v LEFT JOIN activity_region r ON r.activity_id=? AND r.region_code=v.region_code
        ORDER BY v.customer_type,region_name
        """, (rs, n) -> new CustomerOption(rs.getString(1), rs.getString(2), rs.getString(3)), activityId, activityId, activityId);
  }

  private List<ProductScope> productScopes(long activityId, RankingFilter filter) {
    var args = new ArrayList<Object>();
    args.add(activityId);
    String customers = filter.customerScope("c", args);
    args.add(activityId);
    String orders = filter.customerScope("o", args);
    args.add(activityId);
    // Catalog-only names require at least one applicable, published customer in the selected scope.
    // Existing effective orders remain selectable even after whitelist/catalog edits.
    String sql = """
        WITH scoped_customers AS (
          SELECT c.* FROM activity_customer c
          JOIN activity_data_binding b ON b.activity_id=c.activity_id AND b.data_type='WHITELIST'
            AND b.current_version_id=c.data_version_id WHERE c.activity_id=? AND c.is_active=TRUE
        """ + customers + """
        ), scoped_orders AS (
          SELECT o.id,o.customer_type,NULLIF(TRIM(o.region_code),'') region_code FROM customer_order o
          WHERE o.activity_id=? AND o.status='SUBMITTED'
        """ + orders + """
        ), customer_scopes AS (
          SELECT DISTINCT customer_type,NULLIF(TRIM(region_code),'') region_code FROM scoped_customers
        )
        SELECT DISTINCT o.customer_type,o.region_code,NULLIF(TRIM(i.product_line),'') product_line,
          NULLIF(TRIM(i.variety_name),'') variety_name
        FROM scoped_orders o STRAIGHT_JOIN order_item i ON i.order_id=o.id
        UNION
        SELECT DISTINCT scope.customer_type,scope.region_code,NULLIF(TRIM(p.product_line),''),NULLIF(TRIM(p.variety_name),'')
        FROM activity_product p
        JOIN activity_data_binding b ON b.activity_id=p.activity_id AND b.data_type='PRODUCT'
          AND b.current_version_id=p.data_version_id
        JOIN customer_scopes scope ON p.customer_type='ALL' OR p.customer_type=scope.customer_type
        WHERE p.activity_id=?
          AND (SELECT 1 FROM scoped_customers c
            WHERE c.customer_type <=> scope.customer_type
              AND NULLIF(TRIM(c.region_code),'') <=> scope.region_code
              AND (NOT EXISTS (SELECT 1 FROM activity_product_branch_scope s WHERE s.activity_product_id=p.id)
                OR EXISTS (SELECT 1 FROM activity_product_branch_scope s WHERE s.activity_product_id=p.id
                  AND s.normalized_branch_name=COALESCE(c.normalized_branch_name,'')))
              AND (NOT EXISTS (SELECT 1 FROM activity_product_dealer_scope s WHERE s.activity_product_id=p.id
                  AND s.normalized_branch_name=c.normalized_branch_name)
                OR EXISTS (SELECT 1 FROM activity_product_dealer_member m WHERE m.activity_product_id=p.id
                  AND m.normalized_branch_name=c.normalized_branch_name AND m.customer_id=c.customer_id
                  AND m.customer_type=c.customer_type AND m.normalized_dealer_full_name=c.normalized_dealer_full_name))
            LIMIT 1) IS NOT NULL
        ORDER BY 1,2,3,4
        """;
    return jdbc.query(sql, (rs, n) -> new ProductScope(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4)), args.toArray());
  }

  private List<ProductOption> productChoices(List<ProductScope> scopes) {
    return scopes.stream().map(scope -> new ProductOption(scope.productLine(), scope.varietyName())).distinct().toList();
  }

  /** Only requested live product rankings visit details; no extra read model is written on submission. */
  static String productSource() {
    // MySQL otherwise may scan every activity's items before applying the customer scope.
    return "SELECT i.order_id,NULLIF(TRIM(i.product_line),'') product_line,NULLIF(TRIM(i.variety_name),'') variety_name,"
        + "i.line_amount amount,i.quantity,i.line_tons all_tons,"
        + "CASE WHEN i.ton_case_factor IS NOT NULL OR i.line_tons>0 THEN i.line_tons END eligible_tons "
        + "FROM scoped_orders o STRAIGHT_JOIN order_item i ON i.order_id=o.id";
  }

  public boolean hasSnapshot(long activityId) {
    return Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM activity_ranking_snapshot WHERE activity_id=?)",
        Boolean.class, activityId));
  }

  /** Called within the activity/order writer's transaction. Archived datasets are never replaced. */
  public void capture(long activityId) {
    String status = jdbc.queryForObject("SELECT status FROM activity WHERE id=? FOR UPDATE", String.class, activityId);
    if ("ARCHIVED".equals(status) && hasSnapshot(activityId)) return;
    var scopes = productScopes(activityId, new RankingFilter(null, null, false, null, false, null, false, null));
    var options = new FrozenOptions(customerOptions(activityId), productChoices(scopes), scopes);
    jdbc.update("DELETE FROM activity_ranking_snapshot WHERE activity_id=?", activityId);
    try {
      jdbc.update("""
          INSERT INTO activity_ranking_snapshot(activity_id,options_json,data_version)
          SELECT ?,CAST(? AS JSON),COALESCE(MAX(id),0) FROM domain_event_outbox WHERE activity_id=?
          """, activityId, json.writeValueAsString(options), activityId);
    } catch (Exception e) { throw new IllegalStateException("历史筛选选项保存失败", e); }
    jdbc.update("""
        INSERT INTO activity_ranking_product_snapshot(activity_id,order_id,product_line,variety_name,amount,quantity,all_tons,eligible_tons)
        SELECT o.activity_id,i.order_id,NULLIF(TRIM(i.product_line),''),NULLIF(TRIM(i.variety_name),''),
          SUM(i.line_amount),SUM(i.quantity),SUM(i.line_tons),
          SUM(CASE WHEN i.ton_case_factor IS NOT NULL OR i.line_tons>0 THEN i.line_tons END)
        FROM customer_order o JOIN order_item i ON i.order_id=o.id WHERE o.activity_id=? AND o.status='SUBMITTED'
        GROUP BY o.activity_id,i.order_id,NULLIF(TRIM(i.product_line),''),NULLIF(TRIM(i.variety_name),'')
        """, activityId);
    jdbc.update("""
        INSERT INTO activity_ranking_order_snapshot(activity_id,id,customer_type,region_code,dealer_full_name_snapshot,
          branch_name_snapshot,total_amount,total_quantity,last_submitted_at,all_tons,eligible_tons)
        SELECT o.activity_id,o.id,o.customer_type,NULLIF(TRIM(o.region_code),''),o.dealer_full_name_snapshot,
          o.branch_name_snapshot,o.total_amount,o.total_quantity,o.last_submitted_at,t.all_tons,t.eligible_tons
        FROM customer_order o LEFT JOIN (
          SELECT order_id,SUM(all_tons) all_tons,SUM(eligible_tons) eligible_tons
          FROM activity_ranking_product_snapshot WHERE activity_id=? GROUP BY order_id
        ) t ON t.order_id=o.id WHERE o.activity_id=? AND o.status='SUBMITTED'
        """, activityId, activityId);
  }

  /** Old history can only be materialized when the retained orders reconcile with its frozen totals. */
  public void ensureSnapshot(long activityId) {
    if (hasSnapshot(activityId)) return;
    jdbc.queryForList("SELECT id FROM activity WHERE id=? FOR UPDATE", Long.class, activityId);
    if (hasSnapshot(activityId)) return;
    var old = jdbc.queryForList("""
        SELECT CAST(payload_json AS CHAR) FROM activity_dashboard_snapshot
        WHERE activity_id=? AND snapshot_key='RANKING:ALL:ALL'
        """, String.class, activityId);
    if (!old.isEmpty()) {
      try {
        var totals = json.readTree(old.getFirst()).path("totals");
        var current = jdbc.queryForMap("""
            SELECT COUNT(*) order_count,COALESCE(SUM(total_amount),0) total_amount,COALESCE(SUM(total_quantity),0) total_quantity
            FROM customer_order WHERE activity_id=? AND status='SUBMITTED'
            """, activityId);
        for (String key : List.of("order_count", "total_amount", "total_quantity")) {
          if (!totals.has(key) || totals.get(key).decimalValue().compareTo(new BigDecimal(current.get(key).toString())) != 0)
            throw DomainException.conflict("RANKING_HISTORY_MISMATCH", "历史订单与原冻结结果不一致，需核对后启用组合筛选");
        }
        BigDecimal tons = jdbc.queryForObject("""
            SELECT COALESCE(SUM(i.line_tons),0) FROM customer_order o JOIN order_item i ON i.order_id=o.id
            WHERE o.activity_id=? AND o.status='SUBMITTED'
            """, BigDecimal.class, activityId);
        if (totals.has("total_tons") && !totals.get("total_tons").isNull() && totals.get("total_tons").decimalValue().compareTo(tons) != 0)
          throw DomainException.conflict("RANKING_HISTORY_MISMATCH", "历史吨数与原冻结结果不一致，需核对后启用组合筛选");
      } catch (com.fasterxml.jackson.core.JsonProcessingException e) { throw new IllegalStateException("历史结果读取失败", e); }
    }
    try { reconcileStoredRanks(activityId); }
    catch (com.fasterxml.jackson.core.JsonProcessingException e) { throw new IllegalStateException("历史结果读取失败", e); }
    capture(activityId);
  }

  private void reconcileStoredRanks(long activityId) throws com.fasterxml.jackson.core.JsonProcessingException {
    // Aggregate totals alone cannot detect a transfer between customers. Also check every retained
    // legacy ranking, using its stored length rather than today's possibly changed TopN setting.
    var activity = json.readValue("{\"id\":" + activityId + "}", com.fengyi.ordershow.activity.ActivityService.ActivityView.class);
    var legacy = new DashboardService(jdbc, null, json);
    for (var row : jdbc.queryForList("SELECT snapshot_key,CAST(payload_json AS CHAR) payload FROM activity_dashboard_snapshot WHERE activity_id=? AND snapshot_key LIKE 'RANKING%:%'",activityId)) {
      String key = row.get("snapshot_key").toString();
      String[] parts = key.split(":",3);
      if (parts.length != 3 || !(parts[0].equals("RANKING") || parts[0].equals("RANKING_TONS"))) continue;
      var retained = json.readTree(row.get("payload").toString());
      var ranks = legacy.rankingRows(activity,parts[1].equals("ALL") ? null : parts[1],parts[2].equals("ALL") ? null : parts[2],
          parts[0].equals("RANKING_TONS") ? RankingMetric.TONS : RankingMetric.AMOUNT,
          retained.path("companies").size(),retained.path("branches").size());
      compareRows(retained.path("companies"),json.valueToTree(ranks.companies()));
      compareRows(retained.path("branches"),json.valueToTree(ranks.branches()));
    }
  }

  private void compareRows(com.fasterxml.jackson.databind.JsonNode expected, com.fasterxml.jackson.databind.JsonNode actual) {
    if (expected.size()!=actual.size()) historyMismatch();
    for(int i=0;i<expected.size();i++) {
      for(String key:List.of("rank","name","branch","amount","quantity","tons")) {
        var a=expected.get(i).path(key); var b=actual.get(i).path(key);
        if(a.isNumber() && b.isNumber() ? a.decimalValue().compareTo(b.decimalValue())!=0 : !a.equals(b)) historyMismatch();
      }
    }
  }
  private void historyMismatch() {
    throw DomainException.conflict("RANKING_HISTORY_MISMATCH", "历史排行与原冻结结果不一致，需核对后启用组合筛选");
  }

  @JsonInclude(JsonInclude.Include.ALWAYS)
  public record CustomerOption(String customerType, String regionCode, String regionName) {}
  @JsonInclude(JsonInclude.Include.ALWAYS)
  public record ProductOption(String productLine, String varietyName) {}
  public record Options(List<CustomerOption> customers, List<ProductOption> products) {}
  public record ProductScope(String customerType, String regionCode, String productLine, String varietyName) {}
  public record FrozenOptions(List<CustomerOption> customers, List<ProductOption> products, List<ProductScope> scopes) {}
}
