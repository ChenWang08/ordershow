package com.fengyi.ordershow.dashboard;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fengyi.ordershow.activity.ActivityService;
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@EnabledIfEnvironmentVariable(named="ORDER_SHOW_SUMMARY_TEST", matches="order-show-e2e")
class DashboardSummaryIntegrationTest {
  static final String DB = "order_show_summary_test";
  static final String URL = "jdbc:mysql://host.docker.internal:33306/";
  static final String OPTIONS = "?allowPublicKeyRetrieval=true&useSSL=false&serverTimezone=UTC&rewriteBatchedStatements=true";
  static final ObjectMapper JSON = new ObjectMapper().findAndRegisterModules();
  static HikariDataSource source;
  static JdbcTemplate jdbc;
  static DataSourceTransactionManager manager;
  static TransactionTemplate transaction;
  static DashboardSummaryStore store;
  static DashboardSummaryMaintenance maintenance;
  static ActivityService activities;
  static DashboardService candidate;
  static DashboardBeforeSummaryReference baseline;

  @BeforeAll static void setup() throws Exception {
    var root = new JdbcTemplate(new DriverManagerDataSource(URL+"order_show_e2e"+OPTIONS,"root","e2e_root_only_not_for_business"));
    // This fixed disposable DB is exclusively owned by this test. Never accepts a caller supplied URL/name.
    root.execute("DROP DATABASE IF EXISTS " + DB);
    root.execute("CREATE DATABASE " + DB + " CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci");
    HikariConfig config = new HikariConfig();
    config.setJdbcUrl(URL+DB+OPTIONS); config.setUsername("root"); config.setPassword("e2e_root_only_not_for_business");
    config.setMaximumPoolSize(24); config.setConnectionInitSql("SET time_zone='+00:00'");
    source = new HikariDataSource(config); jdbc = new JdbcTemplate(source);
    manager = new DataSourceTransactionManager(source);
    transaction = new TransactionTemplate(manager);
    transaction.setIsolationLevel(TransactionDefinition.ISOLATION_READ_COMMITTED);
    store = new DashboardSummaryStore(jdbc,true,"");
    maintenance = new DashboardSummaryMaintenance(jdbc,manager);
    jdbc.execute("CREATE TABLE activity(id BIGINT UNSIGNED PRIMARY KEY)");
    jdbc.execute("INSERT INTO activity VALUES(1),(2)");
    jdbc.execute("""
        CREATE TABLE customer_order(id BIGINT UNSIGNED PRIMARY KEY,activity_id BIGINT UNSIGNED,status VARCHAR(20),
          customer_type VARCHAR(16),region_code VARCHAR(64),dealer_full_name_snapshot VARCHAR(255),branch_name_snapshot VARCHAR(200),
          order_no VARCHAR(64),total_amount DECIMAL(18,2),total_quantity BIGINT,total_tons DECIMAL(18,6),last_submitted_at DATETIME(3),
          KEY idx_scope(activity_id,status,last_submitted_at))
        """);
    jdbc.execute("""
        CREATE TABLE order_item(id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,order_id BIGINT UNSIGNED NOT NULL,
          activity_product_id BIGINT,quantity BIGINT,line_amount DECIMAL(18,2),product_line VARCHAR(200),
          ton_case_factor DECIMAL(18,8),line_tons DECIMAL(18,6),is_gift_box BOOLEAN NOT NULL,
          UNIQUE KEY uk_product(order_id,activity_product_id))
        """);
    jdbc.execute("CREATE TABLE domain_event_outbox(id BIGINT PRIMARY KEY,activity_id BIGINT)");
    jdbc.execute("CREATE TABLE activity_region(id BIGINT PRIMARY KEY,activity_id BIGINT,region_code VARCHAR(64),region_name VARCHAR(100))");
    jdbc.execute("INSERT INTO activity_region VALUES(1,1,'NORTH','北区'),(2,1,'SOUTH','南区')");
    jdbc.execute("""
        CREATE TABLE activity_dashboard_snapshot(activity_id BIGINT,snapshot_key VARCHAR(200),payload_json JSON,
          generated_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),PRIMARY KEY(activity_id,snapshot_key))
        """);
    seed(1,30,1);
    // Migration over pre-existing rows: no summaries yet, no changes to orders or snapshots.
    Flyway.configure().dataSource(source).locations("classpath:db/migration").baselineOnMigrate(true).baselineVersion("39").target("40").load().migrate();
    activities = mock(ActivityService.class);
    status("ACTIVE");
    candidate = new DashboardService(jdbc,activities,JSON,store);
    baseline = new DashboardBeforeSummaryReference(jdbc,activities,JSON);
  }

  static void status(String status) throws Exception {
    var activity = JSON.readValue("""
        {"id":1,"code":"summary","name":"统计对照","status":"%s","companyRankingTopN":90,"branchRankingTopN":30,
         "timezone":"Asia/Shanghai","startsAt":"2026-10-27T00:00:00Z","endsAt":"2030-10-30T00:00:00Z",
         "regions":[{"code":"NORTH","name":"北区","sortNo":0},{"code":"SOUTH","name":"南区","sortNo":1}]}
        """.formatted(status),ActivityService.ActivityView.class);
    when(activities.byCode("summary")).thenReturn(activity); when(activities.byId(1)).thenReturn(activity);
  }

  static void seed(int first,int last,int activity) {
    List<Object[]> orders = new ArrayList<>();
    for(int n=first;n<=last;n++) orders.add(new Object[]{n,activity,n%3==0?"SPECIAL":"GENERAL",
        n%4==0?null:n%4==1?"NORTH":n%4==2?"SOUTH":"","客户"+n,n%7==0?null:"分公司"+(n%31),"S-"+n,n});
    jdbc.batchUpdate("""
        INSERT INTO customer_order VALUES(?,?,'SUBMITTED',?,?,?,?,?,0,0,0,TIMESTAMPADD(SECOND,?,'2026-10-27 00:00:00'))
        """,orders);
    jdbc.update("""
        INSERT INTO order_item(order_id,activity_product_id,quantity,line_amount,product_line,ton_case_factor,line_tons,is_gift_box)
        WITH RECURSIVE numbers AS (SELECT 1 n UNION ALL SELECT n+1 FROM numbers WHERE n<180)
        SELECT o.id,n,MOD(o.id+n,5)+1,(100+n*0.01)*(MOD(o.id+n,5)+1),
          CASE MOD(n,8) WHEN 0 THEN NULL WHEN 1 THEN '其他' WHEN 2 THEN '' ELSE CONCAT('项目组',MOD(n,8)) END,
          IF(MOD(n,19)=0,NULL,1000),IF(MOD(n,19)=0,0,(MOD(o.id+n,5)+1)*0.001),MOD(n,7)=0
        FROM customer_order o JOIN numbers ON TRUE WHERE o.id BETWEEN ? AND ?
        """,first,last);
    jdbc.update("""
        UPDATE customer_order o JOIN (
          SELECT order_id,SUM(line_amount) amount,SUM(quantity) quantity,SUM(line_tons) tons
          FROM order_item WHERE order_id BETWEEN ? AND ? GROUP BY order_id
        ) i ON o.id=i.order_id SET o.total_amount=i.amount,o.total_quantity=i.quantity,o.total_tons=i.tons
        """,first,last);
  }

  @Test @Order(1) void matchesMissingPartialDirtyAndRebuiltSummaries() {
    compareAll();
    assertThat(maintenance.reconcile(1,0,100).differences()).hasSize(30);
    maintenance.rebuild(1,0,12,false); compareAll();
    jdbc.update("UPDATE customer_order SET status='WITHDRAWN' WHERE id=1");
    jdbc.update("UPDATE customer_order SET status='VOIDED' WHERE id=2");
    jdbc.update("UPDATE customer_order SET customer_type='ALL' WHERE id=3");
    jdbc.update("DELETE FROM order_item WHERE order_id=4");
    jdbc.update("UPDATE order_item SET ton_case_factor=NULL,line_tons=0 WHERE order_id=5");
    jdbc.update("UPDATE order_item SET ton_case_factor=1000,line_tons=0 WHERE order_id=6");
    jdbc.update("UPDATE order_item SET ton_case_factor=NULL,line_tons=NULL WHERE order_id=7");
    jdbc.update("UPDATE order_item SET product_line=NULL,is_gift_box=TRUE,line_amount=123.45 WHERE order_id=8");
    jdbc.update("UPDATE customer_order SET total_amount=99999.99 WHERE id=9");
    compareAll();
    rebuildAll(); compareAll();
    assertThat(maintenance.reconcile(1,0,100).differences()).isEmpty();
    jdbc.update("UPDATE order_dashboard_stat SET all_tons=987 WHERE order_id=10");
    jdbc.update("DELETE FROM order_dashboard_product_line_stat WHERE order_id=11");
    assertThat(maintenance.reconcile(1,0,100).differences()).extracting(DashboardSummaryMaintenance.Difference::reason)
        .containsExactly("TONS_OR_COUNT","PRODUCT_LINE_OR_GIFT");
    maintenance.rebuild(1,9,2,true); compareAll();
    assertThat(maintenance.reconcile(1,0,100).differences()).isEmpty();
  }

  @Test @Order(2) void refreshAndInvalidationRollbackWithBusinessTransaction() {
    JsonNode before=normalized(candidate.report("summary","ORDER_DASHBOARD"));
    transaction.executeWithoutResult(tx -> {
      jdbc.update("UPDATE order_item SET line_amount=88888,line_tons=88 WHERE order_id=12");
      assertThat(jdbc.queryForObject("SELECT dirty FROM order_dashboard_stat WHERE order_id=12",Boolean.class)).isTrue();
      store.refresh(12);
      assertThat(jdbc.queryForObject("SELECT dirty FROM order_dashboard_stat WHERE order_id=12",Boolean.class)).isFalse();
      compareAll(); tx.setRollbackOnly();
    });
    assertThat(normalized(candidate.report("summary","ORDER_DASHBOARD"))).isEqualTo(before);
    assertThat(maintenance.reconcile(1,0,100).differences()).isEmpty();
  }

  @Test @Order(3) void backfillCannotPublishOlderDataOverConcurrentWrite() throws Exception {
    var written=new CountDownLatch(1); var release=new CountDownLatch(1);
    try(var pool=Executors.newFixedThreadPool(2)) {
      var writer=pool.submit(() -> transaction.executeWithoutResult(tx -> {
        jdbc.queryForList("SELECT id FROM activity WHERE id=1 FOR SHARE",Long.class);
        jdbc.queryForList("SELECT id FROM customer_order WHERE id=13 FOR UPDATE",Long.class);
        jdbc.update("UPDATE order_item SET line_amount=456.78 WHERE order_id=13"); written.countDown();
        try { if(!release.await(10,TimeUnit.SECONDS)) throw new IllegalStateException("test timeout"); }
        catch(InterruptedException e){throw new IllegalStateException(e);}
        store.refresh(13);
      }));
      assertThat(written.await(10,TimeUnit.SECONDS)).isTrue();
      var backfill=pool.submit(() -> maintenance.rebuild(1,12,1,true));
      // Reader sees the old committed order+summary, never the uncommitted write.
      compareAll(); release.countDown(); writer.get(15,TimeUnit.SECONDS); backfill.get(15,TimeUnit.SECONDS);
    } finally { release.countDown(); }
    compareAll(); assertThat(maintenance.reconcile(1,0,100).differences()).isEmpty();
  }

  @Test @Order(4) void historicalLifecycleAndRollbackReaderKeepOriginalBehavior() throws Exception {
    var fallback=new DashboardService(jdbc,activities,JSON,new DashboardSummaryStore(jdbc,false,""));
    assertThat(normalized(fallback.report("summary","ORDER_DASHBOARD"))).isEqualTo(normalized(baseline.report("summary","ORDER_DASHBOARD")));
    for(String state:List.of("CLOSED","FINISHED","ARCHIVED")) {
      status(state); jdbc.update("DELETE FROM activity_dashboard_snapshot");
      var expected=normalized(baseline.report("summary","ORDER_DASHBOARD"));
      jdbc.update("DELETE FROM activity_dashboard_snapshot");
      assertThat(normalized(candidate.report("summary","ORDER_DASHBOARD"))).isEqualTo(expected);
      if(!state.equals("CLOSED")) {
        jdbc.update("UPDATE customer_order SET total_amount=total_amount+1 WHERE id=14");
        assertThat(normalized(candidate.report("summary","ORDER_DASHBOARD"))).isEqualTo(expected);
        candidate.refreshFinalSnapshots(1);
        if(state.equals("FINISHED")) assertThat(normalized(candidate.report("summary","ORDER_DASHBOARD"))).isNotEqualTo(expected);
        else assertThat(normalized(candidate.report("summary","ORDER_DASHBOARD"))).isEqualTo(expected);
      }
    }
    status("ACTIVE"); jdbc.update("DELETE FROM activity_dashboard_snapshot"); compareAll();
  }

  @Test @Order(5)
  @EnabledIfEnvironmentVariable(named="ORDER_SHOW_SUMMARY_BENCH",matches="true")
  void scaleAndConcurrentReadWriteBenchmark() throws Exception {
    seed(10001,12000,2);
    for(int count:new int[]{1000,5000}) {
      seed(count==1000?31:1001,count,1);
      long start=System.nanoTime(); rebuildAll();
      System.out.printf("SUMMARY_BACKFILL orders=%d elapsedMs=%.1f%n",count,(System.nanoTime()-start)/1e6);
      compareAll();
      for(long after=0;;) {
        var batch=maintenance.reconcile(1,after,500); assertThat(batch.differences()).isEmpty();
        after=batch.nextAfterId(); if(batch.checked()<500) break;
      }
      for(String metric:List.of("AMOUNT","TONS","REPORT")) {
        benchmark("orders="+count+" metric="+metric,
            () -> read(false,metric),() -> read(true,metric));
      }
    }
    for(int readers:new int[]{1,5,20}) {
      concurrent(false,readers,false); concurrent(true,readers,false);
    }
    concurrent(false,5,true); concurrent(true,5,true);
    compareAll();
  }

  static void read(boolean summary,String metric) {
    var tx=new TransactionTemplate(manager); tx.setIsolationLevel(TransactionDefinition.ISOLATION_REPEATABLE_READ);
    tx.executeWithoutResult(status -> {
      if(metric.equals("REPORT")) { if(summary) candidate.report("summary","ORDER_DASHBOARD"); else baseline.report("summary","ORDER_DASHBOARD"); }
      else { if(summary) candidate.ranking("summary",null,null,metric); else baseline.ranking("summary",null,null,metric); }
    });
  }

  static void benchmark(String label,Runnable oldRead,Runnable newRead) {
    oldRead.run(); newRead.run();
    double[] oldTimes=new double[10],newTimes=new double[10];
    for(int n=0;n<10;n++) {
      // Alternate order to reduce warm-cache/order bias.
      if(n%2==0) { oldTimes[n]=timed(oldRead); newTimes[n]=timed(newRead); }
      else {newTimes[n]=timed(newRead); oldTimes[n]=timed(oldRead);}
    }
    java.util.Arrays.sort(oldTimes); java.util.Arrays.sort(newTimes);
    System.out.printf("SUMMARY_BENCH %s rawMedianMs=%.1f rawP95Ms=%.1f summaryMedianMs=%.1f summaryP95Ms=%.1f%n",
        label,oldTimes[5],oldTimes[9],newTimes[5],newTimes[9]);
  }

  static double timed(Runnable action) {long start=System.nanoTime();action.run();return (System.nanoTime()-start)/1e6;}

  static void concurrent(boolean summary,int readers,boolean writing) throws Exception {
    var gate=new CountDownLatch(1);
    var readTimes=new java.util.concurrent.ConcurrentLinkedQueue<Double>();
    var writeTimes=new java.util.concurrent.ConcurrentLinkedQueue<Double>();
    try(var pool=Executors.newFixedThreadPool(readers+(writing?1:0))) {
      List<java.util.concurrent.Future<?>> tasks=new ArrayList<>();
      for(int n=0;n<readers;n++) tasks.add(pool.submit(() -> {
        await(gate);
        for(String metric:List.of("AMOUNT","TONS","REPORT","REPORT")) readTimes.add(timed(() -> read(summary,metric)));
      }));
      if(writing) tasks.add(pool.submit(() -> {
        await(gate);
        for(int n=0;n<40;n++) {
          long id=100+n;
          writeTimes.add(timed(() -> transaction.executeWithoutResult(tx -> {
            jdbc.queryForList("SELECT id FROM activity WHERE id=1 FOR SHARE",Long.class);
            jdbc.queryForList("SELECT id FROM customer_order WHERE id=? FOR UPDATE",Long.class,id);
            jdbc.update("UPDATE order_item SET line_amount=line_amount+1 WHERE order_id=?",id);
            jdbc.update("UPDATE customer_order SET total_amount=total_amount+180 WHERE id=?",id);
            // Same synchronous maintenance in both read modes: measures isolation from dashboard load.
            store.refresh(id);
          })));
        }
      }));
      gate.countDown(); for(var task:tasks) task.get(5,TimeUnit.MINUTES);
    }
    var reads=readTimes.stream().sorted().toList();var writes=writeTimes.stream().sorted().toList();
    System.out.printf("SUMMARY_CONCURRENT summary=%s readers=%d writing=%s reads=%d readP95Ms=%.1f writes=%d writeP95Ms=%.1f%n",
        summary,readers,writing,reads.size(),reads.get((int)Math.ceil(reads.size()*.95)-1),writes.size(),
        writes.isEmpty()?0:writes.get((int)Math.ceil(writes.size()*.95)-1));
  }

  static void await(CountDownLatch latch) {
    try {if(!latch.await(15,TimeUnit.SECONDS))throw new IllegalStateException("gate timeout");}
    catch(InterruptedException e){Thread.currentThread().interrupt();throw new IllegalStateException(e);}
  }

  static void rebuildAll() {
    long after=0;
    while(true) {var batch=maintenance.rebuild(1,after,500,false); after=batch.nextAfterId(); if(batch.checked()<500) break;}
  }

  @Test @Order(6) void oneRefreshUsesOneCommittedSnapshotEvenWhenAnOrderCommitsMidQuery() throws Exception {
    var expected=normalized(candidate.report("summary","ORDER_DASHBOARD"));
    var once=new java.util.concurrent.atomic.AtomicBoolean();
    try(var pool=Executors.newSingleThreadExecutor()) {
      var interleaving=new JdbcTemplate(source) {
        @Override public java.util.Map<String,Object> queryForMap(String sql,Object... args) {
          var result=super.queryForMap(sql,args);
          if(once.compareAndSet(false,true)) {
            try {
              pool.submit(() -> transaction.executeWithoutResult(tx -> {
                jdbc.update("UPDATE customer_order SET total_amount=total_amount+180 WHERE id=15");
                jdbc.update("UPDATE order_item SET line_amount=line_amount+1 WHERE order_id=15");
                store.refresh(15);
              })).get(15,TimeUnit.SECONDS);
            } catch(Exception e) {throw new IllegalStateException(e);}
          }
          return result;
        }
      };
      var reader=new DashboardService(interleaving,activities,JSON,store);
      var snapshot=new TransactionTemplate(manager); snapshot.setIsolationLevel(TransactionDefinition.ISOLATION_REPEATABLE_READ);
      assertThat(normalized(snapshot.execute(tx -> reader.report("summary","ORDER_DASHBOARD")))).isEqualTo(expected);
      assertThat(normalized(candidate.report("summary","ORDER_DASHBOARD"))).isNotEqualTo(expected);
    }
    compareAll();
  }

  @Test @Order(7) void cleanSummariesSkipDetailLookupsInFallbackPlans() {
    rebuildAll();
    for (String sourceSql : List.of(DashboardSummaryStore.lineSource(true),
        DashboardSummaryStore.tonsSource(true, true), DashboardSummaryStore.tonsSource(true, false))) {
      String predicate = sourceSql.contains("is_gift_box") ? " WHERE is_gift_box=TRUE" : "";
      String plan = jdbc.queryForObject("""
          EXPLAIN ANALYZE WITH scoped_orders AS (
            SELECT id FROM customer_order WHERE activity_id=1 AND status='SUBMITTED'
          ), derived_items AS (%s) SELECT COUNT(*) FROM derived_items%s
          """.formatted(sourceSql, predicate), String.class);
      // Inspect the actual execution, not just estimated cost or the SQL string.
      // Only the raw fallback uses uk_product on alias i in this fixture schema.
      String detailLookup = plan.lines().filter(line -> line.contains("on i using uk_product")).findFirst().orElse("");
      assertThat(detailLookup).as("clean orders must not touch raw items: %s", plan)
          .contains("never executed");
      System.out.println("SUMMARY_CLEAN_FALLBACK_PLAN " + plan);
    }
  }

  static void compareAll() {
    for(String metric:List.of("AMOUNT","TONS")) for(String[] filter:new String[][]{
        {null,null},{"ALL",null},{"GENERAL",null},{"SPECIAL",null},{"GENERAL","NORTH"},
        {"GENERAL","SOUTH"},{"GENERAL",""},{"GENERAL","MISSING"}}) {
      assertThat(normalized(candidate.ranking("summary",filter[0],filter[1],metric)))
          .as("ranking %s %s %s",metric,filter[0],filter[1])
          .isEqualTo(normalized(baseline.ranking("summary",filter[0],filter[1],metric)));
    }
    assertThat(normalized(candidate.report("summary","ORDER_DASHBOARD")))
        .isEqualTo(normalized(baseline.report("summary","ORDER_DASHBOARD")));
  }

  static JsonNode normalized(Object value) {
    ObjectNode node=JSON.valueToTree(value);
    if(node.has("dashboard")) ((ObjectNode)node.get("dashboard")).remove("generatedAt"); else node.remove("generatedAt");
    return canonicalNumbers(node);
  }

  static JsonNode canonicalNumbers(JsonNode node) {
    if(node.isNumber()) return JSON.getNodeFactory().textNode("#"+node.decimalValue().stripTrailingZeros().toPlainString());
    if(node.isObject()) {
      var result=JSON.createObjectNode(); node.fields().forEachRemaining(e -> result.set(e.getKey(),canonicalNumbers(e.getValue()))); return result;
    }
    if(node.isArray()) {var result=JSON.createArrayNode();node.forEach(v -> result.add(canonicalNumbers(v)));return result;}
    return node;
  }

  @AfterAll static void close() {if(source!=null) source.close();}
}
