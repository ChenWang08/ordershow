package com.fengyi.ordershow.dashboard;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static com.fengyi.ordershow.dashboard.DashboardService.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fengyi.ordershow.activity.ActivityService;
import com.fengyi.ordershow.common.DomainException;
import java.math.BigDecimal;
import java.util.List;
import java.util.ArrayList;
import java.util.Map;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.aop.framework.ProxyFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.init.ScriptUtils;
import org.springframework.core.io.ClassPathResource;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.transaction.interceptor.TransactionInterceptor;
import org.springframework.transaction.annotation.AnnotationTransactionAttributeSource;

/** Fixed disposable schema only; never accepts a business database URL. */
@EnabledIfEnvironmentVariable(named="ORDER_SHOW_RANKING_FILTER_TEST", matches="order-show-e2e")
class RankingFiltersIntegrationTest {
  static final String DB = "order_show_ranking_filters_test";
  static final String URL = "jdbc:mysql://host.docker.internal:33306/";
  static final String OPT = "?allowPublicKeyRetrieval=true&useSSL=false&serverTimezone=UTC&rewriteBatchedStatements=true";
  static final ObjectMapper JSON = new ObjectMapper().findAndRegisterModules().disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
  static JdbcTemplate jdbc;
  static DriverManagerDataSource source;
  static DataSourceTransactionManager manager;
  static TransactionTemplate tx;
  ActivityService activities;
  RankingStore store;
  RankingService service;
  DashboardSummaryStore summaries;

  @BeforeAll static void setup() throws Exception {
    var root = new JdbcTemplate(new DriverManagerDataSource(URL+"order_show_e2e"+OPT,"root","e2e_root_only_not_for_business"));
    root.execute("DROP DATABASE IF EXISTS "+DB);
    root.execute("CREATE DATABASE "+DB+" CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci");
    source = new DriverManagerDataSource(URL+DB+OPT,"root","e2e_root_only_not_for_business");
    jdbc = new JdbcTemplate(source);
    assertThat(jdbc.queryForObject("SELECT DATABASE()",String.class)).isEqualTo(DB);
    manager = new DataSourceTransactionManager(source); tx = new TransactionTemplate(manager);
    tx.setIsolationLevel(org.springframework.transaction.TransactionDefinition.ISOLATION_READ_COMMITTED);
    jdbc.execute("CREATE TABLE activity(id BIGINT UNSIGNED PRIMARY KEY,status VARCHAR(20))");
    jdbc.execute("""
        CREATE TABLE customer_order(id BIGINT UNSIGNED PRIMARY KEY,activity_id BIGINT UNSIGNED,status VARCHAR(20),
          customer_type VARCHAR(16),region_code VARCHAR(64),dealer_full_name_snapshot VARCHAR(255),branch_name_snapshot VARCHAR(200),
          total_amount DECIMAL(18,2),total_quantity BIGINT UNSIGNED,last_submitted_at DATETIME(3),lock_version INT UNSIGNED NOT NULL DEFAULT 0,
          KEY idx_scope(activity_id,status,last_submitted_at),KEY idx_filter(activity_id,customer_type,region_code))
        """);
    jdbc.execute("""
        CREATE TABLE order_item(id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,order_id BIGINT UNSIGNED,
          activity_product_id BIGINT,product_line VARCHAR(200),variety_name VARCHAR(100),line_amount DECIMAL(18,2),quantity BIGINT,
          line_tons DECIMAL(18,6),ton_case_factor DECIMAL(18,8),is_gift_box BOOLEAN NOT NULL DEFAULT FALSE,
          UNIQUE KEY idx_product(order_id,activity_product_id))
        """);
    jdbc.execute("CREATE TABLE activity_customer(id BIGINT PRIMARY KEY,activity_id BIGINT,data_version_id BIGINT,customer_type VARCHAR(16),region_code VARCHAR(64),is_active BOOLEAN,customer_id BIGINT DEFAULT 0,normalized_branch_name VARCHAR(200) DEFAULT '',normalized_dealer_full_name VARCHAR(255) DEFAULT '')");
    jdbc.execute("CREATE TABLE activity_product(id BIGINT PRIMARY KEY,activity_id BIGINT,data_version_id BIGINT,product_line VARCHAR(200),variety_name VARCHAR(100),customer_type VARCHAR(16) DEFAULT 'ALL')");
    jdbc.execute("CREATE TABLE activity_product_branch_scope(activity_product_id BIGINT,normalized_branch_name VARCHAR(200))");
    jdbc.execute("CREATE TABLE activity_product_dealer_scope(activity_product_id BIGINT,normalized_branch_name VARCHAR(200))");
    jdbc.execute("CREATE TABLE activity_product_dealer_member(activity_product_id BIGINT,normalized_branch_name VARCHAR(200),customer_id BIGINT,customer_type VARCHAR(16),normalized_dealer_full_name VARCHAR(255))");
    jdbc.execute("CREATE TABLE activity_data_binding(activity_id BIGINT,data_type VARCHAR(20),current_version_id BIGINT)");
    jdbc.execute("CREATE TABLE activity_region(id BIGINT PRIMARY KEY,activity_id BIGINT,region_code VARCHAR(64),region_name VARCHAR(100))");
    jdbc.execute("CREATE TABLE domain_event_outbox(id BIGINT PRIMARY KEY,activity_id BIGINT)");
    jdbc.execute("CREATE TABLE activity_dashboard_snapshot(activity_id BIGINT,snapshot_key VARCHAR(200),payload_json JSON)");
    String old = new String(new ClassPathResource("db/migration/V040__dashboard_order_summaries.sql").getInputStream().readAllBytes(), java.nio.charset.StandardCharsets.UTF_8).split("-- Mark only")[0];
    for (String statement : old.split(";")) if (!statement.isBlank()) jdbc.execute(statement);
    try (var connection = source.getConnection()) {
      ScriptUtils.executeSqlScript(connection,new ClassPathResource("db/migration/V044__ranking_filters.sql"));
    }
  }

  @BeforeEach void seed() throws Exception {
    for (String table : List.of("activity_product_branch_scope","activity_product_dealer_scope","activity_product_dealer_member","activity_ranking_snapshot",
        "order_dashboard_product_line_stat","order_dashboard_stat","order_item","customer_order","activity_customer",
        "activity_product","activity_data_binding","activity_region","domain_event_outbox","activity_dashboard_snapshot","activity")) jdbc.update("DELETE FROM "+table);
    jdbc.update("INSERT INTO activity VALUES(1,'ACTIVE'),(2,'ACTIVE')");
    jdbc.update("INSERT INTO activity_region VALUES(1,1,'EAST','华东'),(2,1,'WEST','华西')");
    jdbc.update("INSERT INTO activity_data_binding VALUES(1,'WHITELIST',1),(1,'PRODUCT',1)");
    jdbc.update("INSERT INTO activity_customer(id,activity_id,data_version_id,customer_type,region_code,is_active) VALUES(1,1,1,'SPECIAL','EAST',TRUE),(2,1,1,'ALL','WEST',TRUE),(3,1,1,'GENERAL',NULL,TRUE),(4,1,0,'GENERAL','OLD',TRUE)");
    jdbc.update("INSERT INTO activity_product(id,activity_id,data_version_id,product_line,variety_name) VALUES(1,1,1,'未订项目','未订品种'),(2,1,0,'旧目录','旧目录')");
    order(1,1,"SPECIAL","EAST",1000); order(2,1,"GENERAL","EAST",700); order(3,1,"ALL","WEST",50);
    order(4,1,"GENERAL",null,40); order(5,1,"GENERAL",null,30); order(6,2,"SPECIAL","EAST",9999);
    order(7,1,"SPECIAL","EAST",600); jdbc.update("UPDATE customer_order SET status='VOIDED' WHERE id=7");
    item(1,1,"项目A","品种A",800,8,"0.1","0.8"); item(1,2,"项目B","品种B",200,2,"1","2");
    item(2,1,"项目A","品种A",100,1,"1","1"); item(2,2,"项目A","品种,B",600,6,null,null);
    item(3,1,null,null,50,5,null,"0"); item(4,1,"其他","ALL",40,4,"1","0"); item(5,1,"项目A","品种A",30,3,null,null);
    item(6,1,"项目A","品种A",9999,9,"1","9"); item(7,1,"项目A","品种A",600,6,"1","6");
    jdbc.update("INSERT INTO domain_event_outbox VALUES(1,1),(2,2)");
    activities = mock(ActivityService.class); store = new RankingStore(jdbc,JSON); configure(true); status("ACTIVE");
  }

  void configure(boolean summary) {
    summaries = new DashboardSummaryStore(jdbc,summary,"");
    var proxy = new ProxyFactory(new RankingService(jdbc,activities,store,summaries));
    proxy.addAdvice(new TransactionInterceptor(manager,new AnnotationTransactionAttributeSource()));
    service = (RankingService) proxy.getProxy();
  }
  void status(String status) throws Exception {
    jdbc.update("UPDATE activity SET status=? WHERE id=1",status);
    var activity = JSON.readValue("""
        {"id":1,"code":"filter","name":"四维测试","status":"%s","companyRankingTopN":2,"branchRankingTopN":2,
         "regions":[],"timezone":"Asia/Shanghai","startsAt":"2026-01-01T00:00:00Z","endsAt":"2099-01-01T00:00:00Z"}
        """.formatted(status),ActivityService.ActivityView.class);
    when(activities.byCode("filter")).thenReturn(activity);
  }
  static void order(long id,long activity,String type,String region,int amount) {
    jdbc.update("INSERT INTO customer_order VALUES(?,?,'SUBMITTED',?,?,?, ?,?,10,'2026-10-30 00:00:00',0)",id,activity,type,region,"客户"+id,"分公司"+(id%2),amount);
  }
  static void item(long order,int product,String line,String variety,int amount,int qty,String factor,String tons) {
    jdbc.update("INSERT INTO order_item(order_id,activity_product_id,product_line,variety_name,line_amount,quantity,ton_case_factor,line_tons) VALUES(?,?,?,?,?,?,?,?)",
        order,product,line,variety,amount,qty,factor==null?null:new BigDecimal(factor),tons==null?null:new BigDecimal(tons));
  }
  RankingFilter filter(String type,String region,String line,List<String> varieties,RankingMetric metric) {
    return new RankingFilter(type,region,false,line,false,varieties,false,metric);
  }
  Dashboard read(RankingFilter f) { return service.ranking("filter",f); }
  void rebuild() { tx.executeWithoutResult(s -> jdbc.queryForList("SELECT id FROM customer_order",Long.class).forEach(summaries::refresh)); }
  static void total(Dashboard d,String key,String value) { assertThat(new BigDecimal(d.totals().get(key).toString())).isEqualByComparingTo(value); }
  static Object business(Dashboard d) { return List.of(d.totals(),d.companies(),d.branches(),d.version()); }

  @Test void exactTotalsAndRankingAreEquivalentAcrossRawMissingAndCleanSummaries() {
    var filters = List.of(filter(null,null,null,null,RankingMetric.AMOUNT),filter(null,null,null,null,RankingMetric.TONS),
        filter("SPECIAL","EAST","项目A",List.of("品种A"),RankingMetric.AMOUNT),
        filter(null,null,"项目A",List.of("品种A","品种,B"),RankingMetric.TONS),
        filter(null,null,"项目B",List.of("品种A"),RankingMetric.AMOUNT),
        new RankingFilter(null,null,false,null,true,null,true,RankingMetric.AMOUNT));
    configure(false); var expected = filters.stream().map(f -> business(read(f))).toList();
    configure(true); assertThat(filters.stream().map(f -> business(read(f))).toList()).isEqualTo(expected);
    rebuild(); assertThat(filters.stream().map(f -> business(read(f))).toList()).isEqualTo(expected);
    var all = read(filters.getFirst()); total(all,"total_amount","1820"); total(all,"order_count","5");
    total(all,"total_tons","3.8"); assertThat(all.companies()).hasSize(2);
    var partial = read(filter("SPECIAL","EAST","项目A",List.of("品种A"),RankingMetric.AMOUNT));
    total(partial,"total_amount","800"); total(partial,"total_quantity","8"); total(partial,"total_tons","0.8");
    assertThat(read(filters.get(4)).companies()).isEmpty();
    total(read(filters.get(5)),"total_amount","50");
    total(read(new RankingFilter(null,null,true,null,true,null,true,RankingMetric.AMOUNT)),"total_amount","0");
    assertThat(read(filter(null,null,"项目A",List.of("品种A"),RankingMetric.AMOUNT)).companies().getFirst().name()).isEqualTo("客户1");
    assertThat(read(filter(null,null,"项目A",List.of("品种A"),RankingMetric.TONS)).companies().getFirst().name()).isEqualTo("客户2");
  }

  @Test void productRankingReadsCurrentDetailsAndLiteralEmptyLabelsStayDistinct() {
    rebuild();
    jdbc.update("UPDATE order_item SET line_amount=900 WHERE order_id=1 AND activity_product_id=1");
    jdbc.update("UPDATE customer_order SET lock_version=lock_version+1,total_amount=1100 WHERE id=1");
    var f = filter("SPECIAL",null,"项目A",List.of("品种A"),RankingMetric.AMOUNT);
    total(read(f),"total_amount","900");
    tx.executeWithoutResult(s -> summaries.refresh(1)); total(read(f),"total_amount","900");
    total(read(filter(null,null,"其他",List.of("ALL"),RankingMetric.TONS)),"total_amount","40");
    assertThat(read(filter(null,null,"其他",List.of("ALL"),RankingMetric.TONS)).companies()).hasSize(1);
    total(read(new RankingFilter(null,null,false,null,false,List.of("品种,B"),true,RankingMetric.AMOUNT)),"total_amount","650");
  }

  @Test void optionsReadActualFieldsAcrossAllCustomerTypesAndDoNotBuildStatistics() {
    var options = service.options("filter");
    assertThat(options.customers()).contains(new RankingStore.CustomerOption("SPECIAL","EAST","华东"),new RankingStore.CustomerOption("ALL","WEST","华西"));
    assertThat(options.customers()).noneMatch(c -> "OLD".equals(c.regionCode()));
    assertThat(options.products()).contains(new RankingStore.ProductOption("未订项目","未订品种"),new RankingStore.ProductOption("项目A","品种,B"));
    assertThat(options.products()).noneMatch(p -> "旧目录".equals(p.productLine()));
    assertThat(store.hasSnapshot(1)).isFalse();
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM order_dashboard_stat",Integer.class)).isZero();
  }

  @Test void optionsCascadeByActualCustomerAndRegionWhileKeepingUnorderedApplicableCatalog() throws Exception {
    jdbc.update("INSERT INTO activity_product VALUES(10,1,1,'综合项目','未订综合','GENERAL'),(11,1,1,'特渠项目','未订特渠','SPECIAL'),(12,1,1,'范围项目','限定客户','SPECIAL')");
    jdbc.update("UPDATE activity_customer SET customer_id=101,normalized_branch_name='eastbranch',normalized_dealer_full_name='eastdealer' WHERE id=1");
    jdbc.update("INSERT INTO activity_product_branch_scope VALUES(12,'eastbranch')");
    jdbc.update("INSERT INTO activity_product_dealer_scope VALUES(12,'eastbranch')");
    var special = filter("SPECIAL","EAST",null,null,RankingMetric.AMOUNT);
    var general = new RankingFilter("GENERAL",null,true,null,false,null,false,null);
    assertThat(service.options("filter",general).products()).contains(new RankingStore.ProductOption("综合项目","未订综合"))
        .doesNotContain(new RankingStore.ProductOption("特渠项目","未订特渠"));
    assertThat(service.options("filter",special).products()).contains(new RankingStore.ProductOption("未订项目","未订品种"),
        new RankingStore.ProductOption("特渠项目","未订特渠"),new RankingStore.ProductOption("项目B","品种B"))
        .doesNotContain(new RankingStore.ProductOption("综合项目","未订综合"),new RankingStore.ProductOption("范围项目","限定客户"),new RankingStore.ProductOption("项目A","品种,B"));
    jdbc.update("INSERT INTO activity_product_dealer_member VALUES(12,'eastbranch',101,'SPECIAL','eastdealer')");
    assertThat(service.options("filter",special).products()).contains(new RankingStore.ProductOption("范围项目","限定客户"));
    assertThat(service.options("filter",filter("SPECIAL","WEST",null,null,null)).products()).isEmpty();
    assertThat(store.hasSnapshot(1)).isFalse();
    var expected = service.options("filter",special);
    status("FINISHED"); tx.executeWithoutResult(s -> store.capture(1)); status("ARCHIVED");
    jdbc.update("UPDATE activity_product SET variety_name='今天的新名称' WHERE id=11");
    jdbc.update("DELETE FROM activity_product_dealer_member");
    assertThat(service.options("filter",special)).isEqualTo(expected);
    assertThat(service.options("filter",general).products()).contains(new RankingStore.ProductOption("综合项目","未订综合"))
        .doesNotContain(new RankingStore.ProductOption("特渠项目","未订特渠"));
  }

  @Test void blankRegionAndProductFiltersAgreeAcrossLiveAndNewHistory() throws Exception {
    order(8,1,"SPECIAL","   ",20); item(8,1,"   ","",20,2,"1","2");
    order(9,1,"SPECIAL","",10); item(9,1,"项目A","品种A",10,1,"1","1");
    order(10,1,"SPECIAL",null,5); item(10,1,null,null,5,1,"1","1");
    var blank = new RankingFilter("SPECIAL",null,true,null,false,null,false,null);
    var products = new RankingFilter("SPECIAL",null,true,null,true,null,true,null);
    total(read(blank),"total_amount","35"); total(read(products),"total_amount","25");
    var live = read(blank);
    assertThat(service.options("filter",blank).products()).contains(new RankingStore.ProductOption(null,null));
    status("FINISHED"); total(read(blank),"total_amount","35"); total(read(products),"total_amount","25");
    assertThat(read(blank).companies()).isEqualTo(live.companies());
    status("ARCHIVED"); total(read(blank),"total_amount","35");
  }

  @Test void oldFrozenOptionsRemainReadableWithoutInventingOrRewritingScopedHistory() throws Exception {
    var expected = service.options("filter");
    status("FINISHED"); tx.executeWithoutResult(s -> store.capture(1)); status("ARCHIVED");
    jdbc.update("UPDATE activity_ranking_snapshot SET options_json=JSON_REMOVE(options_json,'$.scopes') WHERE activity_id=1");
    var saved = jdbc.queryForObject("SELECT CAST(options_json AS CHAR) FROM activity_ranking_snapshot WHERE activity_id=1",String.class);
    assertThat(service.options("filter")).isEqualTo(expected);
    assertThatThrownBy(() -> service.options("filter",filter("SPECIAL","EAST",null,null,null)))
        .isInstanceOfSatisfying(DomainException.class,e -> assertThat(e.code()).isEqualTo("RANKING_OPTIONS_SCOPE_UNAVAILABLE"));
    assertThat(jdbc.queryForObject("SELECT CAST(options_json AS CHAR) FROM activity_ranking_snapshot WHERE activity_id=1",String.class)).isEqualTo(saved);
  }

  @Test void finishedRefreshesAndArchivedRemainsFrozenIncludingOptions() throws Exception {
    status("FINISHED");
    var f = filter("SPECIAL","EAST","项目A",List.of("品种A"),RankingMetric.AMOUNT);
    total(read(f),"total_amount","800");
    jdbc.update("UPDATE order_item SET line_amount=900 WHERE order_id=1 AND activity_product_id=1");
    jdbc.update("UPDATE customer_order SET total_amount=1100,lock_version=1 WHERE id=1");
    tx.executeWithoutResult(s -> store.capture(1)); total(read(f),"total_amount","900");
    status("ARCHIVED"); var frozen = read(f); var options = service.options("filter");
    jdbc.update("UPDATE order_item SET line_amount=999 WHERE order_id=1 AND activity_product_id=1");
    jdbc.update("UPDATE customer_order SET total_amount=1199 WHERE id=1");
    tx.executeWithoutResult(s -> store.capture(1));
    assertThat(read(f)).isEqualTo(frozen);
    assertThat(service.options("filter")).isEqualTo(options);
    status("ACTIVE"); jdbc.update("DELETE FROM activity_ranking_snapshot WHERE activity_id=1");
    total(read(f),"total_amount","999");
  }

  @Test void legacyAmountSnapshotCanOmitZeroTonsWithoutRewritingFrozenJson() throws Exception {
    var filter=filter(null,"WEST",null,null,RankingMetric.AMOUNT);
    com.fasterxml.jackson.databind.node.ObjectNode frozen=JSON.valueToTree(read(filter));
    for(var row:frozen.path("companies"))((com.fasterxml.jackson.databind.node.ObjectNode)row).remove("tons");
    String payload=JSON.writeValueAsString(frozen);
    jdbc.update("INSERT INTO activity_dashboard_snapshot VALUES(1,'RANKING:ALL:WEST',CAST(? AS JSON))",payload);
    String saved=jdbc.queryForObject("SELECT CAST(payload_json AS CHAR) FROM activity_dashboard_snapshot",String.class);
    status("ARCHIVED");
    total(read(filter),"total_amount","50");
    assertThat(store.hasSnapshot(1)).isTrue();
    assertThat(jdbc.queryForObject("SELECT CAST(payload_json AS CHAR) FROM activity_dashboard_snapshot",String.class)).isEqualTo(saved);
  }

  @Test void missingLegacyTonsCannotHideNonzeroTonsOrWeakenTonsRankingChecks() throws Exception {
    for(var metric:List.of(RankingMetric.AMOUNT,RankingMetric.TONS)){
      if(metric==RankingMetric.TONS)jdbc.update("UPDATE customer_order SET region_code='ZERO' WHERE id=4");
      var filter=filter(metric==RankingMetric.AMOUNT?"SPECIAL":"GENERAL",
          metric==RankingMetric.AMOUNT?"EAST":"ZERO",null,null,metric);
      com.fasterxml.jackson.databind.node.ObjectNode frozen=JSON.valueToTree(read(filter));
      for(var row:frozen.path("companies"))((com.fasterxml.jackson.databind.node.ObjectNode)row).remove("tons");
      String key=(metric==RankingMetric.AMOUNT?"RANKING:SPECIAL:EAST":"RANKING_TONS:GENERAL:ZERO");
      jdbc.update("INSERT INTO activity_dashboard_snapshot VALUES(1,?,CAST(? AS JSON))",key,JSON.writeValueAsString(frozen));
      status("ARCHIVED");
      assertThatThrownBy(()->read(filter)).isInstanceOfSatisfying(DomainException.class,
          e->assertThat(e.code()).isEqualTo("RANKING_HISTORY_MISMATCH"));
      assertThat(store.hasSnapshot(1)).isFalse();
      jdbc.update("DELETE FROM activity_dashboard_snapshot");status("ACTIVE");
    }
  }

  @Test void oldHistoryMismatchIsRejectedWithoutReplacingOldSnapshot() throws Exception {
    var all = read(filter(null,null,null,null,RankingMetric.AMOUNT));
    jdbc.update("INSERT INTO activity_dashboard_snapshot VALUES(1,'RANKING:ALL:ALL',CAST(? AS JSON))",JSON.writeValueAsString(all));
    status("ARCHIVED");
    jdbc.update("UPDATE customer_order SET total_amount=total_amount+1 WHERE id=1");
    assertThatThrownBy(() -> read(filter(null,null,null,null,RankingMetric.AMOUNT))).isInstanceOf(DomainException.class);
    assertThat(store.hasSnapshot(1)).isFalse();
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM activity_dashboard_snapshot",Integer.class)).isEqualTo(1);
  }

  @Test void oldHistoryDetectsRedistributionEvenWhenGrandTotalsMatch() throws Exception {
    var old=read(filter(null,null,null,null,RankingMetric.AMOUNT));
    jdbc.update("INSERT INTO activity_dashboard_snapshot VALUES(1,'RANKING:ALL:ALL',CAST(? AS JSON))",JSON.writeValueAsString(old));
    status("ARCHIVED");
    jdbc.update("UPDATE customer_order SET total_amount=total_amount+CASE WHEN id=1 THEN -100 ELSE 100 END WHERE id IN(1,2)");
    assertThatThrownBy(() -> read(filter(null,null,null,null,RankingMetric.AMOUNT))).isInstanceOf(DomainException.class);
    assertThat(store.hasSnapshot(1)).isFalse();
  }

  @Test void concurrentFirstHistoricalReadsReconcileAndCreateOneFrozenBasis() throws Exception {
    var f = filter(null,null,null,null,RankingMetric.AMOUNT);
    var expected = read(f);
    jdbc.update("INSERT INTO activity_dashboard_snapshot VALUES(1,'RANKING:ALL:ALL',CAST(? AS JSON))",JSON.writeValueAsString(expected));
    status("ARCHIVED");
    try (var pool = Executors.newFixedThreadPool(4)) {
      var start = new CountDownLatch(1);
      var tasks = new ArrayList<Future<Dashboard>>();
      for (int i=0;i<4;i++) tasks.add(pool.submit(() -> { start.await(); return read(f); }));
      start.countDown();
      for (var task : tasks) assertThat(business(task.get(30,TimeUnit.SECONDS))).isEqualTo(business(expected));
    }
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM activity_ranking_snapshot",Integer.class)).isEqualTo(1);
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM activity_ranking_order_snapshot",Integer.class)).isEqualTo(5);
  }

  @Test void onlyOriginalLiveSummariesAreRequiredAndMaintained() {
    assertThat(jdbc.queryForObject("""
        SELECT COUNT(*) FROM information_schema.tables
        WHERE table_schema=DATABASE() AND table_name IN ('order_ranking_stat','order_ranking_product_stat')
        """,Integer.class)).isZero();
    rebuild();
    assertThat(jdbc.queryForObject("SELECT item_count FROM order_dashboard_stat WHERE order_id=1",Integer.class)).isEqualTo(2);
    assertThat(jdbc.queryForObject("SELECT SUM(line_amount) FROM order_dashboard_product_line_stat WHERE order_id=1",BigDecimal.class)).isEqualByComparingTo("1000");
    total(read(filter(null,null,null,null,RankingMetric.AMOUNT)),"total_tons","3.8");
    total(read(filter("SPECIAL",null,"项目A",List.of("品种A"),RankingMetric.AMOUNT)),"total_amount","800");
  }
}
