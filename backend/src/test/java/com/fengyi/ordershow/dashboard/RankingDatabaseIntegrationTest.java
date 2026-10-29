package com.fengyi.ordershow.dashboard;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengyi.ordershow.activity.ActivityService;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.http.converter.json.Jackson2ObjectMapperBuilder;

/** Executes the production ranking SQL only against a dedicated disposable database. */
@EnabledIfEnvironmentVariable(named = "ORDER_SHOW_RANKING_TEST", matches = "order-show-e2e|order-show-ack-smoke")
class RankingDatabaseIntegrationTest {
  private static final boolean ACK_SMOKE = "order-show-ack-smoke".equals(System.getenv("ORDER_SHOW_RANKING_TEST"));
  private static final String HOST = ACK_SMOKE ? "jdbc:mysql://host.docker.internal:18306/" : "jdbc:mysql://host.docker.internal:33306/";
  private static final String OPTIONS = "?allowPublicKeyRetrieval=true&useSSL=false&serverTimezone=UTC";
  private static final String DATABASE = "order_show_ranking_test";
  // Match Spring's ISO timestamp serialization; numeric nanoseconds lose precision in MySQL JSON.
  private static final ObjectMapper JSON = Jackson2ObjectMapperBuilder.json()
      .featuresToDisable(com.fasterxml.jackson.databind.SerializationFeature.WRITE_DATES_AS_TIMESTAMPS).build();
  private static JdbcTemplate jdbc;
  private ActivityService activities;
  private DashboardService service;

  @BeforeAll
  static void createIsolatedSchema() throws Exception {
    var root = new JdbcTemplate(source(ACK_SMOKE ? "ack_smoke" : "order_show_e2e"));
    root.execute("CREATE DATABASE IF NOT EXISTS " + DATABASE + " CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci");
    var dataSource = source(DATABASE);
    try (var connection = dataSource.getConnection()) {
      assertThat(connection.getCatalog()).isEqualTo(DATABASE);
      assertThat(connection.getMetaData().getURL()).startsWith(HOST + DATABASE);
    }
    jdbc = new JdbcTemplate(dataSource);
    jdbc.execute("""
        CREATE TABLE IF NOT EXISTS customer_order (
          id BIGINT PRIMARY KEY, activity_id BIGINT, status VARCHAR(20), customer_type VARCHAR(16), region_code VARCHAR(64),
          dealer_full_name_snapshot VARCHAR(255), branch_name_snapshot VARCHAR(200), order_no VARCHAR(64),
          total_amount DECIMAL(18,2), total_quantity BIGINT, last_submitted_at DATETIME(3), total_tons DECIMAL(18,6),
          KEY idx_order_scope(activity_id,status,last_submitted_at))
        """);
    jdbc.execute("""
        CREATE TABLE IF NOT EXISTS order_item (id BIGINT AUTO_INCREMENT PRIMARY KEY, order_id BIGINT,
          activity_product_id BIGINT, quantity BIGINT, line_amount DECIMAL(18,2), product_line VARCHAR(200),
          ton_case_factor DECIMAL(18,8), line_tons DECIMAL(18,6), is_gift_box BOOLEAN DEFAULT FALSE,
          KEY idx_item_order(order_id), UNIQUE KEY idx_item_product(order_id,activity_product_id))
        """);
    jdbc.execute("CREATE TABLE IF NOT EXISTS domain_event_outbox (id BIGINT PRIMARY KEY, activity_id BIGINT)");
    jdbc.execute("CREATE TABLE IF NOT EXISTS activity_region (id BIGINT PRIMARY KEY, activity_id BIGINT, region_code VARCHAR(64), region_name VARCHAR(100))");
    jdbc.execute("""
        CREATE TABLE IF NOT EXISTS activity_dashboard_snapshot (activity_id BIGINT, snapshot_key VARCHAR(200),
          payload_json JSON, generated_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY(activity_id,snapshot_key))
        """);
  }

  private static DriverManagerDataSource source(String database) {
    return new DriverManagerDataSource(HOST + database + OPTIONS, "root", ACK_SMOKE ? "isolated_smoke_root" : "e2e_root_only_not_for_business");
  }

  @BeforeEach
  void resetFixtures() throws Exception {
    for (String table : List.of("order_item", "customer_order", "domain_event_outbox", "activity_dashboard_snapshot", "activity_region")) {
      jdbc.execute("DELETE FROM " + table);
    }
    activities = mock(ActivityService.class);
    useActivity("ACTIVE", 90, 30);
    service = new DashboardService(jdbc, activities, JSON);
  }

  private void useActivity(String status, int companies, int branches) throws Exception {
    var activity = JSON.readValue("""
        {"id":1,"code":"ranking-fixture","name":"排行测试","status":"%s",
         "companyRankingTopN":%d,"branchRankingTopN":%d,"regions":[],"timezone":"Asia/Shanghai",
         "startsAt":"2026-10-27T00:00:00Z","endsAt":"2030-10-30T00:00:00Z"}
        """.formatted(status, companies, branches), ActivityService.ActivityView.class);
    when(activities.byCode("ranking-fixture")).thenReturn(activity);
    when(activities.byId(1)).thenReturn(activity);
  }

  private void seed(int count, String type, String region, long base) {
    List<Object[]> orders = new ArrayList<>();
    List<Object[]> items = new ArrayList<>();
    for (int index = 1; index <= count; index++) {
      long id = base + index;
      var amount = BigDecimal.valueOf((count + 1L - index) * 100);
      orders.add(new Object[]{id, type, region, type + ":" + region + ":" + index, "分公司" + id, "ORDER-" + id, amount});
      items.add(new Object[]{id, amount, BigDecimal.valueOf(index)});
    }
    if (orders.isEmpty()) return;
    jdbc.batchUpdate("""
        INSERT INTO customer_order(id,activity_id,status,customer_type,region_code,dealer_full_name_snapshot,
          branch_name_snapshot,order_no,total_amount,total_quantity,last_submitted_at)
        VALUES (?,1,'SUBMITTED',?,?,?,?,?, ?,10,'2026-10-27 00:00:00.000')
        """, orders);
    jdbc.batchUpdate("""
        INSERT INTO order_item(order_id,activity_product_id,quantity,line_amount,product_line,ton_case_factor,line_tons)
        VALUES (?,1,10,?,'项目组',0.1,?)
        """, items);
  }

  @ParameterizedTest
  @ValueSource(ints = {0, 20, 22, 89, 90, 91})
  void showsAllUpToNinetyAndCapsBothMetricsWithoutTruncatingTotals(int count) {
    seed(count, "GENERAL", "NORTH", 0);
    for (String metric : List.of("AMOUNT", "TONS")) {
      var dashboard = service.ranking("ranking-fixture", "ALL", null, metric);
      assertThat(dashboard.companies()).hasSize(Math.min(count, 90));
      assertThat(dashboard.branches()).hasSize(Math.min(count, 30));
      assertThat(((Number) dashboard.totals().get("order_count")).intValue()).isEqualTo(count);
      assertThat((BigDecimal) dashboard.totals().get("total_amount"))
          .isEqualByComparingTo(BigDecimal.valueOf(count * (count + 1L) / 2 * 100));
      if (count > 0) {
        assertThat(dashboard.companies().getFirst().name()).isEqualTo("GENERAL:NORTH:" + (metric.equals("AMOUNT") ? 1 : count));
      }
    }
  }

  @Test
  void filtersEachChannelAndRegionBeforeApplyingTheLimitAndIgnoresNonSubmittedOrders() {
    seed(91, "SPECIAL", null, 0);
    seed(22, "GENERAL", "NORTH", 1000);
    seed(20, "GENERAL", "EAST", 2000);
    seed(2, "GENERAL", "SOUTH", 3000);
    jdbc.update("UPDATE customer_order SET status='WITHDRAWN' WHERE id=3001");
    jdbc.update("UPDATE customer_order SET status='VOIDED' WHERE id=3002");
    for (String metric : List.of("AMOUNT", "TONS")) {
      assertThat(service.ranking("ranking-fixture", "ALL", null, metric).companies()).hasSize(90);
      assertThat(service.ranking("ranking-fixture", "SPECIAL", null, metric).companies()).hasSize(90)
          .allMatch(row -> row.name().startsWith("SPECIAL:"));
      assertThat(service.ranking("ranking-fixture", "GENERAL", null, metric).companies()).hasSize(42)
          .allMatch(row -> row.name().startsWith("GENERAL:"));
      assertThat(service.ranking("ranking-fixture", "GENERAL", "NORTH", metric).companies()).hasSize(22)
          .allMatch(row -> row.name().startsWith("GENERAL:NORTH:"));
      assertThat(service.ranking("ranking-fixture", "GENERAL", "EAST", metric).companies()).hasSize(20);
      assertThat(service.ranking("ranking-fixture", "GENERAL", "SOUTH", metric).companies()).isEmpty();
    }
  }

  @Test
  void tonsRanksDistinguishMissingWeightsFromCalculatedZeroAndPreservePartialWeights() {
    seed(6, "GENERAL", "NORTH", 0);
    jdbc.update("UPDATE order_item SET ton_case_factor=NULL,line_tons=NULL WHERE order_id=1");
    jdbc.update("UPDATE order_item SET ton_case_factor=NULL,line_tons=0 WHERE order_id=2");
    jdbc.update("UPDATE order_item SET line_tons=0 WHERE order_id=3");
    jdbc.update("UPDATE order_item SET ton_case_factor=NULL WHERE order_id=4"); // A saved positive weight is still known.
    jdbc.update("INSERT INTO order_item(order_id,activity_product_id,quantity,line_amount,product_line) VALUES(5,2,1,50,'项目组')");
    assertThat(service.ranking("ranking-fixture", null, null, "AMOUNT").companies()).hasSize(6);
    var tons = service.ranking("ranking-fixture", null, null, "TONS");
    assertThat(tons.companies()).extracting(DashboardService.RankRow::name)
        .containsExactly("GENERAL:NORTH:6", "GENERAL:NORTH:5", "GENERAL:NORTH:4", "GENERAL:NORTH:3");
    assertThat(tons.companies().get(1).tons()).isEqualByComparingTo("5");
    assertThat(tons.branches()).hasSize(4);
    jdbc.update("UPDATE order_item SET ton_case_factor=NULL,line_tons=0");
    tons = service.ranking("ranking-fixture", null, null, "TONS");
    assertThat(tons.companies()).isEmpty();
    assertThat(tons.branches()).isEmpty();
  }

  @Test
  void refreshingOldHistoricalSnapshotsRestoresAllTwentyTwoForBothMetrics() throws Exception {
    seed(22, "GENERAL", "NORTH", 0);
    useActivity("FINISHED", 20, 20);
    for (String metric : List.of("AMOUNT", "TONS")) {
      assertThat(service.ranking("ranking-fixture", "ALL", null, metric).companies()).hasSize(20);
    }
    useActivity("FINISHED", 90, 30);
    assertThat(service.ranking("ranking-fixture", "ALL", null, "AMOUNT").companies()).hasSize(20);
    // The controlled repair invalidates derived snapshots; requests rebuild with the saved corrected limits.
    jdbc.update("DELETE FROM activity_dashboard_snapshot WHERE activity_id=1");
    for (String metric : List.of("AMOUNT", "TONS")) {
      var rebuilt = service.ranking("ranking-fixture", "ALL", null, metric);
      assertThat(rebuilt.companies()).hasSize(22);
      assertThat(rebuilt.status()).isEqualTo("FINISHED");
      assertThat(JSON.readTree(JSON.writeValueAsString(service.ranking("ranking-fixture", "ALL", null, metric))))
          .isEqualTo(JSON.readTree(JSON.writeValueAsString(rebuilt)));
    }
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM customer_order", Integer.class)).isEqualTo(22);
  }

  @Test
  void continuesToHonorExplicitCustomLimits() throws Exception {
    seed(22, "GENERAL", "NORTH", 0);
    useActivity("ACTIVE", 12, 7);
    for (String metric : List.of("AMOUNT", "TONS")) {
      var result = service.ranking("ranking-fixture", null, null, metric);
      assertThat(result.companies()).hasSize(12);
      assertThat(result.branches()).hasSize(7);
    }
  }
}
