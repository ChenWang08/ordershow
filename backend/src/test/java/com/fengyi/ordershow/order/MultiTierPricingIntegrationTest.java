package com.fengyi.ordershow.order;

import static org.assertj.core.api.Assertions.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengyi.ordershow.catalog.ProductService;
import com.fengyi.ordershow.catalog.H5CatalogService;
import com.fengyi.ordershow.dashboard.DashboardSummaryStore;
import com.fengyi.ordershow.security.H5Principal;
import java.math.BigDecimal;
import java.net.URI;
import java.net.http.*;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** All data is synthetic. Fixed private DNS/database and no host ports or business volumes. */
@EnabledIfEnvironmentVariable(named="ORDER_SHOW_PRICE_TIER_TEST",matches="order-show-price-tier-test")
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={
    "spring.datasource.url=jdbc:mysql://mysql:3306/order_show_price_tier_test?allowPublicKeyRetrieval=true&useSSL=false&serverTimezone=UTC",
    "spring.datasource.username=root","spring.datasource.password=price_tier_test_only",
    "spring.flyway.user=root","spring.flyway.password=price_tier_test_only",
    "spring.data.redis.host=redis","spring.data.redis.password=",
    "spring.datasource.hikari.minimum-idle=2","spring.datasource.hikari.maximum-pool-size=20",
    "H5_WRITE_CONCURRENCY=12",
    "order-show.bootstrap-admin-password=PriceTierTestOnly123!","H5_WARMUP_ENABLED=false",
    "order-show.dashboard.summary-enabled=true","logging.level.com.fengyi.ordershow.order.OrderService=WARN"
})
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class MultiTierPricingIntegrationTest {
  @Autowired JdbcTemplate jdbc;
  @Autowired ProductService products;
  @Autowired OrderService orders;
  @Autowired H5CatalogService catalog;
  @Autowired DashboardSummaryStore summaries;
  @Autowired ObjectMapper json;
  @Autowired PlatformTransactionManager transactions;
  @LocalServerPort int port;
  private final HttpClient http=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
  private static final String RULES="[{\"minQuantity\":500,\"casePrice\":290},{\"minQuantity\":1000,\"casePrice\":280}]";
  private static final long A=980001, B=980002, C=980003;

  @Test @Order(1) void rulesSnapshotsRollbackCacheAndConcurrentSubmission() throws Exception {
    seed(A,8,4,0);
    var initial=submit(A,1,2);
    submit(A,2,2);
    long order=initial.path("id").asLong();
    assertThat(initial.path("totalAmount").decimalValue()).isEqualByComparingTo("360600");
    var identity=identity(A,1);
    assertThat(catalog.products(code(A),identity,null,null).getFirst().priceTier()).isNull();
    patch(A,"WHOLE_ORDER",RULES);
    assertThat(current(A,1).totalAmount()).isEqualByComparingTo("336600");
    assertThat(catalog.products(code(A),identity,null,null).getFirst().priceTier().tiers()).hasSize(3);
    assertThat(current(A,1).items().getFirst().pricingDetails().segments()).hasSize(1);
    assertThat(current(A,1).versions().getFirst().items()).hasSize(2);
    assertThat(historyAmount(A,1)).isEqualByComparingTo("360600");
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM order_version_item WHERE order_version_id=(SELECT id FROM order_version WHERE order_id=? AND version_no=1)",Integer.class,order)).isEqualTo(1);
    submit(A,4,2);
    // Price deltas must also repair missing or dirty read models, using full rebuild only for those orders.
    jdbc.update("UPDATE order_dashboard_stat SET dirty=TRUE WHERE order_id=?",order);
    jdbc.update("DELETE FROM order_dashboard_stat WHERE order_id=?",current(A,2).id());
    patch(A,"INCREMENTAL",RULES);
    assertThat(current(A,1).totalAmount()).isEqualByComparingTo("351580");
    assertThat(current(A,1).items().getFirst().pricingDetails().segments()).hasSize(3);
    int lock=current(A,1).lockVersion();
    patch(A,"INCREMENTAL",RULES);
    assertThat(current(A,1).lockVersion()).isEqualTo(lock);
    assertThat(historyAmount(A,1)).isEqualByComparingTo("360600");
    assertThat(historyAmount(A,4)).isEqualByComparingTo("336600");
    assertThat(current(A,4).versions().getFirst().items().getFirst().pricingDetails().tiers()).hasSize(3);
    assertConsistent(A);

    // Fail a later order after the first order's updates: product, details, totals, events and catalog version all roll back.
    long failingOrder=current(A,2).id();
    int version=productVersion(A);
    long catalogVersion=jdbc.queryForObject("SELECT product_catalog_version FROM activity WHERE id=?",Long.class,A);
    jdbc.execute("CREATE TRIGGER price_tier_test_failure BEFORE UPDATE ON order_item FOR EACH ROW BEGIN IF NEW.order_id="+failingOrder+" THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic late failure'; END IF; END");
    try {
      assertThatThrownBy(()->patch(A,"WHOLE_ORDER",RULES)).isInstanceOf(RuntimeException.class);
      assertThat(productVersion(A)).isEqualTo(version);
      assertThat(current(A,1).totalAmount()).isEqualByComparingTo("351580");
      assertThat(jdbc.queryForObject("SELECT product_catalog_version FROM activity WHERE id=?",Long.class,A)).isEqualTo(catalogVersion);
    } finally { jdbc.execute("DROP TRIGGER price_tier_test_failure"); }

    // A submit waiting behind the price save must use the committed new rule, never the old H5 catalog amount.
    var held=new CountDownLatch(1); var release=new CountDownLatch(1);
    try(var pool=Executors.newVirtualThreadPerTaskExecutor()) {
      var writer=pool.submit(()->new TransactionTemplate(transactions).execute(status->{
        jdbc.queryForList("SELECT id FROM activity WHERE id=? FOR UPDATE",A);held.countDown();
        try { if(!release.await(5,TimeUnit.SECONDS))throw new IllegalStateException("release timeout"); }
        catch(InterruptedException e){Thread.currentThread().interrupt();throw new IllegalStateException(e);}
        patch(A,"WHOLE_ORDER",RULES);return true;
      }));
      try {
        assertThat(held.await(5,TimeUnit.SECONDS)).isTrue();
        var waiting=pool.submit(()->submit(A,3,1));
        assertThatThrownBy(()->waiting.get(150,TimeUnit.MILLISECONDS)).isInstanceOf(TimeoutException.class);
        release.countDown();writer.get(20,TimeUnit.SECONDS);
        assertThat(waiting.get(20,TimeUnit.SECONDS).path("totalAmount").decimalValue()).isEqualByComparingTo("336000");
      } finally { release.countDown(); }
    }
    patch(A,"WHOLE_ORDER","[]");
    assertThat(current(A,1).totalAmount()).isEqualByComparingTo("360600");
    assertThat(current(A,1).items().getFirst().pricingDetails()).isNull();
    assertThat(current(A,1).currentVersion()).isEqualTo(1);
    assertConsistent(A);
    var modified=submit(A,1,2,1,1300,"-increase");
    assertThat(modified.path("currentVersion").asInt()).isEqualTo(2);
    assertThat(jdbc.queryForObject("SELECT SUM(line_amount) FROM order_version_item WHERE order_version_id=(SELECT id FROM order_version WHERE order_id=? AND version_no=1)",BigDecimal.class,order)).isEqualByComparingTo("360600");
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM order_version_item WHERE order_version_id=(SELECT id FROM order_version WHERE order_id=? AND version_no=1)",Integer.class,order)).isEqualTo(2);
  }

  @Test @Order(2) void threeThousandOrdersWithFiveHttpSubmissionsPerSecondDuringPriceSaves() throws Exception {
    seed(B,3300,180,3000);
    // 3000 verified sessions read their catalogs once; idle sessions do not poll.
    try(var pool=Executors.newFixedThreadPool(20)) {
      var reads=new ArrayList<Future<Integer>>();
      for(int i=1;i<=3000;i++) { final int n=i; reads.add(pool.submit(()->http.send(request(B,n,"/products").GET().build(),HttpResponse.BodyHandlers.discarding()).statusCode())); }
      for(var read:reads) assertThat(read.get(90,TimeUnit.SECONDS)).isEqualTo(200);
    }
    var samples=Collections.synchronizedList(new ArrayList<long[]>());
    var failures=Collections.synchronizedList(new ArrayList<String>());
    var futures=new ArrayList<CompletableFuture<Void>>();
    long started=System.nanoTime();
    var saves=new ArrayList<Map<String,Object>>();
    try(var scheduler=Executors.newSingleThreadScheduledExecutor();var pool=Executors.newVirtualThreadPerTaskExecutor()) {
      for(int i=0;i<300;i++) {
        final int n=3001+i;
        var done=new CompletableFuture<Void>();futures.add(done);
        scheduler.schedule(()->pool.submit(()->{
          long at=System.nanoTime();
          try { var result=submit(B,n,180);assertThat(result.path("items").size()).isEqualTo(180);
            samples.add(new long[]{TimeUnit.NANOSECONDS.toMillis(at-started),TimeUnit.NANOSECONDS.toMillis(System.nanoTime()-at)});done.complete(null);
          } catch(Throwable error){failures.add("customer="+n+" "+error);done.completeExceptionally(error);}
        }),i*200L,TimeUnit.MILLISECONDS);
      }
      for(int phase=0;phase<2;phase++) {
        long due=TimeUnit.SECONDS.toNanos(10+phase*25L)-(System.nanoTime()-started);
        if(due>0) TimeUnit.NANOSECONDS.sleep(due);
        long before=System.nanoTime();
        patch(B,phase==0?"WHOLE_ORDER":"INCREMENTAL",RULES);
        saves.add(Map.of("mode",phase==0?"WHOLE_ORDER":"INCREMENTAL","startedMs",TimeUnit.NANOSECONDS.toMillis(before-started),"elapsedMs",TimeUnit.NANOSECONDS.toMillis(System.nanoTime()-before)));
        System.out.println("PRICE_TIER_SAVE "+json.writeValueAsString(saves.getLast()));
      }
      CompletableFuture.allOf(futures.toArray(CompletableFuture[]::new)).handle((ignored,error)->error).get(90,TimeUnit.SECONDS);
    }
    long[] latencies=samples.stream().mapToLong(sample->sample[1]).sorted().toArray();
    var report=new LinkedHashMap<String,Object>();
    report.put("existingOrders",3000);report.put("itemsPerOrder",180);report.put("catalogReads",3000);report.put("newHttpSubmissions",300);
    report.put("successfulSubmissions",samples.size());report.put("failures",failures);report.put("databasePool",20);report.put("h5WritePermits",12);
    report.put("historySnapshotRows",jdbc.queryForObject("SELECT COUNT(*) FROM order_version_item i JOIN order_version v ON v.id=i.order_version_id WHERE v.activity_id=?",Long.class,B));
    report.put("submissionP95Millis",latencies[(int)Math.ceil(latencies.length*.95)-1]);report.put("submissionMaxMillis",latencies[latencies.length-1]);report.put("priceSaves",saves);report.put("samples",samples);
    java.nio.file.Files.writeString(java.nio.file.Path.of("../outputs/price-tier-mixed-performance.json"),json.writerWithDefaultPrettyPrinter().writeValueAsString(report));
    System.out.println("PRICE_TIER_MIXED_RESULT "+json.writeValueAsString(report.entrySet().stream().filter(entry->!entry.getKey().equals("samples")).collect(java.util.stream.Collectors.toMap(Map.Entry::getKey,Map.Entry::getValue))));
    assertThat(failures).isEmpty();
    assertThat(samples).hasSize(300);
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM customer_order WHERE activity_id=?",Integer.class,B)).isEqualTo(3300);
    assertConsistent(B);
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM order_item i JOIN customer_order o ON o.id=i.order_id WHERE o.activity_id=? AND i.activity_product_id=? AND JSON_LENGTH(i.pricing_details,'$.tiers')<>3",Integer.class,B,product(B))).isZero();
  }

  @Test @Order(3) void independentFirstTierRepricesExistingOrdersAndOrdinaryPriceChangesLeaveThemAlone() throws Exception {
    seed(C,5,2,0);
    submit(C,1,1,0,99,"");
    String rules="[{\"minQuantity\":1,\"casePrice\":298},{\"minQuantity\":100,\"casePrice\":290},{\"minQuantity\":500,\"casePrice\":280}]";
    patch(C,"WHOLE_ORDER",rules);
    assertThat(current(C,1).totalAmount()).isEqualByComparingTo("29502");
    assertThat(current(C,1).items().getFirst().baseCasePrice()).isEqualByComparingTo("298");
    assertThat(historyAmount(C,1)).isEqualByComparingTo("29700");
    assertThat(submit(C,2,1,0,100,"").path("totalAmount").decimalValue()).isEqualByComparingTo("29000");
    patch(C,"INCREMENTAL",rules);
    assertThat(current(C,2).totalAmount()).isEqualByComparingTo("29792");
    assertThat(submit(C,3,1,0,500,"").path("totalAmount").decimalValue()).isEqualByComparingTo("145782");
    assertThat(current(C,3).items().getFirst().pricingDetails().segments()).extracting(com.fengyi.ordershow.common.TierPricing.Segment::quantity)
        .containsExactly(99L,400L,1L);
    int lock=current(C,1).lockVersion();
    long events=jdbc.queryForObject("SELECT COUNT(*) FROM domain_event_outbox WHERE activity_id=? AND event_type='ORDER_PRICE_UPDATED'",Long.class,C);
    patchProduct(C,"{\"casePriceSet\":true,\"casePrice\":400,\"reason\":\"ordinary price only\"}");
    assertThat(current(C,1).lockVersion()).isEqualTo(lock);
    assertThat(current(C,1).totalAmount()).isEqualByComparingTo("29502");
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM domain_event_outbox WHERE activity_id=? AND event_type='ORDER_PRICE_UPDATED'",Long.class,C)).isEqualTo(events);
    var catalogProduct=catalog.products(code(C),identity(C,4),null,null).getFirst();
    assertThat(catalogProduct.casePrice()).isEqualByComparingTo("400");
    assertThat(catalogProduct.priceTier().tiers().getFirst().casePrice()).isEqualByComparingTo("298");
    assertThat(submit(C,4,1,0,99,"").path("totalAmount").decimalValue()).isEqualByComparingTo("29502");
    patch(C,"INCREMENTAL",rules.replace("298","310"));
    assertThat(current(C,1).totalAmount()).isEqualByComparingTo("30690");
    assertThat(historyAmount(C,1)).isEqualByComparingTo("29700");
    assertThat(submit(C,1,1,1,100,"-increase").path("totalAmount").decimalValue()).isEqualByComparingTo("30980");
    assertThat(historyAmount(C,1)).isEqualByComparingTo("29700");
    patch(C,"WHOLE_ORDER","[]");
    assertThat(current(C,1).totalAmount()).isEqualByComparingTo("40000");
    assertThat(current(C,1).items().getFirst().pricingDetails()).isNull();
    assertThat(current(C,3).totalAmount()).isEqualByComparingTo("200000");
    assertThat(historyAmount(C,1)).isEqualByComparingTo("29700");
    assertConsistent(C);
  }

  @Test @Order(4) void migrationFreezesLegacyFirstPricesWithoutChangingExistingIndependentRules() throws Exception {
    assertThat(jdbc.queryForObject("SELECT DATABASE()",String.class)).isEqualTo("order_show_price_tier_test");
    String schema="order_show_price_tier_migration_test";
    try(var connection=Objects.requireNonNull(jdbc.getDataSource()).getConnection();var administration=connection.createStatement()) {
      String original=connection.getCatalog();
      administration.execute("CREATE DATABASE "+schema);
      try {
        connection.setCatalog(schema);
        try(var statement=connection.createStatement()) {
        statement.execute("CREATE TABLE activity(id BIGINT PRIMARY KEY,product_catalog_version BIGINT NOT NULL)");
        statement.execute("CREATE TABLE activity_product(id BIGINT PRIMARY KEY,activity_id BIGINT,case_price DECIMAL(18,4))");
        statement.execute("CREATE TABLE activity_product_price_tier(activity_product_id BIGINT,min_quantity BIGINT,case_price DECIMAL(18,4),pricing_mode VARCHAR(20),UNIQUE KEY uk_product_price_tier(activity_product_id,min_quantity),CONSTRAINT ck_product_price_tier_values CHECK(min_quantity>=2 AND case_price>0))");
        statement.execute("INSERT INTO activity VALUES (1,7),(2,9)");
        statement.execute("INSERT INTO activity_product VALUES (1,1,300),(2,2,400)");
        statement.execute("INSERT INTO activity_product_price_tier VALUES(1,100,290,'INCREMENTAL'),(1,500,280,'INCREMENTAL')");
        var migration=new org.springframework.core.io.ClassPathResource("db/migration/V048__independent_first_price_tier.sql");
        org.springframework.jdbc.datasource.init.ScriptUtils.executeSqlScript(connection,migration);
        try(var rows=statement.executeQuery("SELECT min_quantity,case_price,pricing_mode FROM activity_product_price_tier WHERE activity_product_id=1 ORDER BY min_quantity")) {
          assertThat(rows.next()).isTrue();assertThat(rows.getLong(1)).isEqualTo(1);assertThat(rows.getBigDecimal(2)).isEqualByComparingTo("300");assertThat(rows.getString(3)).isEqualTo("INCREMENTAL");
          assertThat(rows.next()).isTrue();assertThat(rows.getLong(1)).isEqualTo(100);
          assertThat(rows.next()).isTrue();assertThat(rows.getLong(1)).isEqualTo(500);assertThat(rows.next()).isFalse();
        }
        try(var rows=statement.executeQuery("SELECT product_catalog_version FROM activity WHERE id=1")) {assertThat(rows.next()).isTrue();assertThat(rows.getLong(1)).isEqualTo(8);}
        try(var rows=statement.executeQuery("SELECT product_catalog_version FROM activity WHERE id=2")) {assertThat(rows.next()).isTrue();assertThat(rows.getLong(1)).isEqualTo(9);}
        statement.execute("UPDATE activity_product SET case_price=999 WHERE id=1");
        statement.execute("UPDATE activity_product_price_tier SET case_price=350 WHERE activity_product_id=1 AND min_quantity=1");
        org.springframework.jdbc.datasource.init.ScriptUtils.executeSqlScript(connection,migration);
        try(var rows=statement.executeQuery("SELECT case_price FROM activity_product_price_tier WHERE activity_product_id=1 AND min_quantity=1")) {assertThat(rows.next()).isTrue();assertThat(rows.getBigDecimal(1)).isEqualByComparingTo("350");assertThat(rows.next()).isFalse();}
        }
      } finally { connection.setCatalog(original);administration.execute("DROP DATABASE "+schema); }
    }
  }

  private JsonNode submit(long activity,int n,int count) throws Exception {
    return submit(activity,n,count,0,1200,"");
  }
  private JsonNode submit(long activity,int n,int count,int expectedVersion,long firstQuantity,String suffix) throws Exception {
    var body=json.createObjectNode().put("expectedVersion",expectedVersion);var items=body.putArray("items");
    for(int i=1;i<=count;i++)items.addObject().put("productId",product(activity)+i-1).put("quantity",i==1?firstQuantity:2);
    var response=http.send(request(activity,n,"/order?includeHistory=false").header("Content-Type","application/json").header("Idempotency-Key","pt-"+activity+"-"+n+suffix).PUT(HttpRequest.BodyPublishers.ofString(body.toString())).build(),HttpResponse.BodyHandlers.ofString());
    assertThat(response.statusCode()).withFailMessage("HTTP %s: %s",response.statusCode(),response.body()).isEqualTo(200);
    return json.readTree(response.body()).path("data");
  }
  private HttpRequest.Builder request(long activity,int n,String path) {
    return HttpRequest.newBuilder(URI.create("http://localhost:"+port+"/api/v1/h5/activities/"+code(activity)+path)).timeout(Duration.ofSeconds(60))
        .header("Cookie","ORDER_SHOW_H5_SESSION=pt-"+activity+"-"+n+"; ORDER_SHOW_H5_CSRF=pt-csrf").header("X-CSRF-Token","pt-csrf");
  }
  private void patch(long activity,String mode,String rules) {
    patchProduct(activity,"{\"priceTierSet\":true,\"priceTierPricingMode\":\""+mode+"\",\"priceTiers\":"+rules+",\"reason\":\"isolated test\"}");
  }
  private void patchProduct(long activity,String body) {
    try { products.update(activity,product(activity),productVersion(activity),json.readValue(body,ProductService.ProductPatch.class)); }
    catch(com.fasterxml.jackson.core.JsonProcessingException e){throw new IllegalStateException(e);}
  }
  private int productVersion(long activity){return jdbc.queryForObject("SELECT lock_version FROM activity_product WHERE id=?",Integer.class,product(activity));}
  private OrderService.OrderView current(long activity,int n){return orders.current(code(activity),identity(activity,n),true);}
  private BigDecimal historyAmount(long activity,int n){return current(activity,n).versions().stream().filter(version->version.version()==1).findFirst().orElseThrow().items().stream().map(OrderService.ItemView::lineAmount).reduce(BigDecimal.ZERO,BigDecimal::add);}
  private H5Principal identity(long activity,int n){return new H5Principal(0,activity,customer(activity)+n,code(activity),"ALL",null,"Test branch "+activity,null,"Test "+n,"138****0000");}
  private static long product(long activity){return activity*1000+1;}
  private static long customer(long activity){return activity*10000;}
  private static String code(long activity){return "PRICE-TIER-TEST-"+activity;}

  private void assertConsistent(long activity) {
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM customer_order o WHERE o.activity_id=? AND o.total_amount<>(SELECT SUM(i.line_amount) FROM order_item i WHERE i.order_id=o.id)",Integer.class,activity)).isZero();
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM customer_order o LEFT JOIN order_dashboard_stat s ON s.order_id=o.id WHERE o.activity_id=? AND (s.order_id IS NULL OR s.dirty=TRUE)",Integer.class,activity)).isZero();
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM customer_order o WHERE o.activity_id=? AND NOT (o.total_amount <=> (SELECT SUM(s.line_amount) FROM order_dashboard_product_line_stat s WHERE s.order_id=o.id))",Integer.class,activity)).isZero();
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM order_dashboard_product_line_stat s JOIN customer_order o ON o.id=s.order_id WHERE o.activity_id=? AND NOT (s.line_amount <=> (SELECT SUM(i.line_amount) FROM order_item i WHERE i.order_id=s.order_id AND i.product_line <=> s.product_line AND i.is_gift_box=s.is_gift_box))",Integer.class,activity)).isZero();
  }

  private void seed(long activity,int customers,int productCount,int existing) {
    assertThat(jdbc.queryForObject("SELECT DATABASE()",String.class)).isEqualTo("order_show_price_tier_test");
    jdbc.execute("CREATE TABLE IF NOT EXISTS price_tier_test_numbers(n INT PRIMARY KEY)");
    if(jdbc.queryForObject("SELECT COUNT(*) FROM price_tier_test_numbers",Integer.class)==0)
      jdbc.batchUpdate("INSERT INTO price_tier_test_numbers(n) VALUES (?)",java.util.stream.IntStream.rangeClosed(1,3300).mapToObj(n->new Object[]{n}).toList());
    long admin=jdbc.queryForObject("SELECT id FROM admin_user WHERE role_code='SUPER_ADMIN' ORDER BY id LIMIT 1",Long.class);
    long department=jdbc.queryForObject("SELECT id FROM department WHERE department_code='DEFAULT'",Long.class);
    jdbc.update("INSERT INTO activity(id,activity_code,name,status,starts_at,ends_at,event_ends_at,created_by,updated_by,department_id) VALUES (?,?,'隔离阶梯测试','ACTIVE','2026-01-01','2099-01-01','2099-01-02',?,?,?)",activity,code(activity),admin,admin,department);
    jdbc.update("INSERT INTO stored_file(id,activity_id,storage_provider,bucket_name,object_key,original_filename,content_type,size_bytes,sha256,file_purpose,created_by) VALUES (?,?,'S3','test',?,'test.xlsx','application/octet-stream',1,UNHEX(SHA2('test',256)),'IMPORT_SOURCE',?)",activity,activity,code(activity),admin);
    for(int i=1;i<=2;i++) {
      long version=activity*10+i;String type=i==1?"PRODUCT":"WHITELIST";
      jdbc.update("INSERT INTO import_task(id,activity_id,import_type,status,source_file_id,file_sha256,created_by) VALUES (?,?,?,'COMPLETED',?,UNHEX(SHA2('test',256)),?)",version,activity,type,activity,admin);
      jdbc.update("INSERT INTO import_publish_version(id,activity_id,data_type,version_no,source_import_task_id,status,created_by) VALUES (?,?,?,1,?,'PUBLISHED',?)",version,activity,type,version,admin);
      jdbc.update("INSERT INTO activity_data_binding(activity_id,data_type,current_version_id,updated_by) VALUES (?,?,?,?)",activity,type,version,admin);
    }
    long base=customer(activity),pv=activity*10+1,wv=activity*10+2;
    jdbc.update("INSERT INTO customer(id,customer_type,dealer_full_name,normalized_dealer_full_name,branch_name,normalized_branch_name) SELECT ?+n,'ALL',CONCAT('Test ',n),CONCAT('test ',n),?,? FROM price_tier_test_numbers WHERE n<=?",base,"Test branch "+activity,"test branch "+activity,customers);
    jdbc.update("INSERT INTO activity_customer(id,activity_id,customer_id,customer_type,branch_name,normalized_branch_name,dealer_full_name,normalized_dealer_full_name,phone_lookup_hash,phone_masked,source_import_task_id,data_version_id) SELECT ?+n,?,?+n,'ALL',?,?,CONCAT('Test ',n),CONCAT('test ',n),UNHEX(SHA2(CONCAT('test-',?,n),256)),'138****0000',?,? FROM price_tier_test_numbers WHERE n<=?",base,activity,base,"Test branch "+activity,"test branch "+activity,activity,wv,wv,customers);
    jdbc.update("INSERT INTO h5_session(activity_id,activity_customer_id,token_hash,csrf_token_hash,expires_at,last_seen_at) SELECT ?,?+n,UNHEX(SHA2(CONCAT('pt-',?,'-',n),256)),UNHEX(SHA2('pt-csrf',256)),'2099-01-01',UTC_TIMESTAMP(3) FROM price_tier_test_numbers WHERE n<=?",activity,base,activity,customers);
    jdbc.update("INSERT INTO activity_product(id,activity_id,customer_type,rebate_status,business_key,material_code,material_name,product_line,case_pack,case_price,ton_case_factor,is_visible,is_orderable,sort_no,data_status,source_import_task_id,data_version_id) SELECT ?+n,?,'ALL','ALL',CONCAT('pt-',n),CONCAT('P-',n),CONCAT('Product ',n),CONCAT('Line ',MOD(n,5)),'4',300,50,TRUE,TRUE,n,'ACTIVE',?,? FROM price_tier_test_numbers WHERE n<=?",activity*1000,activity,pv,pv,productCount);
    if(existing==0)return;
    jdbc.update("INSERT INTO customer_order(id,activity_id,activity_customer_id,order_no,status,customer_type,dealer_full_name_snapshot,current_version_no,total_quantity,total_tons,total_amount,first_submitted_at,last_submitted_at,last_modified_at) SELECT ?+n,?,?+n,CONCAT('PT-',?,'-',n),'SUBMITTED','ALL',CONCAT('Test ',n),1,?*1200,?*24,?*360000,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3) FROM price_tier_test_numbers WHERE n<=?",base,activity,base,activity,productCount,productCount,productCount,existing);
    jdbc.update("INSERT INTO order_item(order_id,activity_product_id,line_no,material_code,material_name,product_line,case_pack,rebate_status,is_gift_box,quantity,case_price,base_case_price,base_price_quantity,line_amount,ton_case_factor,line_tons) SELECT o.id,p.id,p.sort_no,p.material_code,p.material_name,p.product_line,p.case_pack,'ALL',FALSE,1200,300,300,1200,360000,50,24 FROM customer_order o JOIN activity_product p ON p.activity_id=o.activity_id WHERE o.activity_id=?",activity);
    jdbc.update("INSERT INTO order_version(activity_id,order_id,version_no,customer_type,dealer_full_name_snapshot,total_quantity,total_tons,total_amount,submitted_source,submitted_at,request_idempotency_key) SELECT activity_id,id,1,customer_type,dealer_full_name_snapshot,total_quantity,total_tons,total_amount,'H5',last_submitted_at,CONCAT('seed-',id) FROM customer_order WHERE activity_id=?",activity);
    new TransactionTemplate(transactions).executeWithoutResult(status->{
      for(int start=1;start<=existing;start+=200){int begin=start; summaries.refreshAll(java.util.stream.IntStream.range(begin,Math.min(begin+200,existing+1)).mapToObj(n->base+n).toList());}
    });
  }
}
