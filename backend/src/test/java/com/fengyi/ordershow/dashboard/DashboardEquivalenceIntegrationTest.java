package com.fengyi.ordershow.dashboard;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fengyi.ordershow.activity.ActivityService;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Proxy;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

/** Opt-in comparison with an original-code reference supplied by the verification run, never the business DB. */
@EnabledIfEnvironmentVariable(named = "ORDER_SHOW_DASHBOARD_COMPARE", matches = "order-show-e2e|order-show-ack-smoke")
class DashboardEquivalenceIntegrationTest {
  private static final boolean ACK_SMOKE = "order-show-ack-smoke".equals(System.getenv("ORDER_SHOW_DASHBOARD_COMPARE"));
  private static final String HOST = ACK_SMOKE ? "jdbc:mysql://host.docker.internal:18306/" : "jdbc:mysql://host.docker.internal:33306/";
  private static final String ROOT_PASSWORD = ACK_SMOKE ? "isolated_smoke_root" : "e2e_root_only_not_for_business";
  private static final String DATABASE = "order_show_dashboard_compare";
  private static final ObjectMapper JSON = new ObjectMapper().findAndRegisterModules();
  private static CountingSource source;
  private static JdbcTemplate jdbc;

  @BeforeAll
  static void seedIsolatedScaleFixture() {
    var root = new JdbcTemplate(new DriverManagerDataSource(
        HOST+(ACK_SMOKE ? "ack_smoke" : "order_show_e2e")+"?allowPublicKeyRetrieval=true&useSSL=false&serverTimezone=UTC",
        "root", ROOT_PASSWORD));
    root.execute("CREATE DATABASE IF NOT EXISTS " + DATABASE + " CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci");
    source = new CountingSource();
    jdbc = new JdbcTemplate(source);
    for (String table : List.of("order_item", "customer_order", "domain_event_outbox", "activity_region", "activity_dashboard_snapshot", "fixture_n")) {
      jdbc.execute("DROP TABLE IF EXISTS " + table);
    }
    jdbc.execute("""
        CREATE TABLE customer_order(id BIGINT PRIMARY KEY, activity_id BIGINT, status VARCHAR(20),
          customer_type VARCHAR(16), region_code VARCHAR(64), dealer_full_name_snapshot VARCHAR(255),
          branch_name_snapshot VARCHAR(200), order_no VARCHAR(64), total_amount DECIMAL(18,2),
          total_quantity BIGINT, total_tons DECIMAL(18,6), last_submitted_at DATETIME(3),
          KEY idx_order_scope(activity_id,status,last_submitted_at))
        """);
    jdbc.execute("""
        CREATE TABLE order_item(id BIGINT AUTO_INCREMENT PRIMARY KEY, order_id BIGINT, activity_product_id BIGINT,
          quantity BIGINT, line_amount DECIMAL(18,2), product_line VARCHAR(200), ton_case_factor DECIMAL(18,8),
          line_tons DECIMAL(18,6), is_gift_box BOOLEAN, KEY idx_item_order(order_id),
          UNIQUE KEY idx_item_product(order_id,activity_product_id))
        """);
    jdbc.execute("CREATE TABLE domain_event_outbox(id BIGINT PRIMARY KEY, activity_id BIGINT)");
    jdbc.execute("CREATE TABLE activity_region(id BIGINT PRIMARY KEY, activity_id BIGINT, region_code VARCHAR(64), region_name VARCHAR(100))");
    jdbc.execute("""
        CREATE TABLE activity_dashboard_snapshot(activity_id BIGINT, snapshot_key VARCHAR(200), payload_json JSON,
          generated_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY(activity_id,snapshot_key))
        """);
    jdbc.execute("CREATE TABLE fixture_n(n INT PRIMARY KEY)");
    List<Object[]> sequence = new ArrayList<>();
    for (int n = 1; n <= 1620; n++) sequence.add(new Object[]{n});
    jdbc.batchUpdate("INSERT INTO fixture_n VALUES(?)", sequence);
    jdbc.update("""
        INSERT INTO customer_order
        SELECT n,1,'SUBMITTED',IF(n<=1072,'GENERAL','SPECIAL'),
          CASE MOD(n,4) WHEN 0 THEN NULL WHEN 1 THEN 'NORTH' WHEN 2 THEN 'EAST' ELSE 'SOUTH' END,
          CONCAT('客户',LPAD(n,5,'0')),IF(MOD(n,100)=0,NULL,CONCAT('分公司',LPAD(MOD(n,31),2,'0'))),
          CONCAT('PERF-',n),0,0,0,TIMESTAMPADD(SECOND,n,'2026-10-27 00:00:00') FROM fixture_n
        """);
    jdbc.update("""
        INSERT INTO order_item(order_id,activity_product_id,quantity,line_amount,product_line,ton_case_factor,line_tons,is_gift_box)
        SELECT o.id,s.n,MOD(o.id+s.n,3)+1,(100+s.n*0.01)*(MOD(o.id+s.n,3)+1),
          CASE MOD(s.n,6) WHEN 0 THEN NULL WHEN 1 THEN '其他' WHEN 2 THEN '酱油' WHEN 3 THEN '醋' WHEN 4 THEN '调味油' ELSE '味精' END,
          IF(MOD(s.n,19)=0,NULL,1000),IF(MOD(s.n,19)=0,0,(MOD(o.id+s.n,3)+1)*0.001),MOD(s.n,7)=0
        FROM customer_order o JOIN fixture_n s ON s.n<=IF(o.customer_type='GENERAL',180,41)
        """);
    System.out.println("DASHBOARD_FIXTURE_STAGE target-items-created");
    jdbc.update("""
        UPDATE customer_order o JOIN (
          SELECT order_id,SUM(line_amount) amount,SUM(quantity) quantity,SUM(line_tons) tons FROM order_item GROUP BY order_id
        ) i ON i.order_id=o.id SET o.total_amount=i.amount,o.total_quantity=i.quantity,o.total_tons=i.tons
        """);
    for (int activity = 2; activity <= 4; activity++) {
      long offset = activity * 10000L;
      jdbc.update("""
          INSERT INTO customer_order SELECT id+?, ?,status,customer_type,region_code,dealer_full_name_snapshot,
            branch_name_snapshot,CONCAT(order_no,'-',?),total_amount,total_quantity,total_tons,last_submitted_at
          FROM customer_order WHERE activity_id=1
          """, offset, activity, activity);
      jdbc.update("""
          INSERT INTO order_item(order_id,activity_product_id,quantity,line_amount,product_line,ton_case_factor,line_tons,is_gift_box)
          SELECT i.order_id+?,i.activity_product_id,i.quantity,i.line_amount,i.product_line,i.ton_case_factor,i.line_tons,i.is_gift_box
          FROM order_item i JOIN customer_order o ON o.id=i.order_id WHERE o.activity_id=1
          """, offset);
      System.out.printf("DASHBOARD_FIXTURE_STAGE activity-%d-created%n",activity);
    }
    jdbc.execute("DROP TABLE fixture_n");
    jdbc.update("UPDATE customer_order SET status='WITHDRAWN' WHERE id=1");
    jdbc.update("UPDATE customer_order SET status='VOIDED' WHERE id=2");
    jdbc.update("DELETE FROM order_item WHERE order_id=4");
    jdbc.update("UPDATE order_item SET ton_case_factor=NULL,line_tons=0 WHERE order_id=5");
    jdbc.update("UPDATE order_item SET ton_case_factor=1000,line_tons=0 WHERE order_id=6");
    jdbc.update("UPDATE order_item SET ton_case_factor=NULL,line_tons=NULL WHERE order_id=7 AND activity_product_id<90");
    jdbc.update("UPDATE customer_order SET customer_type='ALL' WHERE id=8");
    jdbc.update("INSERT INTO activity_region VALUES(1,1,'NORTH','北区'),(2,1,'EAST','东区'),(3,1,'SOUTH','南区')");
    System.out.printf("DASHBOARD_FIXTURE orders=%d items=%d targetOrders=1620 targetInitialItems=215428%n",
        jdbc.queryForObject("SELECT COUNT(*) FROM customer_order", Long.class),
        jdbc.queryForObject("SELECT COUNT(*) FROM order_item", Long.class));
  }

  @Test
  void matchesOriginalQueriesAndMeasuresTheSameMultiActivityData() throws Exception {
    var activities = mock(ActivityService.class);
    var activity = activity("ACTIVE");
    when(activities.byCode("compare")).thenReturn(activity);
    when(activities.byId(1)).thenReturn(activity);
    var optimized = new DashboardService(jdbc, activities, JSON);
    Class<?> referenceClass = Class.forName("com.fengyi.ordershow.dashboard.DashboardBaselineReference");
    Object reference = referenceClass.getDeclaredConstructor(JdbcTemplate.class, ActivityService.class, ObjectMapper.class)
        .newInstance(jdbc, activities, JSON);
    var ranking = referenceClass.getMethod("ranking", String.class, String.class, String.class, String.class);
    var report = referenceClass.getMethod("report", String.class, String.class);
    for (String metric : List.of("AMOUNT", "TONS")) {
      for (String[] filter : new String[][]{{null,null},{"ALL",null},{"GENERAL",null},{"SPECIAL",null},
          {"GENERAL","NORTH"},{"GENERAL","EAST"},{"GENERAL","SOUTH"},{"GENERAL","MISSING"},{"GENERAL",""}}) {
        assertEquivalent(ranking.invoke(reference,"compare",filter[0],filter[1],metric),
            optimized.ranking("compare",filter[0],filter[1],metric));
      }
    }
    for (String code : List.of("ORDER_DASHBOARD","总战绩","特渠专业客户 TOP5","综合客户 TOP5",
        "特渠专业客户金额、综合客户金额及合计","综合客户各大区金额及合计","礼盒：特渠专业客户金额、综合客户金额及合计",
        "综合客户各项目组金额及合计","特渠专业客户与综合客户各项目组金额及合计","综合客户大区金额与项目组金额同屏展示")) {
      assertEquivalent(report.invoke(reference,"compare",code),optimized.report("compare",code));
    }
    // Reads must immediately reflect current rows, without a TTL or reuse of a stale event MAX(id).
    jdbc.update("UPDATE customer_order SET status='SUBMITTED',total_amount=98765.43 WHERE id=1");
    jdbc.update("UPDATE order_item SET line_tons=0.123456 WHERE order_id=3 AND activity_product_id=1");
    assertEquivalent(ranking.invoke(reference,"compare",null,null,"TONS"),optimized.ranking("compare",null,null,"TONS"));
    assertEquivalent(report.invoke(reference,"compare","ORDER_DASHBOARD"),optimized.report("compare","ORDER_DASHBOARD"));

    for (String metric : List.of("AMOUNT","TONS")) {
      benchmark("ranking-"+metric, () -> ranking.invoke(reference,"compare",null,null,metric),
          () -> optimized.ranking("compare",null,null,metric));
    }
    benchmark("dashboard-report", () -> report.invoke(reference,"compare","ORDER_DASHBOARD"),
        () -> optimized.report("compare","ORDER_DASHBOARD"));

    for (String status : List.of("CLOSED","FINISHED","ARCHIVED")) {
      activity = activity(status);
      when(activities.byCode("compare")).thenReturn(activity);
      when(activities.byId(1)).thenReturn(activity);
      jdbc.update("DELETE FROM activity_dashboard_snapshot");
      JsonNode expected = normalized(report.invoke(reference,"compare","ORDER_DASHBOARD"));
      jdbc.update("DELETE FROM activity_dashboard_snapshot");
      assertThat(normalized(optimized.report("compare","ORDER_DASHBOARD"))).isEqualTo(expected);
      assertEquivalent(report.invoke(reference,"compare","总战绩"),optimized.report("compare","总战绩"));
    }
    when(activities.byCode("compare")).thenReturn(activity("ACTIVE"));
    assertEquivalent(report.invoke(reference,"compare","ORDER_DASHBOARD"),optimized.report("compare","ORDER_DASHBOARD"));
    jdbc.update("UPDATE customer_order SET status='WITHDRAWN' WHERE activity_id=1");
    assertEquivalent(report.invoke(reference,"compare","ORDER_DASHBOARD"),optimized.report("compare","ORDER_DASHBOARD"));
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM customer_order", Long.class)).isEqualTo(6480);
  }

  private static ActivityService.ActivityView activity(String status) throws Exception {
    return JSON.readValue("""
        {"id":1,"code":"compare","name":"统计对照","status":"%s","companyRankingTopN":90,"branchRankingTopN":30,
         "timezone":"Asia/Shanghai","startsAt":"2026-10-27T00:00:00Z","endsAt":"2030-10-30T00:00:00Z",
         "regions":[{"code":"NORTH","name":"北区","sortNo":0},{"code":"EAST","name":"东区","sortNo":1},{"code":"SOUTH","name":"南区","sortNo":2}]}
        """.formatted(status), ActivityService.ActivityView.class);
  }

  private static void assertEquivalent(Object expected, Object actual) {
    assertThat(normalized(actual)).isEqualTo(normalized(expected));
  }

  private static JsonNode normalized(Object value) {
    ObjectNode node = JSON.valueToTree(value);
    if (node.has("dashboard")) ((ObjectNode)node.get("dashboard")).remove("generatedAt");
    else node.remove("generatedAt");
    return node;
  }

  private static void benchmark(String label, Read original, Read optimized) throws Exception {
    original.get(); optimized.get();
    double[] before = new double[10], after = new double[10];
    int beforeQueries = 0, afterQueries = 0;
    for (int n = 0; n < before.length; n++) {
      source.statements = 0;
      long start = System.nanoTime(); original.get(); before[n] = (System.nanoTime()-start)/1_000_000.0;
      beforeQueries = source.statements;
      source.statements = 0;
      start = System.nanoTime(); optimized.get(); after[n] = (System.nanoTime()-start)/1_000_000.0;
      afterQueries = source.statements;
    }
    Arrays.sort(before); Arrays.sort(after);
    System.out.printf("DASHBOARD_BENCH %s beforeMedianMs=%.2f beforeP95Ms=%.2f afterMedianMs=%.2f afterP95Ms=%.2f queries=%d->%d%n",
        label,before[5],before[9],after[5],after[9],beforeQueries,afterQueries);
    assertThat(afterQueries).isEqualTo(beforeQueries-(label.equals("dashboard-report") ? 5 : 2));
  }

  @FunctionalInterface private interface Read { Object get() throws Exception; }

  private static class CountingSource extends DriverManagerDataSource {
    int statements;
    CountingSource() {
      super(HOST+DATABASE+"?allowPublicKeyRetrieval=true&useSSL=false&serverTimezone=UTC&rewriteBatchedStatements=true",
          "root",ROOT_PASSWORD);
    }
    @Override public Connection getConnection() throws SQLException {
      Connection connection = super.getConnection();
      return (Connection)Proxy.newProxyInstance(Connection.class.getClassLoader(),new Class<?>[]{Connection.class},(proxy,method,args)->{
        if (method.getName().equals("prepareStatement")) statements++;
        try { return method.invoke(connection,args); }
        catch (InvocationTargetException exception) { throw exception.getCause(); }
      });
    }
  }
}
