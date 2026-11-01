package com.fengyi.ordershow.dashboard;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Supplier;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.aop.framework.ProxyFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.interceptor.TransactionInterceptor;
import org.springframework.transaction.annotation.AnnotationTransactionAttributeSource;

/** Uses only the existing fixed disposable summary-test DB. Maven runs these fixtures serially. */
@EnabledIfEnvironmentVariable(named="ORDER_SHOW_SUMMARY_TEST", matches="order-show-e2e")
class PageStatisticsIntegrationTest {
  private static final String CODE = "summary";
  private JdbcTemplate jdbc;
  private DashboardSummaryStore summaries;
  private DashboardService legacy;
  private PageStatisticsService pages;

  @BeforeAll static void setup() throws Exception {
    DashboardSummaryIntegrationTest.setup();
    var db = DashboardSummaryIntegrationTest.jdbc;
    db.execute("CREATE TABLE activity_customer(id BIGINT PRIMARY KEY,activity_id BIGINT,data_version_id BIGINT,customer_type VARCHAR(16),is_active BOOLEAN)");
    db.execute("CREATE TABLE activity_data_binding(activity_id BIGINT,data_type VARCHAR(20),current_version_id BIGINT)");
    // Match V041: production refreshes summaries once per order in the business transaction.
    for (String trigger : List.of("dashboard_item_insert", "dashboard_item_delete", "dashboard_item_update"))
      db.execute("DROP TRIGGER IF EXISTS " + trigger);
  }

  @BeforeEach void fixtures() throws Exception {
    jdbc = spy(new JdbcTemplate(DashboardSummaryIntegrationTest.source));
    for (String table : List.of("order_item", "order_dashboard_product_line_stat", "order_dashboard_stat", "customer_order",
        "activity_dashboard_snapshot", "activity_customer", "activity_data_binding")) jdbc.update("DELETE FROM " + table);
    DashboardSummaryIntegrationTest.status("ACTIVE");
    DashboardSummaryIntegrationTest.seed(1,96,1);
    DashboardSummaryIntegrationTest.seed(1001,1005,2);
    jdbc.update("UPDATE customer_order SET status='WITHDRAWN' WHERE id=1");
    jdbc.update("UPDATE customer_order SET status='VOIDED' WHERE id=2");
    jdbc.update("UPDATE customer_order SET customer_type='ALL' WHERE id=3");
    jdbc.update("UPDATE customer_order SET region_code='OLD_REGION' WHERE id=4");
    jdbc.update("DELETE FROM order_item WHERE order_id=5");
    jdbc.update("UPDATE order_item SET ton_case_factor=NULL,line_tons=NULL WHERE order_id=6");
    jdbc.update("UPDATE order_item SET ton_case_factor=NULL,line_tons=0 WHERE order_id=7");
    jdbc.update("UPDATE order_item SET line_tons=0 WHERE order_id=8");
    jdbc.update("INSERT INTO activity_data_binding VALUES(1,'WHITELIST',2),(2,'WHITELIST',2)");
    jdbc.update("INSERT INTO activity_customer VALUES(1,1,2,'GENERAL',TRUE),(2,1,2,'SPECIAL',TRUE),(3,1,2,'SPECIAL',TRUE),"
        + "(4,1,1,'GENERAL',TRUE),(5,1,2,'SPECIAL',FALSE),(6,2,2,'GENERAL',TRUE)");
    configure(false);
  }

  private void configure(boolean summary) {
    summaries = new DashboardSummaryStore(jdbc, summary, "");
    legacy = new DashboardService(jdbc, DashboardSummaryIntegrationTest.activities, DashboardSummaryIntegrationTest.JSON, summaries);
    var target = new PageStatisticsService(jdbc, DashboardSummaryIntegrationTest.activities, legacy, summaries);
    var proxy = new ProxyFactory(target);
    proxy.addAdvice(new TransactionInterceptor(DashboardSummaryIntegrationTest.manager, new AnnotationTransactionAttributeSource()));
    pages = (PageStatisticsService) proxy.getProxy();
  }

  @ParameterizedTest @ValueSource(booleans={false,true})
  void allPageValuesMatchOriginalSqlWithRawPartialCleanAndDirtySummaries(boolean summary) throws Exception {
    configure(summary);
    assertAllPages();
    if (summary) {
      DashboardSummaryIntegrationTest.transaction.executeWithoutResult(tx -> {
        for (long id=1; id<=48; id++) summaries.refresh(id);
      });
      assertAllPages();
      DashboardSummaryIntegrationTest.transaction.executeWithoutResult(tx -> {
        for (long id=49; id<=96; id++) summaries.refresh(id);
      });
      jdbc.update("UPDATE order_dashboard_stat SET dirty=TRUE WHERE order_id IN(10,11)");
      assertAllPages();
    }
    // Neither a single channel nor the ALL storage value changes the all-order aggregation rules.
    for (String type : List.of("GENERAL", "SPECIAL", "ALL")) {
      jdbc.update("UPDATE customer_order SET customer_type=? WHERE activity_id=1", type);
      jdbc.update("UPDATE activity_customer SET customer_type=? WHERE activity_id=1", type);
      assertAllPages();
      assertThat(pages.overview(1).customerTypeMode()).isEqualTo(type.equals("ALL") ? "UNSPECIFIED" : "TYPED");
    }
    jdbc.update("UPDATE customer_order SET status='VOIDED' WHERE activity_id=1");
    assertAllPages();
  }

  private void assertAllPages() throws Exception {
    var baseline = new DashboardBeforeSummaryReference(jdbc, DashboardSummaryIntegrationTest.activities, DashboardSummaryIntegrationTest.JSON);
    for (String metric : List.of("AMOUNT", "TONS")) for (String[] scope : new String[][]{
        {null,null},{"ALL",null},{"GENERAL",null},{"SPECIAL",null},{"GENERAL","NORTH"},{"GENERAL","MISSING"}}) {
      var expected = tree(baseline.ranking(CODE, scope[0], scope[1], metric));
      var actual = tree(pages.ranking(CODE, scope[0], scope[1], metric));
      same(actual, expected, "companies", "branches", "activityId", "status", "version");
      same(actual.path("totals"), expected.path("totals"), "total_amount", "total_tons", "order_count", "total_quantity");
    }
    var expected = tree(baseline.report(CODE, "ORDER_DASHBOARD"));
    var actual = tree(pages.dashboard(CODE));
    same(actual, expected, "customerTypes", "regions", "generalProductLines", "specialProductLines", "trend", "regionProductLines", "generalRegions");
    same(actual.path("dashboard"), expected.path("dashboard"), "totals", "productLines", "status", "version");
    for (String key : List.of("companies", "branches")) {
      ArrayNode top = DashboardSummaryIntegrationTest.JSON.createArrayNode();
      expected.path("dashboard").path(key).forEach(row -> { if(top.size()<15) top.add(row); });
      assertThat(actual.path("dashboard").path(key)).isEqualTo(top);
    }
    for (String topic : List.of("特渠专业客户 TOP5", "综合客户 TOP5", "总战绩", "特渠专业客户金额、综合客户金额及合计",
        "综合客户各大区金额及合计", "礼盒：特渠专业客户金额、综合客户金额及合计", "综合客户各项目组金额及合计",
        "特渠专业客户与综合客户各项目组金额及合计", "综合客户大区金额与项目组金额同屏展示")) {
      var report = tree(pages.reports(CODE, topic));
      same(report, expected, "customerTypes", "regions", "generalProductLines", "specialProductLines", "giftCustomerTypes",
          "topGeneral", "topSpecial", "regionProductLines", "generalRegions");
      same(report.path("dashboard"), expected.path("dashboard"), "productLines", "status", "version");
      same(report.path("dashboard").path("totals"), expected.path("dashboard").path("totals"), "total_amount");
    }
    var overview = tree(pages.overview(1));
    same(overview.path("totals"), expected.path("dashboard").path("totals"), "order_count", "total_amount", "total_quantity", "total_tons");
    for (String type : List.of("GENERAL", "SPECIAL", "ALL")) {
      long count = jdbc.queryForObject("SELECT COUNT(*) FROM customer_order WHERE activity_id=1 AND status='SUBMITTED' AND customer_type=?", Long.class, type);
      assertThat(pages.overview(1).submittedByType().getOrDefault(type,0L)).isEqualTo(count);
    }
    assertThat(pages.overview(1).customerCount()).isEqualTo(3);
  }

  @Test void oldSnapshotsStayFrozenUntilFinishedActivityRefreshAndReopenUsesLiveData() throws Exception {
    for (String status : List.of("FINISHED", "ARCHIVED")) {
      jdbc.update("DELETE FROM activity_dashboard_snapshot");
      DashboardSummaryIntegrationTest.status(status);
      // Save old-format snapshots through the old SQL implementation.
      var baseline = new DashboardBeforeSummaryReference(jdbc, DashboardSummaryIntegrationTest.activities, DashboardSummaryIntegrationTest.JSON);
      baseline.report(CODE, "FINAL");
      for (String type : new String[]{null,"GENERAL","SPECIAL"}) baseline.ranking(CODE,type,null,"AMOUNT");
      var before = tree(pages.dashboard(CODE));
      var reportBefore = tree(pages.reports(CODE,"总战绩"));
      var overviewBefore = tree(pages.overview(1));
      jdbc.update("UPDATE customer_order SET total_amount=total_amount+100 WHERE id=10");
      assertThat(tree(pages.dashboard(CODE))).isEqualTo(before);
      assertThat(tree(pages.reports(CODE,"总战绩"))).isEqualTo(reportBefore);
      assertThat(tree(pages.overview(1))).isEqualTo(overviewBefore);
      legacy.refreshFinalSnapshots(1);
      if (status.equals("FINISHED")) {
        assertThat(tree(pages.dashboard(CODE))).isNotEqualTo(before);
        assertThat(tree(pages.overview(1))).isNotEqualTo(overviewBefore);
        assertThat(tree(pages.reports(CODE,"总战绩"))).isNotEqualTo(reportBefore);
      } else assertThat(tree(pages.dashboard(CODE))).isEqualTo(before);
    }
    // ActivityService.reopen clears every existing key; emulate that established lifecycle operation.
    jdbc.update("DELETE FROM activity_dashboard_snapshot");
    DashboardSummaryIntegrationTest.status("ACTIVE");
    assertAllPages();
    DashboardSummaryIntegrationTest.status("FINISHED");
    pages.dashboard(CODE); pages.ranking(CODE,null,null,"TONS"); pages.overview(1);
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM activity_dashboard_snapshot", Long.class)).isGreaterThan(0);
  }

  @Test void overviewReadsOneCommittedViewWhenOrderAndWhitelistChangeMidRequest() throws Exception {
    var expected = tree(pages.overview(1));
    var once = new AtomicBoolean();
    doAnswer(call -> {
      var value = call.callRealMethod();
      if (once.compareAndSet(false,true)) {
        try (var executor = Executors.newSingleThreadExecutor()) {
          executor.submit(() -> DashboardSummaryIntegrationTest.transaction.executeWithoutResult(tx -> {
            DashboardSummaryIntegrationTest.jdbc.update("UPDATE customer_order SET total_amount=total_amount+1 WHERE activity_id=1");
            DashboardSummaryIntegrationTest.jdbc.update("UPDATE order_item SET line_tons=9 WHERE order_id=10");
            DashboardSummaryIntegrationTest.jdbc.update("UPDATE activity_customer SET is_active=FALSE WHERE id=1");
          })).get(15,TimeUnit.SECONDS);
        }
      }
      return value;
    }).when(jdbc).query(anyString(), any(org.springframework.jdbc.core.RowCallbackHandler.class), any(Object[].class));
    assertThat(tree(pages.overview(1))).isEqualTo(expected);
    assertThat(once).isTrue();
    assertThat(tree(pages.overview(1))).isNotEqualTo(expected);
  }

  @Test void independentReadersExecuteFewerQueriesAndDoNotReadUnrelatedModules() {
    configure(true);
    DashboardSummaryIntegrationTest.transaction.executeWithoutResult(tx -> { for(long id=1;id<=96;id++) summaries.refresh(id); });
    var oldOverview = measure(() -> { legacy.ranking(CODE,null,null); legacy.ranking(CODE,"GENERAL",null); return legacy.ranking(CODE,"SPECIAL",null); });
    var newOverview = measure(() -> pages.overview(1));
    assertThat(newOverview.sql()).hasSize(3);
    assertThat(newOverview.sql()).noneMatch(sql -> sql.contains("ROW_NUMBER") || sql.contains("domain_event_outbox") || sql.contains("is_gift_box"));
    var oldRanking = measure(() -> legacy.ranking(CODE,null,null));
    var newRanking = measure(() -> pages.ranking(CODE,null,null,"AMOUNT"));
    assertThat(newRanking.sql()).hasSize(3).noneMatch(sql -> sql.contains("is_gift_box") || sql.contains("COUNT(DISTINCT i.activity_product_id)") || sql.contains("LIMIT 20"));
    var oldReport = measure(() -> legacy.report(CODE,"ORDER_DASHBOARD"));
    var newDashboard = measure(() -> pages.dashboard(CODE));
    assertThat(newDashboard.sql()).hasSize(9).noneMatch(sql -> sql.contains("LIMIT 5") || sql.contains("WHERE i.is_gift_box = TRUE") || sql.contains("LIMIT 20"));
    var newReport = measure(() -> pages.reports(CODE,"总战绩"));
    assertThat(newReport.sql()).hasSize(9).noneMatch(sql -> sql.contains("ROW_NUMBER") || sql.contains("GROUP BY bucket") || sql.contains("COUNT(DISTINCT i.activity_product_id)") || sql.contains("LIMIT 20"));
    printCost("overview (old excludes module-context)",oldOverview,newOverview);
    printCost("ranking",oldRanking,newRanking);
    printCost("dashboard",oldReport,newDashboard);
    printCost("reports",oldReport,newReport);
    assertThat(newOverview.sql().size()).isLessThan(oldOverview.sql().size());
    assertThat(newRanking.sql().size()).isLessThan(oldRanking.sql().size());
    assertThat(newDashboard.sql().size()).isLessThan(oldReport.sql().size());
    assertThat(newReport.sql().size()).isLessThan(oldReport.sql().size());
  }

  private Measurement measure(Supplier<?> read) {
    clearInvocations(jdbc);
    long start=System.nanoTime(); read.get(); long nanos=System.nanoTime()-start;
    List<String> sql = new ArrayList<>();
    mockingDetails(jdbc).getInvocations().forEach(call -> {
      // Count the single execution-level overload, not every delegating JdbcTemplate overload.
      var parameters = call.getMethod().getParameterTypes();
      if (call.getMethod().getName().equals("query") && parameters.length == 3
          && parameters[1] == org.springframework.jdbc.core.PreparedStatementSetter.class
          && parameters[2] == org.springframework.jdbc.core.ResultSetExtractor.class
          && call.getArgument(0) instanceof String text
          && (text.stripLeading().startsWith("SELECT") || text.stripLeading().startsWith("WITH"))) sql.add(text);
    });
    return new Measurement(sql,nanos/1_000_000.0);
  }
  private void printCost(String page, Measurement old, Measurement current) {
    System.out.printf("PAGE_SQL_COST %s queries=%d->%d single_sample_ms=%.2f->%.2f%n",page,old.sql().size(),current.sql().size(),old.ms(),current.ms());
  }
  private record Measurement(List<String> sql,double ms) {}
  private static JsonNode tree(Object value) { return DashboardSummaryIntegrationTest.normalized(value); }
  private static void same(JsonNode actual,JsonNode expected,String... fields) {
    for(String field:fields) assertThat(actual.path(field)).as(field).isEqualTo(expected.path(field));
  }
  @AfterAll static void close() { DashboardSummaryIntegrationTest.close(); }
}
