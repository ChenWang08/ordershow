package com.fengyi.ordershow.exports;

import static com.fengyi.ordershow.exports.ExportModels.*;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengyi.ordershow.activity.*;
import com.fengyi.ordershow.common.*;
import com.fengyi.ordershow.config.OrderShowProperties;
import com.fengyi.ordershow.dashboard.DashboardService;
import com.fengyi.ordershow.order.*;
import com.fengyi.ordershow.security.*;
import com.fengyi.ordershow.storage.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import java.util.zip.ZipFile;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.*;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

/** Only touches the disposable database/MinIO in tests/order-export.compose.yml. */
@EnabledIfEnvironmentVariable(named="ORDER_SHOW_EXPORT_TEST",matches="order-export-only")
class OrderExportIntegrationTest {
  static final String URL="jdbc:mysql://127.0.0.1:33327/order_show_export_test?allowPublicKeyRetrieval=true&useSSL=false&connectionTimeZone=UTC&forceConnectionTimeZoneToSession=true&rewriteBatchedStatements=true";
  static JdbcTemplate jdbc; static DataSourceTransactionManager manager; static long sequence=100;
  static final ObjectMapper JSON=new ObjectMapper().findAndRegisterModules();
  static final AdminPrincipal ROOT=new AdminPrincipal(1,"export-test","测试超管","SUPER_ADMIN",null,null,false);
  static final Filters ALL=new Filters(null,null,null);
  static final OrderShowProperties PROPS=new OrderShowProperties("http://localhost",false,12,12,"test-hmac","test-encryption","test","unused","测试",
      new OrderShowProperties.Storage("http://127.0.0.1:33328","export_test","export_test_only","export-test"));
  ExportRepository tasks; ExportPolicy policy; StorageService storage;
  @TempDir Path directory;
  @BeforeAll static void migrate() {
    var ds=new DriverManagerDataSource(URL,"root","export_test_only");jdbc=new JdbcTemplate(ds);manager=new DataSourceTransactionManager(ds);
    assertThat(jdbc.queryForObject("SELECT DATABASE()",String.class)).isEqualTo("order_show_export_test");
    var flyway=Flyway.configure().dataSource(ds).locations("classpath:db/migration").cleanDisabled(false).load();
    flyway.clean();flyway.migrate();
    jdbc.update("INSERT IGNORE INTO admin_user(id,username,display_name,password_hash,role_code) VALUES(1,'export-test','test','unused','SUPER_ADMIN')");
  }
  @BeforeEach void services() {
    jdbc.update("UPDATE export_task SET status='FAILED' WHERE status IN ('PENDING','RUNNING')");
    jdbc.update("UPDATE order_export_worker SET task_id=NULL,lease_token=NULL,lease_expires_at=NULL WHERE id=1");
    policy=new ExportPolicy(jdbc);tasks=new ExportRepository(jdbc,manager,JSON,policy,10);storage=new StorageService(PROPS,jdbc);
  }
  long activity(String status) {
    long id=sequence++;
    jdbc.update("INSERT INTO activity(id,department_id,activity_code,name,status,starts_at,ends_at,event_ends_at,created_by,updated_by) VALUES(?,1,?,?,?,'2020-01-01','2020-01-02','2020-01-03',1,1)",id,"EXP"+id,"导出测试"+id,status);
    return id;
  }
  Task create(long id,Filters filters) {return tasks.create(id,filters,UUID.randomUUID().toString(),ROOT);}
  CsvExportGenerator generator(int batch,long bytes) {
    // Snapshot and control operations deliberately use separate physical connections.
    var ds=new DriverManagerDataSource(URL,"root","export_test_only");var reads=new JdbcTemplate(ds);reads.setQueryTimeout(30);
    return new CsvExportGenerator(reads,new DataSourceTransactionManager(ds),new OrderQueryService(reads,new CryptoService(PROPS)),batch,120,bytes);
  }
  void seed(long id,int orders,int products) {
    long base=id*10000;
    jdbc.update("INSERT INTO stored_file(id,activity_id,storage_provider,bucket_name,object_key,original_filename,content_type,size_bytes,sha256,file_purpose) VALUES(?,?,'S3','export-test',?,'seed.xlsx','application/octet-stream',1,UNHEX(SHA2('seed',256)),'IMPORT_SOURCE')",base,id,"seed/"+id);
    jdbc.update("INSERT INTO import_task(id,activity_id,import_type,source_file_id,file_sha256,created_by,status) VALUES(?,?,'PRODUCT',?,UNHEX(SHA2('seed',256)),1,'COMPLETED')",base,id,base);
    jdbc.update("INSERT INTO import_publish_version(id,activity_id,data_type,version_no,source_import_task_id,created_by,status) VALUES(?,?,'PRODUCT',1,?,1,'PUBLISHED')",base,id,base);
    var productRows=new ArrayList<Object[]>();
    for(int p=1;p<=products;p++)productRows.add(new Object[]{base+p,id,"sku"+p,String.format("%03d",p),"测试商品"+p,base,base});
    jdbc.batchUpdate("INSERT INTO activity_product(id,activity_id,customer_type,rebate_status,business_key,material_code,material_name,case_price,source_import_task_id,data_version_id) VALUES(?,?,'ALL','ALL',?,?,?,10,?,?)",productRows);
    for(int start=1;start<=orders;start+=500) {
      var customers=new ArrayList<Object[]>();var bound=new ArrayList<Object[]>();var orderRows=new ArrayList<Object[]>();
      for(int i=start;i<=Math.min(orders,start+499);i++) {
        long key=base+i;String name="客户"+id+"_"+i,phone="139"+String.format("%08d",i);
        customers.add(new Object[]{key,name,name});
        bound.add(new Object[]{key,id,key,name,name,phone,new CryptoService(PROPS).lookupHash(phone),"139****"+phone.substring(7),base,base});
        orderRows.add(new Object[]{key,id,key,"000"+key,name,products,products*10,products});
      }
      jdbc.batchUpdate("INSERT INTO customer(id,customer_type,dealer_full_name,normalized_dealer_full_name) VALUES(?,'GENERAL',?,?)",customers);
      jdbc.batchUpdate("INSERT INTO activity_customer(id,activity_id,customer_id,customer_type,dealer_full_name,normalized_dealer_full_name,phone,phone_lookup_hash,phone_masked,source_import_task_id,data_version_id) VALUES(?,?,?,'GENERAL',?,?,?,?,?,?,?)",bound);
      jdbc.batchUpdate("INSERT INTO customer_order(id,activity_id,activity_customer_id,order_no,status,customer_type,region_code,branch_name_snapshot,dealer_full_name_snapshot,current_version_no,total_quantity,total_amount,total_tons,first_submitted_at,last_submitted_at,last_modified_at,created_source,last_modified_source) VALUES(?,?,?,?,'SUBMITTED','GENERAL','EAST','测试分公司',?,1,?,?,?,'2020-01-01 01:00:00','2020-01-02 02:00:00','2020-01-02 03:00:00','H5','H5')",orderRows);
    }
    jdbc.update("""
        INSERT INTO order_item(order_id,activity_product_id,line_no,material_code,material_name,product_line,variety_name,specification,case_pack,rebate_status,is_gift_box,quantity,case_price,base_case_price,line_amount,ton_case_factor,line_tons)
        SELECT o.id,p.id,CAST(p.material_code AS UNSIGNED),p.material_code,p.material_name,'项目组','品种','规格','箱规','ALL',FALSE,1,10,10,10,1,1
        FROM customer_order o JOIN activity_product p ON p.activity_id=o.activity_id WHERE o.activity_id=?
        """,id);
  }
  @Test void permissionsStatesDeduplicationAliasesQueueAndSingleClaim()throws Exception {
    long id=activity("FINISHED");String key="retry-key-one";Task first=tasks.create(id,ALL,key,ROOT);
    assertThat(tasks.create(id,ALL,key,ROOT).id()).isEqualTo(first.id());
    Task joined=tasks.create(id,ALL,"retry-key-two",ROOT);assertThat(joined.id()).isEqualTo(first.id());
    jdbc.update("UPDATE export_task SET status='FAILED' WHERE id=?",first.id());
    assertThat(tasks.create(id,ALL,"retry-key-two",ROOT).id()).isEqualTo(first.id());
    assertThatThrownBy(()->tasks.create(id,new Filters("SUBMITTED",null,null),key,ROOT)).isInstanceOf(DomainException.class);
    var department=new AdminPrincipal(2,"dept","部门","DEPARTMENT_ADMIN",1L,"默认",false);
    assertThatThrownBy(()->tasks.create(id,ALL,"denied-key",department)).isInstanceOf(DomainException.class);
    for(String status:List.of("ACTIVE","SCHEDULED","CLOSED","DRAFT")) {
      long ongoing=activity(status);jdbc.update("UPDATE activity SET event_ends_at='2099-01-02' WHERE id=?",ongoing);
      assertThatThrownBy(()->create(ongoing,ALL)).isInstanceOf(DomainException.class);
    }
    assertThat(create(activity("ARCHIVED"),ALL).status()).isEqualTo("PENDING");
    // An elapsed whole-event end follows the existing effective activity status rule.
    assertThat(create(activity("CLOSED"),ALL).status()).isEqualTo("PENDING");
    for(int i=0;i<8;i++)create(id,new Filters(null,null,"filter"+i));
    assertThatThrownBy(()->create(id,new Filters(null,null,"overflow"))).isInstanceOf(DomainException.class).extracting(e->((DomainException)e).code()).isEqualTo("EXPORT_QUEUE_FULL");
    Claim claim=tasks.claim();assertThat(claim).isNotNull();assertThat(tasks.claim()).isNull();assertThat(tasks.heartbeat(claim)).isTrue();
    tasks.cancel(claim.task().activityId(),claim.task().id());assertThat(tasks.heartbeat(claim)).isFalse();
    assertThat(tasks.task(claim.task().activityId(),claim.task().id()).status()).isEqualTo("RUNNING");
    tasks.fail(claim,"EXPORT_CANCELLED","导出已取消");tasks.release(claim);
    assertThat(tasks.claim()).isNotNull();
  }
  @Test void concurrentSubmissionsJoinOneTaskAndExpiredLeaseFencesOldWorker()throws Exception {
    long id=activity("FINISHED");
    try(var executor=Executors.newFixedThreadPool(4)) {
      var calls=new ArrayList<Future<Task>>();for(int i=0;i<4;i++)calls.add(executor.submit(()->create(id,ALL)));
      var ids=new HashSet<Long>();for(var call:calls)ids.add(call.get(10,TimeUnit.SECONDS).id());assertThat(ids).hasSize(1);
    }
    Claim old=tasks.claim();jdbc.update("UPDATE order_export_worker SET lease_expires_at=TIMESTAMPADD(SECOND,-1,UTC_TIMESTAMP(3)) WHERE id=1");
    assertThat(tasks.heartbeat(old)).isFalse();Claim resumed=tasks.claim();assertThat(resumed.task().id()).isEqualTo(old.task().id());
    assertThat(resumed.token()).isNotEqualTo(old.token());
    assertThatThrownBy(()->tasks.progress(old,"UPLOADING",0,0)).isInstanceOf(DomainException.class);
    assertThatThrownBy(()->tasks.complete(old,1,new Result(directory,null,List.of(0L,0L,0L,0L)),24)).isInstanceOf(DomainException.class);
    tasks.fail(old,"OLD","old");tasks.release(old);assertThat(tasks.heartbeat(resumed)).isTrue();
    for(int attempt=0;attempt<3;attempt++) {jdbc.update("UPDATE order_export_worker SET lease_expires_at=TIMESTAMPADD(SECOND,-1,UTC_TIMESTAMP(3)) WHERE id=1");resumed=tasks.claim();if(resumed==null)break;}
    assertThat(tasks.task(id,old.task().id()).status()).isEqualTo("FAILED");
  }
  @Test void fourCsvsUseOneSnapshotAndPreserveFilterAggregateSemantics()throws Exception {
    long id=activity("FINISHED");seed(id,3,2);long base=id*10000;
    jdbc.update("UPDATE customer_order SET status='WITHDRAWN' WHERE id=?",base+2);
    jdbc.update("UPDATE customer_order SET customer_type='SPECIAL' WHERE id=?",base+3);
    Task task=create(id,new Filters(null,"GENERAL",null));var changed=new java.util.concurrent.atomic.AtomicBoolean();
    Result result=generator(1,1000000).generate(task,directory,(stage,o,d)->{
      if(o==2 && changed.compareAndSet(false,true))jdbc.update("UPDATE order_item SET line_amount=99,variety_name='快照后品种',specification='快照后规格',base_case_price=999.9876,applied_tier_min_quantity=10 WHERE order_id=?",base+1);
    });
    assertThat(result.counts()).containsExactly(2L,4L,2L,1L);assertThat(result.snapshotAt()).isNotNull();
    try(var zip=new ZipFile(result.zip().toFile(),StandardCharsets.UTF_8)) {
      assertThat(zip.stream().map(e->e.getName()).toList()).containsExactly(CsvExportGenerator.NAMES);
      String summary=read(zip,0),details=read(zip,1),products=read(zip,2);
      assertThat(summary).contains("13900000001","2020-01-01 09:00:00").doesNotContain("客户"+id+"_3");
      assertThat(details).contains("\"10.00\"","\"品种\",\"规格\",\"项目组\",\"1\",\"10.0000\",\"否\"")
          .doesNotContain("\"99.00\"","快照后品种","快照后规格","999.9876","\"是\"");
      assertThat(products).contains("\"10.00\"");
      assertThat(details.split("\r\n")[0].split(",")).hasSize(21);
    }
    Result withdrawn=generator(1,1000000).generate(create(id,new Filters("WITHDRAWN","GENERAL",null)),directory.resolve("withdrawn"),(s,o,d)->{});
    assertThat(withdrawn.counts()).containsExactly(1L,2L,2L,1L);
    Result phone=generator(2,1000000).generate(create(id,new Filters(null,null,"13900000001")),directory.resolve("phone"),(s,o,d)->{});
    assertThat(phone.counts()).containsExactly(1L,2L,2L,1L);
    Result empty=generator(2,1000000).generate(create(id,new Filters(null,null,"不存在")),directory.resolve("empty"),(s,o,d)->{});
    assertThat(empty.counts()).containsExactly(0L,0L,0L,0L);
    assertThatThrownBy(()->generator(1,100).generate(task,directory.resolve("limit"),(s,o,d)->{})).isInstanceOf(IOException.class).hasMessage("EXPORT_TEMP_LIMIT");
  }
  @Test void detailColumnsUseStoredSnapshotsAndActualTierHits()throws Exception {
    long id=activity("FINISHED");seed(id,1,7);long orderId=id*10000+1;
    jdbc.update("UPDATE activity_product SET variety_name='当前商品品种',specification='当前商品规格',case_price=9999 WHERE activity_id=?",id);
    String incremental="""
        {"tiers":[{"minQuantity":1,"casePrice":100},{"minQuantity":10,"casePrice":90},{"minQuantity":20,"casePrice":80}],
         "segments":[{"minQuantity":1,"maxQuantity":9,"quantity":9,"casePrice":100,"amount":900},
                     {"minQuantity":10,"maxQuantity":19,"quantity":10,"casePrice":90,"amount":900},
                     {"minQuantity":20,"maxQuantity":null,"quantity":6,"casePrice":80,"amount":480}]}
        """;
    String firstTierOnly="""
        {"tiers":[{"minQuantity":1,"casePrice":70.1234}],
         "segments":[{"minQuantity":1,"maxQuantity":null,"quantity":5,"casePrice":70.1234,"amount":350.62}]}
        """;
    jdbc.batchUpdate("""
        UPDATE order_item SET variety_name=?,specification=?,quantity=?,case_price=?,base_case_price=?,base_price_quantity=?,
          tier_case_price=?,tier_min_quantity=?,tier_price_quantity=?,applied_tier_min_quantity=?,pricing_mode=?,line_amount=?,pricing_details=?
        WHERE order_id=? AND line_no=?
        """,List.of(
        new Object[]{"普通品种","500mL",3,"10.1234","10.1234",3,null,null,0,null,null,"30.37",null,orderId,1},
        new Object[]{"未达门槛","500mL",9,"100","100",9,"90",10,0,null,"WHOLE_ORDER","900",null,orderId,2},
        new Object[]{"整批优惠","500mL",10,"90","100",0,"90",10,10,10,"WHOLE_ORDER","900",null,orderId,3},
        new Object[]{"多档分段","500mL",25,"100","100",9,"80",20,16,20,"INCREMENTAL","2280",incremental,orderId,4},
        new Object[]{"独立第一档","500mL",5,"70.1234","70.1234",5,null,null,0,null,"INCREMENTAL","350.62",firstTierOnly,orderId,5},
        new Object[]{null,null,1,"123.4567",null,null,null,null,null,null,null,"123.46",null,orderId,6},
        new Object[]{"品种,\"A\"\r\n第二行","=SUM(1,2)",3,"0.1234","0.1234",3,null,null,0,null,null,"0.37",null,orderId,7}));
    jdbc.update("""
        UPDATE customer_order SET total_quantity=(SELECT SUM(quantity) FROM order_item WHERE order_id=?),
          total_amount=(SELECT SUM(line_amount) FROM order_item WHERE order_id=?) WHERE id=?
        """,orderId,orderId,orderId);
    Result result=generator(2,1000000).generate(create(id,ALL),directory,(s,o,d)->{});
    assertThat(result.counts()).containsExactly(1L,7L,7L,1L);
    try(var zip=new ZipFile(result.zip().toFile(),StandardCharsets.UTF_8)) {
      assertThat(zip.stream().map(e->e.getName()).toList()).containsExactly(CsvExportGenerator.NAMES);
      String details=read(zip,1);
      String header="\ufeff"+String.join(",",Arrays.stream(CsvExportGenerator.HEADERS[1]).map(h->"\""+h+"\"").toList())+"\r\n";
      String prefix="\"000"+orderId+"\",\"SUBMITTED\",\"客户\",\"GENERAL\",\"EAST\",\"测试分公司\",\"客户"+id+"_1\",\"13900000001\",\"1\",";
      String suffix=",\"1.000000\",\"2020-01-02 10:00:00\"\r\n";
      assertThat(details).isEqualTo(header
          +prefix+"\"1\",\"001\",\"测试商品1\",\"普通品种\",\"500mL\",\"项目组\",\"3\",\"10.1234\",\"否\",\"30.37\""+suffix
          +prefix+"\"2\",\"002\",\"测试商品2\",\"未达门槛\",\"500mL\",\"项目组\",\"9\",\"100.0000\",\"否\",\"900.00\""+suffix
          +prefix+"\"3\",\"003\",\"测试商品3\",\"整批优惠\",\"500mL\",\"项目组\",\"10\",\"100.0000\",\"是\",\"900.00\""+suffix
          +prefix+"\"4\",\"004\",\"测试商品4\",\"多档分段\",\"500mL\",\"项目组\",\"25\",\"100.0000\",\"是\",\"2280.00\""+suffix
          +prefix+"\"5\",\"005\",\"测试商品5\",\"独立第一档\",\"500mL\",\"项目组\",\"5\",\"70.1234\",\"否\",\"350.62\""+suffix
          +prefix+"\"6\",\"006\",\"测试商品6\",\"\",\"\",\"项目组\",\"1\",\"\",\"否\",\"123.46\""+suffix
          +prefix+"\"7\",\"007\",\"测试商品7\",\"品种,\"\"A\"\"\r\n第二行\",\"'=SUM(1,2)\",\"项目组\",\"3\",\"0.1234\",\"否\",\"0.37\""+suffix);
    }
  }
  static String read(ZipFile zip,int index)throws IOException {try(var input=zip.getInputStream(zip.getEntry(CsvExportGenerator.NAMES[index]))){return new String(input.readAllBytes(),StandardCharsets.UTF_8);}}
  @Test void fourThousandOrdersWithFiftyItemsStreamToZip()throws Exception {
    long id=activity("FINISHED");seed(id,4000,50);Task task=create(id,ALL);long start=System.nanoTime();
    Result result=generator(2000,128L*1024*1024).generate(task,directory,(s,o,d)->{});
    assertThat(result.counts()).containsExactly(4000L,200000L,50L,1L);
    try(var zip=new ZipFile(result.zip().toFile(),StandardCharsets.UTF_8)) {
      for(int i=0;i<4;i++)try(var reader=new BufferedReader(new InputStreamReader(zip.getInputStream(zip.getEntry(CsvExportGenerator.NAMES[i])),StandardCharsets.UTF_8))) {
        assertThat(reader.readLine()).startsWith("\ufeff");long count=0;String row;
        while((row=reader.readLine())!=null) {if(count==0 && i==1)assertThat(row.split(",")).hasSize(21);count++;}
        assertThat(count).isEqualTo(result.counts().get(i));
      }
    }
    System.out.printf("EXPORT_SCALE orders=4000 details=200000 seconds=%.3f zipBytes=%d%n",(System.nanoTime()-start)/1e9,Files.size(result.zip()));
  }
  @Test void runnerStreamsStorageDownloadExpiryAndDeletesTemporaryFiles()throws Exception {
    long id=activity("ARCHIVED");seed(id,2,2);Task task=create(id,ALL);
    try(var runner=new ExportRunner(tasks,policy,generator(2,1000000),storage,directory,1048576,24)){runner.tick();}
    Task done=tasks.task(id,task.id());assertThat(done.status()).isEqualTo("COMPLETED");assertThat(done.sheetCounts()).containsExactly(2L,4L,2L,1L);
    assertThat(done.expiresAt()).isBetween(Instant.now().plusSeconds(23*3600),Instant.now().plusSeconds(25*3600));
    try(var dirs=Files.list(directory)){assertThat(dirs.toList()).isEmpty();}
    var meta=storage.meta(done.fileId());try(var input=storage.openExport(meta)){assertThat(input.read()).isEqualTo('P');assertThat(input.read()).isEqualTo('K');}
    var auth=mock(AuthService.class);when(auth.requireAdmin(any())).thenReturn(ROOT);
    var mvc=MockMvcBuilders.standaloneSetup(new OrderExportController(tasks,policy,auth,storage)).setControllerAdvice(new GlobalExceptionHandler()).build();
    mvc.perform(get("/admin/activities/"+id+"/exports/"+task.id()+"/download")).andExpect(status().isOk()).andExpect(content().contentType("application/zip")).andExpect(header().string("Cache-Control","no-store"));
    mvc.perform(get("/admin/activities/"+id+"/exports")).andExpect(status().isOk()).andExpect(jsonPath("$.data[0].leaseToken").doesNotExist()).andExpect(jsonPath("$.data[0].fileId").doesNotExist());
    jdbc.update("UPDATE export_task SET expires_at=TIMESTAMPADD(SECOND,-1,UTC_TIMESTAMP(3)) WHERE id=?",task.id());
    mvc.perform(get("/admin/activities/"+id+"/exports/"+task.id()+"/download")).andExpect(status().isConflict());
    try(var runner=new ExportRunner(tasks,policy,generator(2,1000000),storage,directory,1048576,24)){runner.tick();}
    assertThat(tasks.task(id,task.id()).status()).isEqualTo("EXPIRED");assertThat(tasks.task(id,task.id()).fileId()).isNull();
    assertThatThrownBy(()->storage.meta(meta.id())).isInstanceOf(DomainException.class);
  }
  @Test void reopenCancelsPendingKeepsRunningBarrierAndPreventsOldDownloads()throws Exception {
    long id=activity("FINISHED");Task completed=create(id,ALL);jdbc.update("UPDATE export_task SET status='COMPLETED' WHERE id=?",completed.id());
    Task pending=create(id,new Filters(null,null,"pending")),running=create(id,new Filters(null,null,"running"));
    Claim claim=tasks.claim();assertThat(claim.task().id()).isEqualTo(pending.id());
    var access=new DepartmentAccessService(jdbc);var activities=new ActivityService(jdbc,x->{},access);
    var tx=new TransactionTemplate(manager);
    tx.execute(s->activities.reopen(id,0,Instant.now().plusSeconds(3600),Instant.now().plusSeconds(7200),"重新开放测试","test",ROOT));
    assertThat(tasks.task(id,completed.id()).status()).isEqualTo("EXPIRED");assertThat(tasks.task(id,running.id()).status()).isEqualTo("FAILED");
    assertThat(tasks.task(id,pending.id()).status()).isEqualTo("RUNNING");assertThat(tasks.heartbeat(claim)).isFalse();
    assertThatThrownBy(()->policy.requireTask(completed)).isInstanceOf(DomainException.class);
    jdbc.update("UPDATE activity SET status='FINISHED',ends_at=UTC_TIMESTAMP(3),event_ends_at=UTC_TIMESTAMP(3) WHERE id=?",id);
    assertThatThrownBy(()->policy.requireTask(completed)).isInstanceOf(DomainException.class);
    var lifecycle=new ActivityLifecycleManagement(jdbc,activities,access,mock(DashboardService.class));
    assertThatThrownBy(()->tx.execute(s->lifecycle.delete(id,1,"EXP"+id,"删除测试",ROOT))).isInstanceOf(DomainException.class);
    tasks.fail(claim,"EXPORT_CANCELLED","已停止");tasks.release(claim);
    assertThat(tx.execute(s->lifecycle.delete(id,1,"EXP"+id,"删除测试",ROOT)).status()).isEqualTo("QUEUED");
    assertThatThrownBy(()->create(id,ALL)).isInstanceOf(DomainException.class);assertThatThrownBy(()->policy.requireTask(completed)).isInstanceOf(DomainException.class);
    var deletion=new ActivityDeletionWorker(jdbc,manager,mock(StorageService.class),100,2,100);
    for(int step=0;step<100 && jdbc.queryForObject("SELECT COUNT(*) FROM activity WHERE id=?",Long.class,id)>0;step++) {
      jdbc.update("UPDATE activity_deletion_worker SET next_run_at=UTC_TIMESTAMP(3)");deletion.tick();
    }
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM activity WHERE id=?",Long.class,id)).isZero();
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM order_export_request WHERE task_id IN (?,?,?)",Long.class,completed.id(),pending.id(),running.id())).isZero();
  }
  @Test void controllerChecksRoleEndedAndRetiresOldEndpointAndGenericFileBypass()throws Exception {
    long id=activity("FINISHED");var auth=mock(AuthService.class);when(auth.requireAdmin(any())).thenReturn(ROOT);
    var mvc=MockMvcBuilders.standaloneSetup(new OrderExportController(tasks,policy,auth,storage),new OrderController(mock(OrderService.class),mock(OrderDraftService.class),auth,mock(com.fengyi.ordershow.order.H5CustomerWriteGuard.class)),new FileController(storage,jdbc,auth,new DepartmentAccessService(jdbc),mock(ImageVariantService.class))).setControllerAdvice(new GlobalExceptionHandler()).build();
    String base="/admin/activities/"+id;
    mvc.perform(post(base+"/exports").header("Idempotency-Key","mvc-request-key").contentType("application/json").content("{\"exportType\":\"ORDER_PACKAGE\",\"filters\":{}}")).andExpect(status().isAccepted()).andExpect(jsonPath("$.data.status").value("PENDING"));
    mvc.perform(get(base+"/orders/export")).andExpect(status().isGone());
    long file=id*10000;jdbc.update("INSERT INTO stored_file(id,activity_id,storage_provider,bucket_name,object_key,original_filename,content_type,size_bytes,sha256,file_purpose) VALUES(?,?,'S3','export-test',?,'export.zip','application/zip',1,UNHEX(SHA2('test',256)),'EXPORT_RESULT')",file,id,"bypass/"+id);
    mvc.perform(get("/public/files/"+file)).andExpect(status().isNotFound());
    when(auth.requireAdmin(any())).thenReturn(new AdminPrincipal(2,"dept","部门","DEPARTMENT_ADMIN",1L,"默认",false));
    mvc.perform(get(base+"/exports")).andExpect(status().isForbidden());
    when(auth.requireAdmin(any())).thenReturn(ROOT);jdbc.update("UPDATE activity SET status='CLOSED',event_ends_at='2099-01-02' WHERE id=?",id);
    mvc.perform(get(base+"/exports")).andExpect(status().isConflict());
  }
  @Test void independentWorkerHasTwoSingleConnectionPoolsAndNoBusinessOrMigrationBeans() {
    new org.springframework.boot.test.context.runner.ApplicationContextRunner()
        .withUserConfiguration(ExportWorkerApplication.class)
        .withPropertyValues("order-show.export.worker=true","spring.datasource.url="+URL,"spring.datasource.username=root",
            "spring.datasource.password=export_test_only","order-show.storage.endpoint=http://127.0.0.1:33328",
            "order-show.storage.access-key=export_test","order-show.storage.secret-key=export_test_only",
            "order-show.storage.bucket=export-test","order-show.phone-hmac-key=test-hmac",
            "order-show.phone-encryption-key=test-encryption","order-show.export.temp-dir="+directory,
            "order-show.export.tick-ms=3600000")
        .run(context->{
          assertThat(context).hasNotFailed().hasSingleBean(ExportRunner.class).doesNotHaveBean(ActivityDeletionWorker.class)
              .doesNotHaveBean(OrderService.class).doesNotHaveBean(Flyway.class);
          assertThat(context.getBeansOfType(com.zaxxer.hikari.HikariDataSource.class)).hasSize(2)
              .allSatisfy((name,pool)->assertThat(pool.getMaximumPoolSize()).isEqualTo(1));
        });
  }
  @Test void realInterceptorsRequireCsrfAndActivityAdvisorAllowsArchivedExport()throws Exception {
    long id=activity("ARCHIVED");var auth=mock(AuthService.class);when(auth.requireAdmin(any())).thenReturn(ROOT);
    doAnswer(call->{var req=call.getArgument(0,jakarta.servlet.http.HttpServletRequest.class);
      if(!"test-csrf".equals(req.getHeader("X-CSRF-Token")))throw DomainException.forbidden("CSRF_INVALID","请求校验失败");return null;
    }).when(auth).requireCsrf(any(),eq(true));
    try(var context=new org.springframework.web.context.support.AnnotationConfigWebApplicationContext()) {
      context.setServletContext(new org.springframework.mock.web.MockServletContext());
      var security=new org.springframework.web.servlet.config.annotation.WebMvcConfigurer() {
        @Override public void addInterceptors(org.springframework.web.servlet.config.annotation.InterceptorRegistry registry) {
          new com.fengyi.ordershow.config.SecurityConfiguration(auth,PROPS,mock(com.fengyi.ordershow.audit.AuditService.class),new DepartmentAccessService(jdbc),new MemberPermissionService(jdbc)).addInterceptors(registry);
        }
      };
      context.addBeanFactoryPostProcessor(factory->{
        factory.registerSingleton("testJdbc",jdbc);factory.registerSingleton("transactionManager",manager);
        factory.registerSingleton("testExports",tasks);factory.registerSingleton("testExportPolicy",policy);
        factory.registerSingleton("testStorage",storage);factory.registerSingleton("testAuth",auth);
        factory.registerSingleton("testActivityPolicy",new ActivityAccessPolicy(jdbc));factory.registerSingleton("testSecurity",security);
      });
      context.register(MvcConfiguration.class);context.refresh();
      assertThat(org.springframework.aop.support.AopUtils.isAopProxy(context.getBean(OrderExportController.class))).isTrue();
      var mvc=MockMvcBuilders.webAppContextSetup(context).build();String path="/api/v1/admin/activities/"+id+"/exports";
      String body="{\"exportType\":\"ORDER_PACKAGE\",\"filters\":{}}";
      mvc.perform(post(path).contextPath("/api/v1").header("Idempotency-Key","interceptor-test").contentType("application/json").content(body)).andExpect(status().isForbidden());
      mvc.perform(post(path).contextPath("/api/v1").header("X-CSRF-Token","test-csrf").header("Idempotency-Key","interceptor-test").contentType("application/json").content(body)).andExpect(status().isAccepted());
      mvc.perform(post(path).contextPath("/api/v1").header("X-CSRF-Token","test-csrf").contentType("application/json").content(body)).andExpect(status().isBadRequest());
      long task=tasks.list(id).getFirst().id();
      mvc.perform(post(path+"/"+task+"/cancel").contextPath("/api/v1").header("X-CSRF-Token","test-csrf")).andExpect(status().isOk());
      when(auth.requireAdmin(any())).thenReturn(new AdminPrincipal(2,"dept","部门","DEPARTMENT_ADMIN",1L,"默认",false));
      mvc.perform(get(path).contextPath("/api/v1")).andExpect(status().isForbidden());
      jdbc.update("UPDATE activity SET deletion_requested_at=UTC_TIMESTAMP(3) WHERE id=?",id);
      when(auth.requireAdmin(any())).thenReturn(ROOT);
      mvc.perform(get(path).contextPath("/api/v1")).andExpect(status().isNotFound());
    }
  }
  @org.springframework.context.annotation.Configuration
  @org.springframework.web.servlet.config.annotation.EnableWebMvc
  @org.springframework.transaction.annotation.EnableTransactionManagement
  @org.springframework.context.annotation.Import({ActivityWriteConfiguration.class,ActivityReadConfiguration.class,OrderExportController.class,GlobalExceptionHandler.class})
  static class MvcConfiguration {}
  @Test void uploadFailureIsReportedCleansTempAndAllowsFreshTask()throws Exception {
    long id=activity("FINISHED");seed(id,1,2);Task task=create(id,ALL);var failedStorage=spy(storage);
    doThrow(new IOException("private storage error")).when(failedStorage).uploadExport(any(),any());
    doAnswer(call->{var file=call.getArgument(0,StorageService.FileMeta.class);
      jdbc.update("UPDATE stored_file SET deleted_at=UTC_TIMESTAMP(3) WHERE id=?",file.id());return null;
    }).when(failedStorage).discardExport(any());
    try(var runner=new ExportRunner(tasks,policy,generator(2,1000000),failedStorage,directory,1048576,24)){runner.tick();}
    Task failed=tasks.task(id,task.id());assertThat(failed.status()).isEqualTo("FAILED");
    assertThat(failed.failureCode()).isEqualTo("EXPORT_GENERATION_FAILED");assertThat(failed.failureMessage()).doesNotContain("private");
    verify(failedStorage).discardExport(any());try(var files=Files.list(directory)){assertThat(files.toList()).isEmpty();}
    Task retry=create(id,ALL);assertThat(retry.id()).isNotEqualTo(task.id());
    try(var runner=new ExportRunner(tasks,policy,generator(2,1000000),storage,directory,1048576,24)){runner.tick();}
    assertThat(tasks.task(id,retry.id()).status()).isEqualTo("COMPLETED");
  }
}
