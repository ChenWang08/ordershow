package com.fengyi.ordershow.lottery;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengyi.ordershow.activity.ActivityService;
import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.security.AdminPrincipal;
import com.fengyi.ordershow.storage.StorageService;
import java.math.BigDecimal;
import java.util.List;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.PreparedStatementCreator;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;

/** Full migrations and real SQL, on a fixed disposable database only. */
@EnabledIfEnvironmentVariable(named="ORDER_SHOW_LOTTERY_TEST",matches="order-show-lottery-test")
class LotteryIntegrationTest {
  static final String URL="jdbc:mysql://host.docker.internal:33316/order_show_lottery_test?allowPublicKeyRetrieval=true&useSSL=false&serverTimezone=UTC&rewriteBatchedStatements=true";
  static JdbcTemplate jdbc;
  static TransactionTemplate tx;
  static long nextActivity=100;
  static final ObjectMapper JSON=new ObjectMapper().findAndRegisterModules();
  final AdminPrincipal admin=new AdminPrincipal(1,"test","test","SUPER_ADMIN",null,null,false);
  LotteryService service;
  long activity,base;

  @BeforeAll static void migrate() {
    var source=new DriverManagerDataSource(URL,"root","lottery_only_root");
    // Fixed test-only schema and credentials; never use application database settings here.
    var server=new JdbcTemplate(new DriverManagerDataSource(URL.replace("/order_show_lottery_test?","/?"),"root","lottery_only_root"));
    server.execute("DROP DATABASE IF EXISTS order_show_lottery_test");
    server.execute("CREATE DATABASE order_show_lottery_test CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci");
    jdbc=new JdbcTemplate(source);
    assertThat(jdbc.queryForObject("SELECT DATABASE()",String.class)).isEqualTo("order_show_lottery_test");
    Flyway.configure().dataSource(source).locations("classpath:db/migration").target("44").load().migrate();
    jdbc.update("INSERT INTO admin_user(id,username,display_name,password_hash,role_code) VALUES(1,'test','test','unused','SUPER_ADMIN')");
    jdbc.update("INSERT INTO activity(id,department_id,activity_code,name,status,starts_at,ends_at,created_by,updated_by) VALUES(1,1,'old-lottery','old','ACTIVE','2026-01-01','2099-01-01',1,1)");
    jdbc.update("INSERT INTO lottery_rule(id,activity_id,name,created_by,updated_by) VALUES(1,1,'old',1,1)");
    jdbc.update("INSERT INTO lottery_round(activity_id,lottery_rule_id,round_no,name,prize_name,winner_count,candidate_scope,qualification_metric) VALUES(1,1,1,'old','prize',1,'VALID_ORDERS','BOX_COUNT')");
    Flyway.configure().dataSource(source).locations("classpath:db/migration").load().migrate();
    assertThat(jdbc.queryForObject("SELECT minimum_order_tons FROM lottery_round WHERE activity_id=1",BigDecimal.class)).isEqualByComparingTo("0");
    assertThat(jdbc.queryForObject("SELECT product_line IS NULL AND varieties_json IS NULL FROM lottery_round WHERE activity_id=1",Boolean.class)).isTrue();
    tx=new TransactionTemplate(new DataSourceTransactionManager(source));
  }

  @SuppressWarnings("unchecked")
  @BeforeEach void fixture() throws Exception {
    activity=++nextActivity; base=activity*10;
    jdbc.update("INSERT INTO activity(id,department_id,activity_code,name,status,starts_at,ends_at,created_by,updated_by) VALUES(?,1,?,'lottery','ACTIVE','2026-01-01','2099-01-01',1,1)",activity,"LOTTERY-"+activity);
    for(int i=1;i<=2;i++) {
      long id=base+i; String type=i==1?"PRODUCT":"WHITELIST";
      jdbc.update("INSERT INTO stored_file(id,activity_id,storage_provider,bucket_name,object_key,original_filename,content_type,size_bytes,sha256,file_purpose) VALUES(?,?,'MINIO','test',?,'test','application/octet-stream',0,UNHEX(SHA2('test',256)),'OTHER')",id,activity,"test-"+id);
      jdbc.update("INSERT INTO import_task(id,activity_id,import_type,status,source_file_id,file_sha256,created_by) VALUES(?,?,?,'COMPLETED',?,UNHEX(SHA2('test',256)),1)",id,activity,type,id);
      jdbc.update("INSERT INTO import_publish_version(id,activity_id,data_type,version_no,source_import_task_id,status,created_by) VALUES(?,?,?,1,?,'PUBLISHED',1)",id,activity,type,id);
      jdbc.update("INSERT INTO activity_data_binding VALUES(?,?,?,0,1,UTC_TIMESTAMP(3))",activity,type,id);
    }
    for(int i=1;i<=4;i++) {
      long id=base+i; String type=i==2?"SPECIAL":i==3?"ALL":"GENERAL";
      jdbc.update("INSERT INTO customer(id,customer_type,dealer_full_name,normalized_dealer_full_name) VALUES(?,?,?,?)",id,type,"客户"+id,"customer"+id);
      jdbc.update("INSERT INTO activity_customer(id,activity_id,customer_id,customer_type,dealer_full_name,normalized_dealer_full_name,source_import_task_id,data_version_id,phone_masked,phone_lookup_hash) VALUES(?,?,?,?,?,?,?,?,'139****0000',UNHEX(SHA2(?,256)))",id,activity,id,type,"客户"+id,"customer"+id,base+2,base+2,"phone"+id);
    }
    String[] lines={"项目A","项目A","项目B",null}; String[] varieties={"品种A","品种,B","品种B",null};
    for(int i=0;i<4;i++) jdbc.update("INSERT INTO activity_product(id,activity_id,customer_type,rebate_status,business_key,material_name,product_line,variety_name,case_price,ton_case_factor,source_import_task_id,data_version_id) VALUES(?,?,'ALL','ALL',?,'test',?,?,100,10,?,?)",base+i+1,activity,"P"+i,lines[i],varieties[i],base+1,base+1);
    order(1,"GENERAL",1000,10,"0.8"); order(2,"SPECIAL",50,5,"0.5"); order(3,"ALL",0,1,"0"); order(4,"GENERAL",1000,1,"1");
    item(1,1,"项目A","品种A",100,1,"10","0.1"); item(1,2,"项目A","品种,B",200,2,null,null); item(1,3,"项目B","品种B",700,7,"10","0.7");
    item(2,1,"项目A","品种A",50,5,"10","0.5"); item(3,4,null,null,0,1,"10","0"); item(4,1,"项目A","品种A",1000,1,"1","1");
    jdbc.update("UPDATE customer_order SET status='WITHDRAWN' WHERE id=?",base+4);
    var activities=mock(ActivityService.class);
    when(activities.byId(activity)).thenReturn(JSON.readValue("{\"id\":"+activity+",\"status\":\"ACTIVE\",\"regions\":[]}",ActivityService.ActivityView.class));
    var redis=mock(StringRedisTemplate.class); ValueOperations<String,String> ops=mock(ValueOperations.class);
    when(redis.opsForValue()).thenReturn(ops); when(ops.setIfAbsent(anyString(),anyString(),any(java.time.Duration.class))).thenReturn(true);
    service=new LotteryService(jdbc,redis,JSON,activities,mock(StorageService.class));
  }
  void order(int n,String type,int amount,int quantity,String tons) {
    jdbc.update("INSERT INTO customer_order(id,activity_id,activity_customer_id,order_no,status,customer_type,dealer_full_name_snapshot,current_version_no,total_quantity,total_tons,total_amount,first_submitted_at,last_submitted_at,last_modified_at) VALUES(?,?,?,?,'SUBMITTED',?,'customer',1,?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",base+n,activity,base+n,"O"+(base+n),type,quantity,new BigDecimal(tons),amount);
  }
  void item(int order,int product,String line,String variety,int amount,int quantity,String factor,String tons) {
    jdbc.update("INSERT INTO order_item(order_id,activity_product_id,line_no,material_name,product_line,variety_name,rebate_status,is_gift_box,quantity,case_price,line_amount,ton_case_factor,line_tons) VALUES(?,?,?,'test',?,?,'ALL',FALSE,?,100,?,?,?)",base+order,base+product,product,line,variety,quantity,amount,factor==null?null:new BigDecimal(factor),tons==null?null:new BigDecimal(tons));
  }
  LotteryService.PreviewRequest preview(String metric,String threshold,String type,String line,List<String> varieties,String mode) {
    return new LotteryService.PreviewRequest(1,10,"VALID_ORDERS",type,metric.equals("AMOUNT")?new BigDecimal(threshold):BigDecimal.ZERO,metric,mode,metric.equals("BOX_COUNT")?Long.parseLong(threshold):0,false,metric.equals("TONS")?new BigDecimal(threshold):BigDecimal.ZERO,line,varieties,false,false);
  }
  LotteryService.RoundWrite round(String metric,String threshold,String line,List<String> varieties) {
    return round(metric,threshold,line,varieties,"ORDER_AMOUNT_WEIGHTED");
  }
  LotteryService.RoundWrite round(String metric,String threshold,String line,List<String> varieties,String mode) {
    var p=preview(metric,threshold,"ALL",line,varieties,mode);
    return new LotteryService.RoundWrite("第一轮","奖品",10,p.candidateScope(),p.customerType(),p.minimumOrderAmount(),p.qualificationMetric(),p.probabilityMode(),p.minimumOrderBoxCount(),null,false,"FULL_NAME",null,p.minimumOrderTons(),p.productLine(),p.varieties(),false,false);
  }
  LotteryService.RuleView publish(LotteryService.RoundWrite round) {
    // Seed historical mixed amount/threshold combinations directly, as an upgrade would retain them.
    boolean legacy=round.probabilityMode().equals("ORDER_AMOUNT_WEIGHTED")&&!round.qualificationMetric().equals("AMOUNT");
    var write=legacy?round(round.qualificationMetric(),round.qualificationMetric().equals("TONS")?round.minimumOrderTons().toPlainString():Long.toString(round.minimumOrderBoxCount()),round.productLine(),round.varieties(),"EQUAL"):round;
    return tx.execute(status->{var rule=service.create(activity,new LotteryService.RuleWrite("规则",List.of(write)),admin);
      if(legacy)jdbc.update("UPDATE lottery_round SET probability_mode='ORDER_AMOUNT_WEIGHTED' WHERE lottery_rule_id=?",rule.id());
      return service.publish(activity,rule.id(),admin);});
  }
  @Test void sameItemIntersectionAndLiteralCommaNamesAndCustomerTypes() {
    var result=service.preview(activity,preview("AMOUNT","100","ALL","项目A",List.of("品种A"),"ORDER_AMOUNT_WEIGHTED"));
    assertThat(result.candidates()).extracting(LotteryService.CandidatePreviewItem::activityCustomerId).containsExactly(base+1);
    assertThat(result.totalCandidateOrderAmount()).isEqualByComparingTo("100");
    assertThat(service.preview(activity,preview("AMOUNT","0","ALL","项目A",List.of("品种B"),"EQUAL")).candidateCount()).isZero();
    assertThat(service.preview(activity,preview("AMOUNT","0","ALL","项目A",List.of("品种,B"),"EQUAL")).totalCandidateOrderAmount()).isEqualByComparingTo("200");
    assertThat(service.preview(activity,preview("AMOUNT","0","SPECIAL","项目A",List.of(),"EQUAL")).candidates()).extracting(LotteryService.CandidatePreviewItem::activityCustomerId).containsExactly(base+2);
  }
  @Test void boxesTonsPrecisionMissingAndZeroThreshold() {
    assertThat(service.preview(activity,preview("BOX_COUNT","4","ALL","项目A",List.of(),"EQUAL")).candidateCount()).isEqualTo(1);
    var tons=service.preview(activity,preview("TONS","0.100001","ALL","项目A",List.of(),"EQUAL"));
    assertThat(tons.candidates()).extracting(LotteryService.CandidatePreviewItem::activityCustomerId).containsExactly(base+2);
    assertThat(tons.missingTonnageCustomers()).isEqualTo(1);
    assertThat(service.preview(activity,preview("TONS","0.1","ALL","项目A",List.of(),"EQUAL")).candidateCount()).isEqualTo(2);
    assertThat(service.preview(activity,preview("TONS","0","ALL",null,List.of(),"EQUAL")).candidateCount()).isEqualTo(3);
    assertThatThrownBy(()->service.preview(activity,preview("TONS","0.0000001","ALL",null,List.of(),"EQUAL"))).isInstanceOf(DomainException.class);
  }
  @Test void allProductsPreservesWholeOrderAndWeightedSubtotal() {
    var result=service.preview(activity,preview("AMOUNT","0","ALL",null,List.of(),"ORDER_AMOUNT_WEIGHTED"));
    assertThat(result.candidateCount()).isEqualTo(2); assertThat(result.totalCandidateOrderAmount()).isEqualByComparingTo("1050");
    result=service.preview(activity,preview("AMOUNT","0","ALL","项目A",List.of(),"ORDER_AMOUNT_WEIGHTED"));
    assertThat(result.totalCandidateOrderAmount()).isEqualByComparingTo("350");
    assertThat(result.candidates().getFirst().probabilityPercent()).isEqualByComparingTo("85.71428571");
  }
  @Test void boxesWeightingUsesMatchedBoxesRatherThanAmountAndAppliesThresholdBeforeWeightTotal() {
    var result=service.preview(activity,preview("BOX_COUNT","0","ALL","项目A",List.of(),"ORDER_BOX_COUNT_WEIGHTED"));
    assertThat(result.weightMetric()).isEqualTo("BOX_COUNT");assertThat(result.totalCandidateWeight()).isEqualByComparingTo("8");
    assertThat(result.totalCandidateOrderAmount()).isEqualByComparingTo("350");
    assertThat(result.candidates().getFirst().probabilityPercent()).isEqualByComparingTo("37.5");
    assertThat(result.candidates().getLast().probabilityPercent()).isEqualByComparingTo("62.5");
    result=service.preview(activity,preview("BOX_COUNT","5","ALL","项目A",List.of(),"ORDER_BOX_COUNT_WEIGHTED"));
    assertThat(result.candidates()).extracting(LotteryService.CandidatePreviewItem::activityCustomerId).containsExactly(base+2);
    assertThat(result.totalCandidateWeight()).isEqualByComparingTo("5");assertThat(result.candidates().getFirst().probabilityPercent()).isEqualByComparingTo("100");
    result=service.preview(activity,preview("BOX_COUNT","0","ALL",null,List.of(),"ORDER_BOX_COUNT_WEIGHTED"));
    assertThat(result.candidateCount()).isEqualTo(3);assertThat(result.totalCandidateWeight()).isEqualByComparingTo("16");
    assertThat(result.candidates().getLast().qualifyingOrderAmount()).isZero();
    assertThat(service.preview(activity,preview("BOX_COUNT","0","SPECIAL","项目A",List.of("品种A"),"ORDER_BOX_COUNT_WEIGHTED")).candidateCount()).isEqualTo(1);
  }
  @Test void tonsWeightingUsesKnownSubtotalAndExcludesZeroOrMissingEvenWithZeroMinimum() {
    jdbc.update("UPDATE order_item SET ton_case_factor=NULL,line_tons=NULL WHERE order_id=?",base+3);
    var result=service.preview(activity,preview("TONS","0","ALL","项目A",List.of(),"ORDER_TONS_WEIGHTED"));
    assertThat(result.candidateCount()).isEqualTo(2);assertThat(result.missingTonnageCustomers()).isEqualTo(1);
    assertThat(result.totalCandidateWeight()).isEqualByComparingTo("0.6");
    assertThat(result.candidates().getFirst().probabilityPercent()).isEqualByComparingTo("16.66666667");
    assertThat(service.preview(activity,preview("TONS","0","ALL","项目A",List.of("品种,B"),"ORDER_TONS_WEIGHTED")).candidateCount()).isZero();
    result=service.preview(activity,preview("TONS","0.5","ALL","项目A",List.of(),"ORDER_TONS_WEIGHTED"));
    assertThat(result.candidates()).extracting(LotteryService.CandidatePreviewItem::activityCustomerId).containsExactly(base+2);
    result=service.preview(activity,preview("TONS","0","ALL",null,List.of(),"ORDER_TONS_WEIGHTED"));
    assertThat(result.totalCandidateWeight()).isEqualByComparingTo("1.3");assertThat(result.candidateCount()).isEqualTo(2);
    assertThat(result.missingTonnageCustomers()).isEqualTo(2);
    assertThat(service.preview(activity,preview("BOX_COUNT","0","ALL",null,List.of(),"ORDER_BOX_COUNT_WEIGHTED")).candidateCount()).isEqualTo(3);
    jdbc.update("UPDATE order_item SET line_tons=0.000001,ton_case_factor=1000000 WHERE order_id=? AND line_no=1",base+2);
    result=service.preview(activity,preview("TONS","0.000001","SPECIAL",null,List.of(),"ORDER_TONS_WEIGHTED"));
    assertThat(result.totalCandidateWeight()).isEqualByComparingTo("0.000001");assertThat(result.candidateCount()).isEqualTo(1);
  }
  @ParameterizedTest @ValueSource(strings={"ORDER_BOX_COUNT_WEIGHTED","ORDER_TONS_WEIGHTED"})
  void newWeightModesPersistAndDrawWithMatchingThresholdAndAudit(String mode) throws Exception {
    boolean boxes=mode.equals("ORDER_BOX_COUNT_WEIGHTED");String metric=boxes?"BOX_COUNT":"TONS",minimum=boxes?"4":"0.2";
    var rule=publish(round(metric,minimum,"项目A",List.of(),mode));var saved=service.rule(activity,rule.id()).rounds().getFirst();
    assertThat(saved.probabilityMode()).isEqualTo(mode);assertThat(saved.qualificationMetric()).isEqualTo(metric);
    var result=tx.execute(status->service.draw(activity,saved.id(),admin));
    assertThat(result.candidateCount()).isEqualTo(1);assertThat(result.winners().getFirst().activityCustomerId()).isEqualTo(base+2);
    var audit=JSON.readTree(jdbc.queryForObject("SELECT CAST(rule_snapshot_json AS CHAR) FROM lottery_draw_attempt WHERE id=?",String.class,result.attemptId()));
    assertThat(audit.get("weightMetric").asText()).isEqualTo(metric);
    assertThat(audit.get("totalCandidateWeight").decimalValue()).isEqualByComparingTo(boxes?"5":"0.5");
    assertThat(audit.get("totalCandidateOrderAmount").decimalValue()).isEqualByComparingTo("50");
    assertThat(audit.get("resultHashVersion").asInt()).isEqualTo(2);
    assertThatThrownBy(()->tx.execute(status->service.update(activity,rule.id(),new LotteryService.RuleWrite("变更",List.of(round(metric,"0","项目A",List.of(),mode))),admin))).isInstanceOf(DomainException.class);
  }
  @Test void zeroTonnageDoesNotFallbackToEqualAndMismatchedNewMetricsAreRejected() {
    jdbc.update("UPDATE order_item SET line_tons=0,ton_case_factor=NULL WHERE order_id IN (SELECT id FROM customer_order WHERE activity_id=?)",activity);
    var rule=publish(round("TONS","0",null,List.of(),"ORDER_TONS_WEIGHTED"));
    assertThat(service.preview(activity,preview("TONS","0","ALL",null,List.of(),"ORDER_TONS_WEIGHTED")).candidateCount()).isZero();
    assertThatThrownBy(()->tx.execute(status->service.draw(activity,rule.rounds().getFirst().id(),admin))).isInstanceOf(DomainException.class);
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM lottery_draw_attempt WHERE activity_id=?",Integer.class,activity)).isZero();
    assertThatThrownBy(()->service.preview(activity,preview("AMOUNT","0","ALL",null,List.of(),"ORDER_BOX_COUNT_WEIGHTED"))).isInstanceOf(DomainException.class);
    assertThatThrownBy(()->tx.execute(status->service.create(activity,new LotteryService.RuleWrite("错误",List.of(round("AMOUNT","0",null,List.of(),"ORDER_TONS_WEIGHTED"))),admin))).isInstanceOf(DomainException.class);
    assertThatThrownBy(()->tx.execute(status->service.create(activity,new LotteryService.RuleWrite("错误",List.of(round("TONS","0",null,List.of(),"ORDER_AMOUNT_WEIGHTED"))),admin))).isInstanceOf(DomainException.class);
  }
  @Test void saveReadDoesNotCalculateAndOptionsRespectActivityAndCurrentData() {
    var rule=publish(round("TONS","0.1","项目A",List.of("品种,B","品种A")));
    assertThat(rule.rounds().getFirst().minimumOrderTons()).isEqualByComparingTo("0.1");
    assertThat(rule.rounds().getFirst().varieties()).containsExactly("品种,B","品种A");
    assertThat(rule.rounds().getFirst().candidateCount()).isNull();
    var retained=tx.execute(status->service.update(activity,rule.id(),new LotteryService.RuleWrite("原位保存",List.of(round("TONS","0.1","项目A",List.of("品种,B","品种A")))),admin));
    assertThat(retained.rounds().getFirst().probabilityMode()).isEqualTo("ORDER_AMOUNT_WEIGHTED");
    assertThat(retained.rounds().getFirst().qualificationMetric()).isEqualTo("TONS");
    assertThat(service.productOptions(activity)).contains(new LotteryService.ProductOption("项目A","品种,B"));
    var spy=spy(jdbc); var reader=new LotteryService(spy,mock(StringRedisTemplate.class),JSON,mock(ActivityService.class),mock(StorageService.class));
    reader.rules(activity); reader.rule(activity,rule.id()); reader.publishedRules(activity);
    verify(spy,never()).query(any(PreparedStatementCreator.class),any(RowMapper.class));
  }
  @Test void actualDrawRechecksAndStoresMatchedValuesAndLocksPlayedRule() {
    var rule=publish(round("TONS","0.1","项目A",List.of())); long round=rule.rounds().getFirst().id();
    assertThat(service.preview(activity,preview("TONS","0.1","ALL","项目A",List.of(),"ORDER_AMOUNT_WEIGHTED")).candidateCount()).isEqualTo(2);
    jdbc.update("UPDATE order_item SET line_amount=0 WHERE order_id=? AND product_line='项目A'",base+1);
    var result=tx.execute(status->service.draw(activity,round,admin));
    assertThat(result.candidateCount()).isEqualTo(1); assertThat(result.actualWinnerCount()).isEqualTo(1); assertThat(result.unawardedCount()).isEqualTo(9);
    assertThat(jdbc.queryForObject("SELECT qualifying_order_amount FROM lottery_candidate_snapshot WHERE draw_attempt_id=?",BigDecimal.class,result.attemptId())).isEqualByComparingTo("50");
    assertThat(jdbc.queryForObject("SELECT qualifying_order_tons FROM lottery_candidate_snapshot WHERE draw_attempt_id=?",BigDecimal.class,result.attemptId())).isEqualByComparingTo("0.5");
    assertThat(jdbc.queryForObject("SELECT CAST(rule_snapshot_json AS CHAR) FROM lottery_draw_attempt WHERE id=?",String.class,result.attemptId())).contains("项目A","minimumOrderTons");
    assertThatThrownBy(()->tx.execute(status->service.draw(activity,round,admin))).isInstanceOf(DomainException.class);
    assertThatThrownBy(()->tx.execute(status->service.update(activity,rule.id(),new LotteryService.RuleWrite("变更",List.of(round("TONS","0.2","项目A",List.of()))),admin))).isInstanceOf(DomainException.class);
  }
  @Test void snapshotsCrossBatchBoundaryAndWinnerFailureRollsEverythingBack() {
    for(int i=5;i<=510;i++) {
      long id=base*1000+i;
      jdbc.update("INSERT INTO customer(id,customer_type,dealer_full_name,normalized_dealer_full_name) VALUES(?,'ALL',?,?)",id,"c"+id,"c"+id);
      jdbc.update("INSERT INTO activity_customer(id,activity_id,customer_id,customer_type,dealer_full_name,normalized_dealer_full_name,source_import_task_id,data_version_id,phone_masked,phone_lookup_hash) VALUES(?,?,?,'ALL',?,?,?,?,'139****0000',UNHEX(SHA2(?,256)))",id,activity,id,"c"+id,"c"+id,base+2,base+2,"phone"+id);
    }
    var round=new LotteryService.RoundWrite("r","prize",3,"ALL_CUSTOMERS","ALL",BigDecimal.ZERO,"AMOUNT","EQUAL",0,null,false,"FULL_NAME",null,null,null,null,false,false);
    var rule=publish(round); long id=rule.rounds().getFirst().id();
    jdbc.execute("CREATE TRIGGER fail_lottery_winner BEFORE INSERT ON lottery_winner FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic failure'");
    try { assertThatThrownBy(()->tx.execute(status->service.draw(activity,id,admin))).isInstanceOf(RuntimeException.class); }
    finally { jdbc.execute("DROP TRIGGER fail_lottery_winner"); }
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM lottery_candidate_snapshot WHERE activity_id=?",Integer.class,activity)).isZero();
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM lottery_draw_attempt WHERE activity_id=?",Integer.class,activity)).isZero();
    var result=tx.execute(status->service.draw(activity,id,admin));
    assertThat(result.candidateCount()).isEqualTo(510);
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM lottery_candidate_snapshot WHERE draw_attempt_id=?",Integer.class,result.attemptId())).isEqualTo(510);
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM lottery_winner WHERE draw_attempt_id=?",Integer.class,result.attemptId())).isEqualTo(3);
  }
}
