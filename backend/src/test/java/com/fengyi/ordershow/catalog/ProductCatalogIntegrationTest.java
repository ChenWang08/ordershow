package com.fengyi.ordershow.catalog;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengyi.ordershow.catalog.H5CatalogDataService.*;
import com.fengyi.ordershow.common.ApiResponse;
import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.security.CryptoService;
import com.fengyi.ordershow.security.H5Principal;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.net.URI;
import java.net.http.*;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.BooleanSupplier;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** Fixed disposable DB/network, synthetic fixtures only; never accepts business DB credentials. */
@EnabledIfEnvironmentVariable(named="ORDER_SHOW_PRODUCT_CATALOG_TEST",matches="order-show-product-catalog-test")
@DirtiesContext(classMode=DirtiesContext.ClassMode.AFTER_CLASS)
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={
    "spring.datasource.url=jdbc:mysql://mysql:3306/order_show_product_catalog_test?allowPublicKeyRetrieval=true&useSSL=false&serverTimezone=UTC",
    "spring.datasource.username=root","spring.datasource.password=product_catalog_test_only",
    "spring.flyway.user=root","spring.flyway.password=product_catalog_test_only",
    "spring.data.redis.host=redis","spring.data.redis.password=",
    "spring.datasource.hikari.minimum-idle=1","spring.datasource.hikari.maximum-pool-size=8",
    "order-show.bootstrap-admin-password=ProductCatalogTestOnly123!","H5_WARMUP_ENABLED=false"
})
class ProductCatalogIntegrationTest {
  static final long A=900001, PV=900001, WV=900002, FILE=900001;
  static final String CODE="PRODUCT-CATALOG-TEST";
  @Autowired JdbcTemplate jdbc;
  @Autowired H5CatalogDataService data;
  @Autowired H5CatalogService catalog;
  @Autowired H5CatalogCache cache;
  @Autowired ProductCatalogReader legacy;
  @Autowired ProductService products;
  @Autowired ObjectMapper json;
  @Autowired MeterRegistry metrics;
  @Autowired StringRedisTemplate redis;
  @Autowired RedisConnectionFactory connections;
  @Autowired PlatformTransactionManager transactions;
  @Autowired CryptoService crypto;
  @LocalServerPort int port;

  @Test void realMysqlPermissionsTransactionsTwoReplicasAndMeasuredReads() throws Exception {
    seed();
    var general=identity(1,"GENERAL","café","Déaler");
    var special=identity(2,"SPECIAL","other","Second");
    var untyped=identity(3,"ALL",null,"Untyped");
    List<H5Principal> customers=List.of(general,special,untyped);
    // Actual MySQL AI/CI comparisons, null branches, empty dealer selections, typed/ALL, incomplete/hidden rows.
    for (var customer:customers) assertThat(catalog.products(CODE,customer,null,null))
        .isEqualTo(legacy.h5Products(CODE,customer,null,null).stream().map(H5Product::from).toList());
    assertThat(catalog.products(CODE,general,null,null)).extracting(H5Product::id)
        .contains(910001L,910004L,910005L).doesNotContain(910002L,910003L,910006L);
    for (String keyword:List.of("%","_","CAFÉ")) assertThat(catalog.products(CODE,general,null,keyword))
        .isEqualTo(legacy.h5Products(CODE,general,null,keyword).stream().map(H5Product::from).toList());
    var disabled=new H5CatalogService(data,cache,metrics,false);
    assertThat(disabled.products(CODE,general,null,null)).isEqualTo(catalog.products(CODE,general,null,null));

    // Warm requests: count real SQL statements on the same MySQL session, excluding SHOW itself.
    for(int i=0;i<5;i++) { legacy.h5Products(CODE,general,null,null); catalog.products(CODE,general,null,null); }
    int oldQueries=countQueries(()->legacy.h5Products(CODE,general,null,null),64);
    int newQueries=countQueries(()->catalog.products(CODE,general,null,null),64);
    assertThat(oldQueries).isEqualTo(64*8); assertThat(newQueries).isEqualTo(64);
    var oldPayload=json.writeValueAsBytes(ApiResponse.of(legacy.h5Products(CODE,general,null,null),"fixture"));
    var newPayload=json.writeValueAsBytes(ApiResponse.of(catalog.products(CODE,general,null,null),"fixture"));
    assertThat(newPayload.length).isLessThan(oldPayload.length);
    var oldTimes=new ArrayList<Long>(); var newTimes=new ArrayList<Long>();
    for(int i=0;i<64;i++) {
      long start=System.nanoTime(); legacy.h5Products(CODE,general,null,null); oldTimes.add(System.nanoTime()-start);
      start=System.nanoTime(); catalog.products(CODE,general,null,null); newTimes.add(System.nanoTime()-start);
    }
    cache.resynchronize(); double loads=loadCount(); long coldStarted=System.nanoTime(); long coldElapsed;
    try(var pool=Executors.newVirtualThreadPerTaskExecutor()) {
      var ready=new CountDownLatch(300); var go=new CountDownLatch(1);
      var tasks=java.util.stream.IntStream.range(0,300).mapToObj(i->pool.submit(()->{
        ready.countDown(); assertThat(go.await(5,TimeUnit.SECONDS)).isTrue();
        var customer=customers.get(i%customers.size()); return catalog.products(CODE,customer,null,null);
      })).toList();
      assertThat(ready.await(5,TimeUnit.SECONDS)).isTrue(); go.countDown();
      var results=new ArrayList<List<H5Product>>();
      for(var task:tasks) results.add(task.get(10,TimeUnit.SECONDS));
      coldElapsed=System.nanoTime()-coldStarted;
      for(int i=0;i<tasks.size();i++) assertThat(results.get(i))
          .isEqualTo(legacy.h5Products(CODE,customers.get(i%3),null,null).stream().map(H5Product::from).toList());
    }
    assertThat(loadCount()-loads).isEqualTo(1);
    System.out.printf(Locale.ROOT,"CATALOG_MEASUREMENT oldSql=%d newSql=%d oldBytes=%d newBytes=%d oldP50Ms=%.3f oldP95Ms=%.3f newP50Ms=%.3f newP95Ms=%.3f cold300Ms=%.3f coldLoads=%.0f%n",
        oldQueries,newQueries,oldPayload.length,newPayload.length,percentile(oldTimes,.5),percentile(oldTimes,.95),
        percentile(newTimes,.5),percentile(newTimes,.95),coldElapsed/1e6,loadCount()-loads);

    // HTTP contract uses only the slim image fields and private/no-store; admin shape is intact.
    jdbc.update("""
        INSERT INTO h5_session(activity_id,activity_customer_id,token_hash,csrf_token_hash,expires_at,last_seen_at)
        VALUES (?,?,?,?, '2099-01-01',UTC_TIMESTAMP(3))
        """,A,920001,crypto.sha256("catalog-test-token"),crypto.sha256("csrf-test"));
    try(var client=HttpClient.newHttpClient()) {
      var response=client.send(HttpRequest.newBuilder(URI.create("http://localhost:"+port+"/api/v1/h5/activities/"+CODE+"/products"))
          .header("Cookie","ORDER_SHOW_H5_SESSION=catalog-test-token").GET().build(),HttpResponse.BodyHandlers.ofString());
      assertThat(response.statusCode()).isEqualTo(200);
      assertThat(response.headers().firstValue("Cache-Control").orElse("")).contains("private","no-store");
      var image=json.readTree(response.body()).path("data").get(0).path("images").get(0);
      assertThat(image.has("url")).isTrue(); assertThat(image.has("fileId")).isFalse(); assertThat(image.has("sourceType")).isFalse();
      assertThat(json.valueToTree(legacy.product(A,910001)).path("images").get(0).has("fileId")).isTrue();
    }

    // Rollback cancels both revision and durable event; admin lock version remains independent.
    var tx=new TransactionTemplate(transactions); long version=revision(); int lock=lockVersion();
    tx.executeWithoutResult(status->{ProductCatalogChanges.products(jdbc,A,List.of(910001L));status.setRollbackOnly();});
    assertThat(revision()).isEqualTo(version); assertThat(lockVersion()).isEqualTo(lock);
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM domain_event_outbox WHERE activity_id=? AND event_type='PRODUCT_CATALOG_CHANGED'",Integer.class,A)).isZero();

    var peerCache=new H5CatalogCache(data,new SimpleMeterRegistry(),new H5CatalogCache.Limits(2,10_000_000,Duration.ofMinutes(10),2,20,5000));
    var peer=new ProductCatalogRedisBridge(redis,connections,json,peerCache);
    peer.initialize(); peer.start();
    try {
      until(()->subscribers()>=2);
      peerCache.get(A,revision());
      double partialBefore=metrics.counter("order_show.h5.catalog.loads","kind","partial").count();
      products.update(A,910001,0,json.readValue("{\"description\":\"after commit\"}",ProductService.ProductPatch.class));
      long changed=revision(); assertThat(changed).isEqualTo(version+1);
      until(()->peerCache.get(A,version).version()==changed);
      assertThat(peerCache.get(A,changed).products().stream().filter(p->p.id()==910001).findFirst().orElseThrow().description()).isEqualTo("after commit");
      assertThat(metrics.counter("order_show.h5.catalog.loads","kind","partial").count()).isGreaterThan(partialBefore);
      peerCache.changed(new Change(A,1,1,Set.of(910001L),false)); assertThat(peerCache.get(A,changed).version()).isEqualTo(changed);

      // Same-name image links are changed for ALL and GENERAL products; both IDs enter the durable payload.
      products.deleteImage(A,910001,930001);
      long imageRevision=revision(); until(()->peerCache.get(A,changed).version()==imageRevision);
      assertThat(peerCache.get(A,imageRevision).products().stream().filter(p->p.id()==910001||p.id()==910004)).allSatisfy(p->assertThat(p.images()).isEmpty());
      var event=json.readTree(jdbc.queryForObject("SELECT payload_json FROM domain_event_outbox WHERE activity_id=? AND event_type='PRODUCT_CATALOG_CHANGED' ORDER BY id DESC LIMIT 1",String.class,A));
      assertThat(event.path("productIds").toString()).contains("910001","910004");

      // Notification loss: disconnected replica stays old; its next request discovers DB revision and rebuilds.
      peer.stop(); long missed=revision();
      tx.executeWithoutResult(status->{jdbc.update("UPDATE activity_product SET description='missed' WHERE id=910001");ProductCatalogChanges.products(jdbc,A,List.of(910001L));});
      var peerFacade=new H5CatalogService(data,peerCache,new SimpleMeterRegistry(),true);
      assertThat(peerCache.get(A,missed).version()).isEqualTo(missed);
      assertThat(peerFacade.products(CODE,general,null,null).stream().filter(p->p.id()==910001).findFirst().orElseThrow().description()).isEqualTo("missed");
      peer.start(); until(()->subscribers()>=2);

      products.update(A,910001,1,json.readValue("{\"casePrice\":90,\"casePriceSet\":true,\"priceTierMinQuantity\":10,\"priceTierCasePrice\":70,\"priceTierPricingMode\":\"WHOLE_ORDER\",\"priceTierSet\":true}",ProductService.ProductPatch.class));
      var repriced=catalog.products(CODE,general,null,null).stream().filter(p->p.id()==910001).findFirst().orElseThrow();
      assertThat(repriced.casePrice()).isEqualByComparingTo("90");
      assertThat(repriced.priceTier().casePrice()).isEqualByComparingTo("70");
      assertThat(repriced.priceTier().pricingMode()).isEqualTo("WHOLE_ORDER");

      // Warm cache cannot restore a revoked customer or use stale branch/name data from a session cache.
      tx.executeWithoutResult(status->{jdbc.update("UPDATE activity_customer SET branch_name='other',normalized_branch_name='other' WHERE id=920001");ProductCatalogChanges.all(jdbc,A);});
      assertThat(catalog.products(CODE,general,null,null)).isEqualTo(data.legacy(CODE,data.context(CODE,general),general,null,null));
      assertThat(catalog.products(CODE,general,null,null)).extracting(H5Product::id).doesNotContain(910001L);
      jdbc.update("UPDATE activity_customer SET is_active=FALSE WHERE id=920001");
      assertThatThrownBy(()->catalog.products(CODE,general,null,null)).isInstanceOf(DomainException.class);
      jdbc.update("UPDATE activity_customer SET is_active=TRUE WHERE id=920001");

      // Gap, older event with newer DB state, hidden product and binding switch all force coherent full data.
      var base=data.load(A,null,null); long first=revision();
      tx.executeWithoutResult(status->{jdbc.update("UPDATE activity_product SET is_visible=FALSE,is_orderable=FALSE WHERE id=910005");ProductCatalogChanges.products(jdbc,A,List.of(910005L));});
      tx.executeWithoutResult(status->{jdbc.update("UPDATE activity_product SET description='later' WHERE id=910004");ProductCatalogChanges.products(jdbc,A,List.of(910004L));});
      var rebuilt=data.load(A,base,new Change(A,first+1,first+1,Set.of(910005L),false));
      assertThat(rebuilt.version()).isEqualTo(revision()); assertThat(rebuilt.products()).extracting(H5Product::id).doesNotContain(910005L);
      assertThat(rebuilt.products().stream().filter(p->p.id()==910004).findFirst().orElseThrow().description()).isEqualTo("later");
      assertThat(data.load(A,base,new Change(A,first+2,first+2,Set.of(910004L),false))).isEqualTo(rebuilt);
      long next=version("PRODUCT",3,900003);
      tx.executeWithoutResult(status->{jdbc.update("UPDATE activity_data_binding SET current_version_id=? WHERE activity_id=? AND data_type='PRODUCT'",next,A);ProductCatalogChanges.all(jdbc,A);});
      assertThat(catalog.products(CODE,special,null,null)).isEmpty();
      long nextWhitelist=version("WHITELIST",2,900004);
      jdbc.update("UPDATE activity_data_binding SET current_version_id=? WHERE activity_id=? AND data_type='WHITELIST'",nextWhitelist,A);
      assertThatThrownBy(()->catalog.products(CODE,special,null,null)).isInstanceOf(DomainException.class);

      var unavailable=mock(StringRedisTemplate.class);
      when(unavailable.convertAndSend(anyString(),anyString())).thenThrow(new IllegalStateException("offline"));
      var failed=new ProductCatalogRedisBridge(unavailable,connections,json,cache);
      failed.initialize();
      assertThatThrownBy(()->failed.forward(new Change(A,revision(),revision(),Set.of(),true))).isInstanceOf(IllegalStateException.class);
      failed.destroy();
    } finally { peer.destroy(); peerCache.close(); }
  }

  private H5Principal identity(int n,String type,String branch,String name) { return new H5Principal(1,A,920000+n,CODE,type,null,branch,null,name,"138****0000"); }
  private long subscribers() {
    Long count=redis.convertAndSend(ProductCatalogRedisBridge.CHANNEL,
        "{\"activityId\":999999,\"fromVersion\":1,\"toVersion\":1,\"productIds\":[],\"fullReload\":true}");
    return count==null?0:count;
  }
  private long revision() { return jdbc.queryForObject("SELECT product_catalog_version FROM activity WHERE id=?",Long.class,A); }
  private int lockVersion() { return jdbc.queryForObject("SELECT version FROM activity WHERE id=?",Integer.class,A); }
  private double loadCount() { return metrics.find("order_show.h5.catalog.loads").counters().stream().mapToDouble(io.micrometer.core.instrument.Counter::count).sum(); }
  private int countQueries(Runnable request,int repeats) {
    var tx=new TransactionTemplate(transactions); tx.setReadOnly(true);
    return tx.execute(status->{
      request.run(); // Warm this exact connection/transaction before counting prepared request statements.
      int before=jdbc.queryForObject("SHOW SESSION STATUS LIKE 'Questions'",(rs,n)->rs.getInt(2));
      for(int i=0;i<repeats;i++) request.run();
      return jdbc.queryForObject("SHOW SESSION STATUS LIKE 'Questions'",(rs,n)->rs.getInt(2))-before-1;
    });
  }
  private static double percentile(List<Long> values,double percentile) { var sorted=values.stream().sorted().toList();return sorted.get((int)Math.ceil(sorted.size()*percentile)-1)/1e6; }
  private static void until(BooleanSupplier condition) throws Exception {
    long end=System.nanoTime()+TimeUnit.SECONDS.toNanos(8);
    while(!condition.getAsBoolean()&&System.nanoTime()<end) Thread.sleep(20);
    assertThat(condition.getAsBoolean()).isTrue();
  }

  private void seed() {
    assertThat(jdbc.queryForObject("SELECT DATABASE()",String.class)).isEqualTo("order_show_product_catalog_test");
    long admin=jdbc.queryForObject("SELECT id FROM admin_user WHERE role_code='SUPER_ADMIN' ORDER BY id LIMIT 1",Long.class);
    long department=jdbc.queryForObject("SELECT id FROM department WHERE department_code='DEFAULT'",Long.class);
    jdbc.update("INSERT INTO activity(id,activity_code,name,status,starts_at,ends_at,event_ends_at,created_by,updated_by,department_id) VALUES (?,?,'隔离商品测试','ACTIVE','2026-01-01','2099-01-01','2099-01-02',?,?,?)",A,CODE,admin,admin,department);
    jdbc.update("INSERT INTO stored_file(id,activity_id,storage_provider,bucket_name,object_key,original_filename,content_type,size_bytes,sha256,file_purpose,created_by) VALUES (?,?,'S3','test','catalog-fixture','image.jpg','image/jpeg',1,UNHEX(SHA2('fixture',256)),'PRODUCT_IMAGE',?)",FILE,A,admin);
    version("PRODUCT",1,PV); version("WHITELIST",1,WV);
    for(var binding:List.of(new Object[]{A,"PRODUCT",PV,admin},new Object[]{A,"WHITELIST",WV,admin}))
      jdbc.update("INSERT INTO activity_data_binding(activity_id,data_type,current_version_id,updated_by) VALUES (?,?,?,?)",binding);
    String[] types={"GENERAL","SPECIAL","ALL"}; String[] names={"Déaler","Second","Untyped"}; String[] branches={"café","other",null};
    for(int i=0;i<3;i++) {
      jdbc.update("INSERT INTO customer(id,customer_type,dealer_full_name,normalized_dealer_full_name,branch_name,normalized_branch_name) VALUES (?,?,?,?,?,?)",920001+i,types[i],names[i],names[i].toLowerCase(Locale.ROOT),Objects.requireNonNullElse(branches[i],""),Objects.requireNonNullElse(branches[i],""));
      jdbc.update("INSERT INTO activity_customer(id,activity_id,customer_id,customer_type,branch_name,normalized_branch_name,dealer_full_name,normalized_dealer_full_name,phone_lookup_hash,phone_masked,source_import_task_id,data_version_id) VALUES (?,?,?,?,?,?,?,?,UNHEX(SHA2(?,256)),'138****0000',?,?)",920001+i,A,920001+i,types[i],branches[i],branches[i],names[i],names[i].toLowerCase(Locale.ROOT),"phone"+i,WV,WV);
    }
    for(int i=1;i<=606;i++) {
      long id=910000+i; String type=i==2?"SPECIAL":i==4?"GENERAL":"ALL";
      boolean visible=i!=6; boolean orderable=i!=5&&visible;
      jdbc.update("""
          INSERT INTO activity_product(id,activity_id,customer_type,rebate_status,business_key,material_code,material_name,
            case_price,ton_case_factor,is_visible,is_orderable,sort_no,data_status,source_import_task_id,data_version_id)
          VALUES (?,? ,?,'ALL',?,?,?, ?,0.01,?,?,?, ?,?,?)
          """,id,A,type,"fixture-"+i,"C-"+i,(i==1||i==4)?"café 商品":"商品"+i,i==5?null:100,visible,orderable,i,i==5?"INCOMPLETE":"ACTIVE",PV,PV);
    }
    jdbc.update("INSERT INTO activity_product_branch_scope(activity_product_id,branch_name,normalized_branch_name) VALUES (910001,'CAFE','CAFE'),(910003,'cafe','cafe')");
    jdbc.update("INSERT INTO activity_product_dealer_scope(activity_product_id,branch_name,normalized_branch_name) VALUES (910001,'CAFE','CAFE'),(910003,'CAFE','CAFE')");
    jdbc.update("INSERT INTO activity_product_dealer_member(activity_product_id,normalized_branch_name,customer_id,customer_type,normalized_dealer_full_name,dealer_full_name) VALUES (910001,'CAFE',920001,'GENERAL','DEALER','DEALER')");
    jdbc.update("INSERT INTO product_image(id,activity_product_id,stored_file_id,is_primary,sort_no,source_type,match_status) VALUES (930001,910001,?,TRUE,0,'MANUAL','CONFIRMED'),(930004,910004,?,TRUE,0,'MANUAL','CONFIRMED')",FILE,FILE);
    jdbc.update("INSERT INTO activity_product_price_tier(activity_product_id,min_quantity,case_price,pricing_mode) VALUES (910001,10,80,'INCREMENTAL')");
  }

  private long version(String type,int number,long id) {
    long admin=jdbc.queryForObject("SELECT id FROM admin_user WHERE role_code='SUPER_ADMIN' ORDER BY id LIMIT 1",Long.class);
    jdbc.update("INSERT INTO import_task(id,activity_id,import_type,status,source_file_id,file_sha256,created_by) VALUES (?,?,?,'COMPLETED',?,UNHEX(SHA2('fixture',256)),?)",id,A,type,FILE,admin);
    jdbc.update("INSERT INTO import_publish_version(id,activity_id,data_type,version_no,source_import_task_id,status,created_by) VALUES (?,?,?,?,?,'PUBLISHED',?)",id,A,type,number,id,admin);
    return id;
  }
}
