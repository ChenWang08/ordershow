package com.fengyi.ordershow.dashboard;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengyi.ordershow.activity.ActivityService;
import java.util.ArrayList;
import java.util.List;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

/** Fixed isolated copy only; never reads the live DB directly. Names and payloads are not printed. */
@EnabledIfEnvironmentVariable(named="ORDER_SHOW_SUMMARY_COPY",matches="order-show-e2e")
class DashboardSummaryCopyTest {
  @Test void existingLocalDataMatchesBeforeAndAfterBackfill() throws Exception {
    var source=new DriverManagerDataSource("jdbc:mysql://host.docker.internal:33306/order_show_summary_copy?allowPublicKeyRetrieval=true&useSSL=false&serverTimezone=UTC",
        "root","e2e_root_only_not_for_business");
    var jdbc=new JdbcTemplate(source);
    var json=new ObjectMapper().findAndRegisterModules();
    var snapshots=jdbc.queryForList("SELECT activity_id,snapshot_key,CAST(payload_json AS CHAR) payload FROM activity_dashboard_snapshot ORDER BY activity_id,snapshot_key");
    var originalChecksums=jdbc.queryForList("CHECKSUM TABLE customer_order,order_item,activity,activity_region,domain_event_outbox");
    Flyway.configure().dataSource(source).locations("classpath:db/migration").baselineOnMigrate(true).baselineVersion("39").target("40").load().migrate();
    // Make reruns exercise missing-summary fallback as well as the rebuilt path.
    // Only disposable derived rows in this fixed isolated copy are removed.
    jdbc.update("DELETE FROM order_dashboard_product_line_stat");
    jdbc.update("DELETE FROM order_dashboard_stat");
    var maintenance=new DashboardSummaryMaintenance(jdbc,new DataSourceTransactionManager(source));
    int comparisons=0;
    var rows=jdbc.queryForList("SELECT * FROM activity ORDER BY id");
    for(var row:rows) {
      long id=((Number)row.get("id")).longValue();
      var node=json.createObjectNode().put("id",id).put("code","copy").put("name","copy").put("status","ACTIVE")
          .put("companyRankingTopN",((Number)row.get("company_ranking_top_n")).intValue())
          .put("branchRankingTopN",((Number)row.get("branch_ranking_top_n")).intValue())
          .put("startsAt",instant(row.get("starts_at"))).put("endsAt",instant(row.get("ends_at"))).put("timezone","Asia/Shanghai");
      if(row.get("actual_started_at")!=null)node.put("actualStartedAt",instant(row.get("actual_started_at")));
      if(row.get("closed_at")!=null)node.put("closedAt",instant(row.get("closed_at")));
      var regionRows=jdbc.queryForList("SELECT region_code,region_name,sort_no FROM activity_region WHERE activity_id=? ORDER BY id",id);
      var regions=node.putArray("regions");
      for(var region:regionRows) regions.addObject().put("code",(String)region.get("region_code"))
          .put("name",(String)region.get("region_name")).put("sortNo",((Number)region.get("sort_no")).intValue());
      var activity=json.treeToValue(node,ActivityService.ActivityView.class);
      var activities=mock(ActivityService.class);when(activities.byCode("copy")).thenReturn(activity);
      var old=new DashboardBeforeSummaryReference(jdbc,activities,json);
      var candidate=new DashboardService(jdbc,activities,json,new DashboardSummaryStore(jdbc,true,""));
      for(int phase=0;phase<2;phase++) {
        List<String[]> filters=new ArrayList<>(); filters.add(new String[]{null,null});filters.add(new String[]{"GENERAL",null});filters.add(new String[]{"SPECIAL",null});
        for(var region:regionRows) filters.add(new String[]{"GENERAL",(String)region.get("region_code")});
        for(var filter:filters) for(String metric:List.of("AMOUNT","TONS")) {
          assertThat(DashboardSummaryIntegrationTest.normalized(candidate.ranking("copy",filter[0],filter[1],metric)))
              .as("activity %d phase %d metric %s",id,phase,metric)
              .isEqualTo(DashboardSummaryIntegrationTest.normalized(old.ranking("copy",filter[0],filter[1],metric))); comparisons++;
        }
        assertThat(DashboardSummaryIntegrationTest.normalized(candidate.report("copy","ORDER_DASHBOARD")))
            .as("activity %d phase %d report",id,phase)
            .isEqualTo(DashboardSummaryIntegrationTest.normalized(old.report("copy","ORDER_DASHBOARD")));comparisons++;
        if(phase==0) for(long after=0;;) {
          var batch=maintenance.rebuild(id,after,200,false);after=batch.nextAfterId();if(batch.checked()<200)break;
        }
      }
      for(long after=0;;) {
        var batch=maintenance.reconcile(id,after,200);assertThat(batch.differences()).isEmpty();after=batch.nextAfterId();if(batch.checked()<200)break;
      }
    }
    assertThat(jdbc.queryForList("SELECT activity_id,snapshot_key,CAST(payload_json AS CHAR) payload FROM activity_dashboard_snapshot ORDER BY activity_id,snapshot_key")).isEqualTo(snapshots);
    assertThat(jdbc.queryForList("CHECKSUM TABLE customer_order,order_item,activity,activity_region,domain_event_outbox")).isEqualTo(originalChecksums);
    System.out.printf("SUMMARY_LOCAL_COPY activities=%d orders=%d items=%d comparisons=%d snapshotsUnchanged=%d differences=0%n",rows.size(),
        jdbc.queryForObject("SELECT COUNT(*) FROM customer_order",Long.class),jdbc.queryForObject("SELECT COUNT(*) FROM order_item",Long.class),comparisons,snapshots.size());
  }

  private static String instant(Object value) {
    if(value instanceof java.sql.Timestamp timestamp)return timestamp.toInstant().toString();
    if(value instanceof java.time.LocalDateTime date)return date.toInstant(java.time.ZoneOffset.UTC).toString();
    throw new IllegalArgumentException("Unexpected database datetime type");
  }
}
