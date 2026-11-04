package com.fengyi.ordershow.activity.copy;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengyi.ordershow.activity.ActivityAccessPolicy;
import com.fengyi.ordershow.activity.ActivityService;
import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.config.OrderShowProperties;
import com.fengyi.ordershow.security.AdminPrincipal;
import com.fengyi.ordershow.security.DepartmentAccessService;
import com.fengyi.ordershow.storage.*;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.boot.autoconfigure.jdbc.DataSourceProperties;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/** Only the fixed, disposable test stack. No business database, images or application deployment. */
@EnabledIfEnvironmentVariable(named="ORDER_SHOW_COPY_TEST",matches="configuration-copy-only")
class ActivityCopyIntegrationTest {
  static final String URL="jdbc:mysql://host.docker.internal:33353/order_show_activity_copy_test?allowPublicKeyRetrieval=true&useSSL=false&serverTimezone=UTC&rewriteBatchedStatements=true";
  static final ObjectMapper JSON=new ObjectMapper().findAndRegisterModules();
  static final OrderShowProperties PROPS=new OrderShowProperties("http://test",false,8,12,"test-only-hmac","test-only-encryption","test","test","test",
      new OrderShowProperties.Storage("http://host.docker.internal:39153","copy_only_test","copy_only_test_secret","configuration-copy-test"));
  static JdbcTemplate jdbc;static TransactionTemplate tx;
  final AdminPrincipal root=new AdminPrincipal(1,"test","测试管理员","SUPER_ADMIN",null,null,false);
  ActivityService activities;ActivityCopyService copies;CopyResources resources;ActivityCopyWorker worker;ObjectStorage objects;StorageService storage;
  long source,productVersion,whitelistVersion,product,customer,rule,sourceFile,prizeFile;
  static long sequence;
  @BeforeAll static void database(){
    var ds=new DriverManagerDataSource(URL,"root","copy_only_root");jdbc=new JdbcTemplate(ds);
    assertThat(jdbc.queryForObject("SELECT DATABASE()",String.class)).isEqualTo("order_show_activity_copy_test");
    var flyway=Flyway.configure().dataSource(ds).locations("classpath:db/migration").cleanDisabled(false).load();flyway.clean();flyway.migrate();
    tx=new TransactionTemplate(new DataSourceTransactionManager(ds));tx.setIsolationLevel(TransactionDefinition.ISOLATION_READ_COMMITTED);
    jdbc.update("INSERT INTO admin_user(id,username,display_name,password_hash,role_code,must_change_password) VALUES(1,'copy-test','测试管理员','unused','SUPER_ADMIN',FALSE)");
    jdbc.update("INSERT INTO department(id,department_code,department_name) VALUES(2,'COPY_OTHER','其他部门')");
  }
  static DataSourceProperties dataSource(){var p=new DataSourceProperties();p.setUrl(URL);p.setUsername("root");p.setPassword("copy_only_root");return p;}
  @BeforeEach void fixture()throws Exception{
    jdbc.update("DELETE FROM activity_copy_file");jdbc.update("DELETE FROM activity_copy_task");
    jdbc.update("UPDATE activity_copy_worker SET task_id=NULL,lease_token=NULL,lease_expires_at=NULL WHERE id=1");
    activities=new ActivityService(jdbc,ignored->{},new DepartmentAccessService(jdbc));
    copies=new ActivityCopyService(jdbc,activities,new DepartmentAccessService(jdbc),JSON,20000,8388608,10);
    objects=spy(new StorageConfiguration().objectStorage(PROPS,"minio",""));objects.initialize();
    storage=new StorageService(PROPS,jdbc,objects);resources=new CopyResources(dataSource(),PROPS,objects);worker=new ActivityCopyWorker(resources,JSON);
    source=tx.execute(s->activities.create(write("来源"+(++sequence),1L),root)).id();
    var provenance=storage.save(source,"source.json","application/json","{}".getBytes(),"OTHER",1L);
    productVersion=version(source,"PRODUCT",provenance.id());whitelistVersion=version(source,"WHITELIST",provenance.id());
    product=product(source,productVersion,"product-a","手工修改商品",new BigDecimal("15.80"));
    long second=product(source,productVersion,"product-b","共享同图商品",new BigDecimal("20.10"));
    long inactive=product(source,productVersion,"inactive","已删除商品",BigDecimal.ONE);jdbc.update("UPDATE activity_product SET data_status='INACTIVE',is_visible=FALSE,is_orderable=FALSE,deactivated_at=UTC_TIMESTAMP(3) WHERE id=?",inactive);
    jdbc.update("INSERT INTO activity_product_price_tier(activity_product_id,min_quantity,case_price,pricing_mode) VALUES(?,1,15.8,'INCREMENTAL'),(?,10,14.2,'INCREMENTAL'),(?,100,12.3,'INCREMENTAL')",product,product,product);
    jdbc.update("INSERT INTO activity_product_branch_scope(activity_product_id,branch_name,normalized_branch_name) VALUES(?,'分公司A','分公司a')",product);
    jdbc.update("INSERT INTO activity_product_dealer_scope(activity_product_id,branch_name,normalized_branch_name) VALUES(?,'分公司A','分公司a')",product);
    long master=insert("INSERT INTO customer(customer_type,dealer_full_name,normalized_dealer_full_name,branch_name,normalized_branch_name) VALUES('GENERAL',?,?,'分公司A','分公司a')","测试客户"+source,"测试客户"+source);
    jdbc.update("INSERT INTO activity_region(activity_id,region_code,region_name) VALUES(?,'TEST_REGION','测试大区')",source);
    customer=insert("INSERT INTO activity_customer(activity_id,customer_id,customer_type,region_code,branch_name,normalized_branch_name,dealer_full_name,normalized_dealer_full_name,contact_name,phone,phone_lookup_hash,phone_masked,confirmer_name,confirmer_phone,confirmer_phone_masked,source_import_task_id,data_version_id) VALUES(?,?,'GENERAL','TEST_REGION','分公司A','分公司a',?,?,'手工联系人','13800000000',?,'138****0000','确认人','13900000000','139****0000',?,?)",
        source,master,"测试客户"+source,"测试客户"+source,new byte[32],taskFor(whitelistVersion),whitelistVersion);
    jdbc.update("INSERT INTO activity_product_dealer_member(activity_product_id,normalized_branch_name,customer_id,customer_type,normalized_dealer_full_name,dealer_full_name) VALUES(?,'分公司a',?,'GENERAL',?,?)",product,master,"测试客户"+source,"测试客户"+source);
    jdbc.update("INSERT INTO activity_attendee(activity_id,activity_customer_id,match_status,match_method,participant_name,dealer_name_snapshot,is_active) VALUES(?,?,'MATCHED','MANUAL','本场到场人',?,TRUE)",source,customer,"测试客户"+source);
    var image=new java.awt.image.BufferedImage(3,2,java.awt.image.BufferedImage.TYPE_INT_RGB);var encoded=new java.io.ByteArrayOutputStream();javax.imageio.ImageIO.write(image,"png",encoded);byte[] png=encoded.toByteArray();
    sourceFile=storage.save(source,"商品.png","image/png",png,"PRODUCT_IMAGE",1L).id();
    prizeFile=storage.save(source,"奖品.png","image/png",png,"LOTTERY_PRIZE_IMAGE",1L).id();
    jdbc.update("INSERT INTO product_image(activity_product_id,stored_file_id,is_primary,source_type,match_status) VALUES(?,?,TRUE,'MANUAL','CONFIRMED'),(?,?,TRUE,'MANUAL','CONFIRMED')",product,sourceFile,second,sourceFile);
    rule=insert("INSERT INTO lottery_rule(activity_id,name,status,created_by,updated_by) VALUES(?,'正式方案','PUBLISHED',1,1)",source);
    long round=insert("INSERT INTO lottery_round(activity_id,lottery_rule_id,round_no,name,prize_name,prize_image_file_id,winner_count,candidate_scope,customer_type,status,current_attempt_no,candidate_count,drawn_at,qualification_cutoff_at,probability_mode,product_line,varieties_json) VALUES(?,?,1,'第一轮','一等奖',?,1,'VALID_ORDERS','GENERAL','DRAWN',1,1,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),'ORDER_AMOUNT_WEIGHTED','项目A','[\"品种A\"]')",source,rule,prizeFile);
    jdbc.update("INSERT INTO lottery_round(activity_id,lottery_rule_id,round_no,name,prize_name,prize_image_file_id,winner_count,candidate_scope,status) VALUES(?,?,2,'第二轮','幸运奖',?,2,'ATTENDEES','READY')",source,rule,prizeFile);
    long attempt=insert("INSERT INTO lottery_draw_attempt(activity_id,round_id,attempt_no,candidate_count,winner_count,rule_snapshot_json,result_hash,drawn_at,drawn_by) VALUES(?,?,1,1,1,'{}',?,UTC_TIMESTAMP(3),1)",source,round,new byte[32]);
    long candidate=insert("INSERT INTO lottery_candidate_snapshot(activity_id,round_id,draw_attempt_id,activity_customer_id,dealer_full_name_snapshot,customer_type,qualification_source,random_sort_key) VALUES(?,?,?,?,'客户','GENERAL','ALL_CUSTOMERS',?)",source,round,attempt,customer,new byte[32]);
    jdbc.update("INSERT INTO lottery_winner(activity_id,round_id,draw_attempt_id,candidate_snapshot_id,activity_customer_id,winner_position,dealer_display_name_snapshot) VALUES(?,?,?,?,?,1,'客户')",source,round,attempt,candidate,customer);
    jdbc.update("INSERT INTO lottery_rule(activity_id,name,status,created_by,updated_by) VALUES(?,'较新但未发布的草稿','DRAFT',1,1)",source);
    clearInvocations(objects);
  }
  @AfterEach void close(){if(worker!=null)worker.close();if(resources!=null)resources.close();}
  ActivityService.ActivityWrite write(String name,Long department){return new ActivityService.ActivityWrite(null,name,"","Asia/Shanghai",Instant.parse("2099-01-01T00:00:00Z"),Instant.parse("2099-01-02T00:00:00Z"),Instant.parse("2099-01-02T04:00:00Z"),"ALL",90,30,3,List.of(),department);}
  ActivityCopyService.Request request(CopySnapshot.Selection selection){return new ActivityCopyService.Request(write("新活动",1L),source,copies.preview(source,1,root).stamp(),selection,UUID.randomUUID().toString());}
  ActivityCopyService.Task enqueue(CopySnapshot.Selection selected){return tx.execute(s->copies.enqueue(request(selected),root));}
  void complete(long id){worker.tick();assertThat(copies.task(id,root).status()).withFailMessage(()->copies.task(id,root).toString()).isEqualTo("COMPLETED");}
  static long count(String table,long id){return jdbc.queryForObject("SELECT COUNT(*) FROM "+table+" WHERE activity_id=?",Long.class,id);}
  static long insert(String sql,Object...args){var key=new GeneratedKeyHolder();jdbc.update(c->{var ps=c.prepareStatement(sql,java.sql.Statement.RETURN_GENERATED_KEYS);for(int i=0;i<args.length;i++)ps.setObject(i+1,args[i]);return ps;},key);return key.getKey().longValue();}
  long taskFor(long version){return jdbc.queryForObject("SELECT source_import_task_id FROM import_publish_version WHERE id=?",Long.class,version);}
  long version(long activity,String type,long file){
    long task=insert("INSERT INTO import_task(activity_id,import_type,status,source_file_id,file_sha256,created_by) VALUES(?,?,'COMPLETED',?,?,1)",activity,type,file,new byte[32]);
    long v=insert("INSERT INTO import_publish_version(activity_id,data_type,version_no,source_import_task_id,status,created_by) VALUES(?,?,1,?,'PUBLISHED',1)",activity,type,task);
    jdbc.update("INSERT INTO activity_data_binding(activity_id,data_type,current_version_id,updated_by) VALUES(?,?,?,1)",activity,type,v);return v;
  }
  long product(long activity,long version,String key,String name,BigDecimal price){return insert("INSERT INTO activity_product(activity_id,customer_type,rebate_status,business_key,material_name,case_price,ton_case_factor,source_import_task_id,data_version_id) VALUES(?,'GENERAL','ALL',?,?,?,1,?,?)",activity,key,name,price,taskFor(version),version);}

  @Test void copiesCurrentConfigurationAndFilesAsIndependentDrafts()throws Exception{
    var task=enqueue(new CopySnapshot.Selection(true,true,true));long target=task.activityId();
    assertThat(activities.listSummaries(root)).noneMatch(a->a.id()==target);
    assertThatThrownBy(()->new ActivityAccessPolicy(jdbc).readable(target)).isInstanceOf(DomainException.class);
    complete(task.id());
    assertThat(activities.byId(target).status()).isEqualTo("DRAFT");assertThat(count("activity_product",target)).isEqualTo(2);assertThat(count("activity_customer",target)).isEqualTo(1);
    assertThat(jdbc.queryForObject("SELECT case_price FROM activity_product WHERE activity_id=? AND business_key='product-a'",BigDecimal.class,target)).isEqualByComparingTo("15.80");
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM activity_product_price_tier t JOIN activity_product p ON p.id=t.activity_product_id WHERE p.activity_id=?",Long.class,target)).isEqualTo(3);
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM activity_product_dealer_member m JOIN activity_product p ON p.id=m.activity_product_id WHERE p.activity_id=?",Long.class,target)).isEqualTo(1);
    assertThat(jdbc.queryForObject("SELECT contact_name FROM activity_customer WHERE activity_id=?",String.class,target)).isEqualTo("手工联系人");
    assertThat(jdbc.queryForObject("SELECT name FROM lottery_rule WHERE activity_id=?",String.class,target)).isEqualTo("正式方案");
    assertThat(jdbc.queryForList("SELECT status FROM lottery_round WHERE activity_id=? ORDER BY round_no",String.class,target)).containsExactly("DRAFT","DRAFT");
    assertThat(jdbc.queryForList("SELECT current_attempt_no FROM lottery_round WHERE activity_id=?",Integer.class,target)).containsOnly(0);
    assertThat(jdbc.queryForObject("SELECT varieties_json FROM lottery_round WHERE activity_id=? AND round_no=1",String.class,target)).contains("品种A");
    for(String table:List.of("activity_attendee","customer_order","lottery_winner","lottery_draw_attempt","lottery_candidate_snapshot","activity_dashboard_snapshot"))assertThat(count(table,target)).as(table).isZero();
    assertThat(copies.task(task.id(),root).totalFiles()).isEqualTo(2);assertThat(copies.task(task.id(),root).copiedFiles()).isEqualTo(2);
    assertThat(jdbc.queryForObject("SELECT snapshot_json FROM activity_copy_task WHERE id=?",String.class,task.id())).isNull();
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM activity_copy_file WHERE task_id=?",Long.class,task.id())).isZero();
    long copiedFile=jdbc.queryForObject("SELECT i.stored_file_id FROM product_image i JOIN activity_product p ON p.id=i.activity_product_id WHERE p.activity_id=? AND p.business_key='product-a'",Long.class,target);
    byte[] expected=storage.read(sourceFile);
    assertThat(storage.readVariant(storage.meta(copiedFile),ImageVariants.Kind.THUMBNAIL)).isNotNull();
    storage.removeWithVariants(storage.meta(sourceFile));jdbc.update("UPDATE activity SET deletion_requested_at=UTC_TIMESTAMP(3) WHERE id=?",source);
    assertThat(storage.read(copiedFile)).isEqualTo(expected);assertThat(activities.byId(target).name()).isEqualTo("新活动");
    assertThat(jdbc.queryForObject("SELECT COUNT(DISTINCT stored_file_id) FROM product_image i JOIN activity_product p ON p.id=i.activity_product_id WHERE p.activity_id=?",Long.class,target)).isEqualTo(1);
  }
  @Test void copiesOnlySelectedModulesAndKeepsProductRestrictions(){
    var task=enqueue(new CopySnapshot.Selection(true,false,false));complete(task.id());long target=task.activityId();
    assertThat(count("activity_customer",target)).isZero();assertThat(count("lottery_rule",target)).isZero();assertThat(count("activity_attendee",target)).isZero();
    assertThat(count("activity_data_binding",target)).isEqualTo(1);
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM activity_product_dealer_scope s JOIN activity_product p ON p.id=s.activity_product_id WHERE p.activity_id=?",Long.class,target)).isEqualTo(1);
    assertThat(copies.task(task.id(),root).totalFiles()).isEqualTo(1);
  }
  @Test void multipleBatchesRemainIndependentAndUseTheOriginalCatalogReader(){
    long importTask=taskFor(productVersion);
    var extra=java.util.stream.IntStream.range(0,451).boxed().toList();
    jdbc.batchUpdate("INSERT INTO activity_product(activity_id,customer_type,rebate_status,business_key,material_name,case_price,ton_case_factor,source_import_task_id,data_version_id) VALUES(?,'GENERAL','ALL',?,?,1,1,?,?)",extra,200,(ps,i)->{
      ps.setLong(1,source);ps.setString(2,"batch-"+i);ps.setString(3,"批量商品"+i);ps.setLong(4,importTask);ps.setLong(5,productVersion);
    });
    var task=enqueue(new CopySnapshot.Selection(true,false,false));complete(task.id());
    var reader=new com.fengyi.ordershow.catalog.ProductCatalogReader(jdbc,activities);
    assertThat(reader.adminProducts(task.activityId(),null,null,null)).hasSize(453);
    jdbc.update("UPDATE activity_product SET material_name='来源后续修改' WHERE activity_id=? AND business_key='batch-450'",source);
    jdbc.update("DELETE FROM activity_data_binding WHERE activity_id=?",source);
    assertThat(reader.adminProducts(task.activityId(),null,null,"批量商品450")).hasSize(1);
    jdbc.update("UPDATE activity_product SET material_name='新场独立修改' WHERE activity_id=? AND business_key='batch-450'",task.activityId());
    assertThat(reader.adminProducts(task.activityId(),null,null,"新场独立修改")).hasSize(1);
    assertThat(jdbc.queryForObject("SELECT material_name FROM activity_product WHERE activity_id=? AND business_key='batch-450'",String.class,source)).isEqualTo("来源后续修改");
    assertThat(count("customer_order",task.activityId())).isZero();
  }
  @Test void departmentManagerCanCopyAnArchivedSourceAndLatestSavedDraftIsTheFallback(){
    jdbc.update("UPDATE activity SET status='ARCHIVED' WHERE id=?",source);
    jdbc.update("DELETE FROM lottery_winner WHERE activity_id=?",source);
    jdbc.update("DELETE FROM lottery_candidate_snapshot WHERE activity_id=?",source);
    jdbc.update("DELETE FROM lottery_draw_attempt WHERE activity_id=?",source);
    jdbc.update("DELETE FROM lottery_round WHERE activity_id=?",source);
    jdbc.update("UPDATE lottery_rule SET status='DRAFT',updated_at='2026-01-01 00:00:00' WHERE activity_id=?",source);
    jdbc.update("UPDATE lottery_rule SET name='最近保存的旧草稿',updated_at='2026-11-04 00:00:00' WHERE id=?",rule);
    jdbc.update("INSERT INTO lottery_round(activity_id,lottery_rule_id,round_no,name,prize_name,winner_count,candidate_scope,status) VALUES(?,?,1,'草稿轮次','草稿奖',2,'ATTENDEES','DRAFT')",source,rule);
    var manager=new AdminPrincipal(1,"manager","部门管理员","DEPARTMENT_ADMIN",1L,"默认",false);
    assertThat(copies.sources(1,manager)).anyMatch(a->a.id()==source && a.status().equals("ARCHIVED"));
    var preview=copies.preview(source,1,manager);assertThat(preview.ruleId()).isEqualTo(rule);
    var request=new ActivityCopyService.Request(write("同部门复用",null),source,preview.stamp(),new CopySnapshot.Selection(false,false,true),UUID.randomUUID().toString());
    var task=tx.execute(s->copies.enqueue(request,manager));complete(task.id());
    assertThat(jdbc.queryForObject("SELECT name FROM lottery_rule WHERE activity_id=?",String.class,task.activityId())).isEqualTo("最近保存的旧草稿");
    assertThat(jdbc.queryForObject("SELECT candidate_scope FROM lottery_round WHERE activity_id=?",String.class,task.activityId())).isEqualTo("ATTENDEES");
    assertThat(count("activity_attendee",task.activityId())).isZero();
  }
  @Test void rejectsCrossDepartmentMembersAndStaleSourcesWithoutCreatingDrafts(){
    var member=new AdminPrincipal(2,"member","成员","DEPARTMENT_MEMBER",1L,"默认",false);
    assertThatThrownBy(()->copies.preview(source,1,member)).isInstanceOf(DomainException.class);
    assertThatThrownBy(()->copies.preview(source,2,root)).hasMessageContaining("同部门");
    var input=request(new CopySnapshot.Selection(true,true,false));long before=jdbc.queryForObject("SELECT COUNT(*) FROM activity WHERE id=?",Long.class,source);
    jdbc.update("UPDATE activity SET product_catalog_version=product_catalog_version+1 WHERE id=?",source);
    assertThatThrownBy(()->tx.execute(s->copies.enqueue(input,root))).hasMessageContaining("来源配置已变化");
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM activity_copy_task",Long.class)).isZero();assertThat(before).isEqualTo(1);
  }
  @Test void requestRetriesReturnTheSameTaskAndRejectChangedInputs(){
    var input=request(new CopySnapshot.Selection(true,true,true));var first=tx.execute(s->copies.enqueue(input,root));var again=tx.execute(s->copies.enqueue(input,root));
    assertThat(again.id()).isEqualTo(first.id());assertThat(again.activityId()).isEqualTo(first.activityId());
    var changed=new ActivityCopyService.Request(write("另一个名称",1L),input.sourceId(),input.sourceStamp(),input.selection(),input.requestKey());
    assertThatThrownBy(()->tx.execute(s->copies.enqueue(changed,root))).hasMessageContaining("请求已经提交");
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM activity_copy_task",Long.class)).isEqualTo(1);
  }
  @Test void storageFailureRemainsPrivateAndRetryResumesWithoutDuplicateConfiguration()throws Exception{
    String prizeKey=storage.meta(prizeFile).objectKey();
    doAnswer(call->{if(call.getArgument(1).equals(prizeKey))throw new IllegalStateException("test storage failure");return call.callRealMethod();})
        .when(objects).copy(anyString(),anyString(),anyString(),anyString());
    var task=enqueue(new CopySnapshot.Selection(true,true,true));worker.tick();assertThat(copies.task(task.id(),root).status()).isEqualTo("FAILED");
    assertThat(count("activity_product",task.activityId())).isZero();assertThat(activities.listSummaries(root)).noneMatch(a->a.id()==task.activityId());
    doCallRealMethod().when(objects).copy(anyString(),anyString(),anyString(),anyString());
    tx.execute(s->copies.retry(task.id(),root));complete(task.id());assertThat(count("activity_product",task.activityId())).isEqualTo(2);assertThat(count("import_task",task.activityId())).isEqualTo(2);
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM stored_file WHERE activity_id=? AND file_purpose IN ('PRODUCT_IMAGE','LOTTERY_PRIZE_IMAGE')",Long.class,task.activityId())).isEqualTo(2);
  }
  @Test void globalLeaseCoordinatesReplicasAndRecoversAnInterruptedWorker(){
    var task=enqueue(new CopySnapshot.Selection(false,true,false));var claimed=worker.claim();assertThat(claimed.id()).isEqualTo(task.id());
    try(var otherResources=new CopyResources(dataSource(),PROPS,objects);var other=new ActivityCopyWorker(otherResources,JSON)){
      assertThat(other.claim()).isNull();jdbc.update("UPDATE activity_copy_worker SET lease_expires_at=TIMESTAMPADD(SECOND,-1,UTC_TIMESTAMP(3)) WHERE id=1");
      other.tick();assertThat(copies.task(task.id(),root).status()).isEqualTo("COMPLETED");
    }
  }
  @Test void sourceFilesAreProtectedWhileCopyingAndFailedWorkCanBeDiscarded(){
    var task=enqueue(new CopySnapshot.Selection(true,false,false));
    assertThatThrownBy(()->storage.removeWithVariants(storage.meta(sourceFile))).hasMessageContaining("正在被活动配置复用");
    jdbc.update("UPDATE activity_copy_task SET status='FAILED' WHERE id=?",task.id());tx.executeWithoutResult(s->copies.discard(task.id(),root));
    assertThat(copies.task(task.id(),root).status()).isEqualTo("CANCELLED");
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM activity_deletion_task WHERE activity_id=?",Long.class,task.activityId())).isEqualTo(1);
    assertThat(jdbc.queryForObject("SELECT snapshot_json FROM activity_copy_task WHERE id=?",String.class,task.id())).isNull();
  }
  @Test void copySizeLimitFailsBeforeCreatingTarget(){
    for(int i=0;i<110;i++)product(source,productVersion,"extra-"+i,"商品"+i,BigDecimal.ONE);
    var limited=new ActivityCopyService(jdbc,activities,new DepartmentAccessService(jdbc),JSON,100,1048576,10);
    var input=request(new CopySnapshot.Selection(true,false,false));long before=jdbc.queryForObject("SELECT COUNT(*) FROM activity",Long.class);
    assertThatThrownBy(()->tx.execute(s->limited.enqueue(input,root))).hasMessageContaining("单次复用上限");
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM activity",Long.class)).isEqualTo(before);
  }
  @Test void objectCopyDoesNotHoldSourceActivityLockOrDatabaseConnection()throws Exception{
    var entered=new CountDownLatch(1);var release=new CountDownLatch(1);
    doAnswer(call->{entered.countDown();assertThat(release.await(10,TimeUnit.SECONDS)).isTrue();return call.callRealMethod();}).when(objects).copy(anyString(),anyString(),anyString(),anyString());
    var task=enqueue(new CopySnapshot.Selection(true,true,false));
    try(var executor=Executors.newSingleThreadExecutor()){
      var work=executor.submit(()->worker.tick());assertThat(entered.await(10,TimeUnit.SECONDS)).isTrue();
      try{
        long start=System.nanoTime();tx.executeWithoutResult(s->{jdbc.queryForList("SELECT id FROM activity WHERE id=? FOR UPDATE NOWAIT",source);jdbc.update("UPDATE activity SET name=name WHERE id=?",source);});
        assertThat((System.nanoTime()-start)/1_000_000).isLessThan(2000);
        assertThat(resources.pool.getHikariPoolMXBean().getActiveConnections()).isZero();
      }finally{release.countDown();}
      work.get(20,TimeUnit.SECONDS);assertThat(copies.task(task.id(),root).status()).isEqualTo("COMPLETED");
    }
  }
}
