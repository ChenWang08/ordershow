package com.fengyi.ordershow.activity;

import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.http.*;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;

/** Explicit opt-in. Fixed disposable DB/network, synthetic preverified identities, no business URLs. */
@EnabledIfEnvironmentVariable(named="ORDER_SHOW_ACTIVITY_HTTP_LOAD", matches="order-show-activity-info-test")
@DirtiesContext(classMode=DirtiesContext.ClassMode.AFTER_CLASS)
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT, properties={
    "spring.datasource.url=jdbc:mysql://mysql:3306/order_show_activity_info_test?allowPublicKeyRetrieval=true&useSSL=false&serverTimezone=UTC&rewriteBatchedStatements=true",
    "spring.datasource.username=root", "spring.datasource.password=activity_info_test_only",
    "spring.flyway.user=root", "spring.flyway.password=activity_info_test_only",
    "spring.data.redis.host=redis", "spring.data.redis.password=",
    "spring.datasource.hikari.minimum-idle=2", "spring.datasource.hikari.maximum-pool-size=10",
    "H5_WRITE_CONCURRENCY=6", "order-show.h5-warmup.enabled=false",
    "order-show.dashboard.summary-enabled=true", "H5_SESSION_CACHE_TTL_MS=0",
    "order-show.bootstrap-admin-password=ActivityInfoTestOnly123!",
    "logging.level.com.fengyi.ordershow.order.OrderService=WARN"
})
class ActivityInfoHttpLoadTest {
  @Autowired JdbcTemplate jdbc;
  @Autowired ObjectMapper json;
  @LocalServerPort int port;
  final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
  static final long ID=970020, CUSTOMER=ID*10000, PRODUCT=ID*1000;
  static final String CODE="HTTP-ORDER-LOAD";

  @Test void threeMinutesAt300NewOrdersPerMinutePlus20OrderBurst() throws Exception {
    seed();
    var regular=Collections.synchronizedList(new ArrayList<Double>());
    var burst=Collections.synchronizedList(new ArrayList<Double>());
    var errors=Collections.synchronizedList(new ArrayList<String>());
    long started=System.nanoTime();
    try(var pool=Executors.newVirtualThreadPerTaskExecutor()) {
      var futures=new ArrayList<Future<?>>();
      for(int i=0;i<900;i++) {
        long due=started+TimeUnit.MILLISECONDS.toNanos(i*200L);
        long delay=due-System.nanoTime(); if(delay>0)TimeUnit.NANOSECONDS.sleep(delay);
        final int customer=i+1;
        futures.add(pool.submit(()->journey(customer,regular,errors)));
        if(i==450)for(int j=901;j<=920;j++) {
          final int extra=j; futures.add(pool.submit(()->journey(extra,burst,errors)));
        }
        if(i%300==299)System.out.println("HTTP_LOAD progress: "+(i+1)+"/900 regular orders dispatched");
      }
      for(var future:futures)future.get(30,TimeUnit.SECONDS);
    }
    double duration=(System.nanoTime()-started)/1e9;
    int orders=jdbc.queryForObject("SELECT COUNT(*) FROM customer_order WHERE activity_id=?",Integer.class,ID);
    int mismatches=jdbc.queryForObject("""
        SELECT COUNT(*) FROM customer_order o LEFT JOIN order_dashboard_stat s ON s.order_id=o.id
        WHERE o.activity_id=? AND (s.order_id IS NULL OR s.dirty=TRUE
          OR o.total_amount<>(SELECT SUM(i.line_amount) FROM order_item i WHERE i.order_id=o.id)
          OR o.total_amount<>(SELECT SUM(p.line_amount) FROM order_dashboard_product_line_stat p WHERE p.order_id=o.id))
        """,Integer.class,ID);
    var report=new LinkedHashMap<String,Object>();
    report.put("targetOrdersPerMinute",300); report.put("durationSeconds",duration);
    report.put("regularSubmissions",regular.size()); report.put("burstSubmissions",burst.size());
    report.put("regularP95Ms",percentile(regular,.95)); report.put("regularMaxMs",percentile(regular,1));
    report.put("burstP95Ms",percentile(burst,.95)); report.put("errors",errors);
    report.put("finalOrders",orders); report.put("reconciliationMismatches",mismatches);
    report.put("itemsPerOrder",180); report.put("databasePool",10); report.put("writeConcurrency",6);
    java.nio.file.Files.createDirectories(java.nio.file.Path.of("../outputs/activity-http"));
    java.nio.file.Files.writeString(java.nio.file.Path.of("../outputs/activity-http/order-load.json"),json.writerWithDefaultPrettyPrinter().writeValueAsString(report));
    assertThat(errors).isEmpty(); assertThat(regular).hasSize(900); assertThat(burst).hasSize(20);
    assertThat(duration).isGreaterThanOrEqualTo(179); assertThat(orders).isEqualTo(920); assertThat(mismatches).isZero();
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM order_item i JOIN customer_order o ON o.id=i.order_id WHERE o.activity_id=?",Integer.class,ID)).isEqualTo(920*180);
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM order_version WHERE activity_id=?",Integer.class,ID)).isEqualTo(920);
    assertThat(percentile(regular,.95)).isLessThan(1000); assertThat(percentile(burst,.95)).isLessThan(1000);
  }

  void journey(int customer,List<Double> samples,List<String> errors) {
    try {
      var metadata=http.send(request("/public/activities/"+CODE,customer).GET().build(),HttpResponse.BodyHandlers.ofString());
      requireOk(metadata); assertThat(json.readTree(metadata.body()).path("data").path("code").asText()).isEqualTo(CODE);
      var catalog=http.send(request("/h5/activities/"+CODE+"/products",customer).GET().build(),HttpResponse.BodyHandlers.ofString());
      requireOk(catalog); assertThat(json.readTree(catalog.body()).path("data").size()).isEqualTo(180);
      var body=json.createObjectNode().put("expectedVersion",0); var items=body.putArray("items");
      for(int i=1;i<=180;i++)items.addObject().put("productId",PRODUCT+i).put("quantity",1);
      long started=System.nanoTime();
      var submitted=http.send(request("/h5/activities/"+CODE+"/order?includeHistory=false",customer)
          .header("Idempotency-Key","http-load-"+customer).header("Content-Type","application/json")
          .PUT(HttpRequest.BodyPublishers.ofString(body.toString())).build(),HttpResponse.BodyHandlers.ofString());
      double elapsed=(System.nanoTime()-started)/1e6;
      requireOk(submitted); assertThat(json.readTree(submitted.body()).path("data").path("totalAmount").decimalValue()).isEqualByComparingTo("18000");
      var confirmed=http.send(request("/h5/activities/"+CODE+"/order?includeHistory=false",customer).GET().build(),HttpResponse.BodyHandlers.ofString());
      requireOk(confirmed); assertThat(json.readTree(confirmed.body()).path("data").path("items").size()).isEqualTo(180);
      samples.add(elapsed);
    } catch(Throwable error) { errors.add("customer="+customer+": "+error); }
  }
  HttpRequest.Builder request(String path,int customer) {
    return HttpRequest.newBuilder(URI.create("http://localhost:"+port+"/api/v1"+path)).timeout(Duration.ofSeconds(20))
        .header("Cookie","ORDER_SHOW_H5_SESSION=http-load-"+customer+"; ORDER_SHOW_H5_CSRF=http-load-csrf")
        .header("X-CSRF-Token","http-load-csrf");
  }
  void requireOk(HttpResponse<String> response) { assertThat(response.statusCode()).withFailMessage("HTTP %s: %s",response.statusCode(),response.body()).isEqualTo(200); }
  static double percentile(List<Double> values,double q) {
    var ordered=new ArrayList<>(values); Collections.sort(ordered);
    return ordered.isEmpty()?Double.POSITIVE_INFINITY:ordered.get(Math.min(ordered.size()-1,(int)Math.ceil(ordered.size()*q)-1));
  }
  void seed() {
    assertThat(jdbc.queryForObject("SELECT DATABASE()",String.class)).isEqualTo("order_show_activity_info_test");
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM activity WHERE id=? OR activity_code=?",Integer.class,ID,CODE)).isZero();
    jdbc.execute("CREATE TABLE IF NOT EXISTS http_load_numbers(n INT PRIMARY KEY)");
    if(jdbc.queryForObject("SELECT COUNT(*) FROM http_load_numbers",Integer.class)==0)
      jdbc.batchUpdate("INSERT INTO http_load_numbers(n) VALUES (?)",java.util.stream.IntStream.rangeClosed(1,920).mapToObj(n->new Object[]{n}).toList());
    long admin=jdbc.queryForObject("SELECT id FROM admin_user WHERE role_code='SUPER_ADMIN' ORDER BY id LIMIT 1",Long.class);
    long department=jdbc.queryForObject("SELECT id FROM department WHERE department_code='DEFAULT'",Long.class);
    jdbc.update("INSERT INTO activity(id,activity_code,name,status,starts_at,ends_at,event_ends_at,published_at,created_by,updated_by,department_id) VALUES (?,?,'HTTP负载合成活动','ACTIVE','2026-01-01','2099-01-01','2099-01-02',UTC_TIMESTAMP(3),?,?,?)",ID,CODE,admin,admin,department);
    jdbc.update("INSERT INTO stored_file(id,activity_id,storage_provider,bucket_name,object_key,original_filename,content_type,size_bytes,sha256,file_purpose,created_by) VALUES (?,?,'S3','test',?,'test.xlsx','application/octet-stream',1,UNHEX(SHA2('test',256)),'IMPORT_SOURCE',?)",ID,ID,CODE,admin);
    for(int i=1;i<=2;i++) {
      long version=ID*10+i;String type=i==1?"PRODUCT":"WHITELIST";
      jdbc.update("INSERT INTO import_task(id,activity_id,import_type,status,source_file_id,file_sha256,created_by) VALUES (?,?,?,'COMPLETED',?,UNHEX(SHA2('test',256)),?)",version,ID,type,ID,admin);
      jdbc.update("INSERT INTO import_publish_version(id,activity_id,data_type,version_no,source_import_task_id,status,created_by) VALUES (?,?,?,1,?,'PUBLISHED',?)",version,ID,type,version,admin);
      jdbc.update("INSERT INTO activity_data_binding(activity_id,data_type,current_version_id,updated_by) VALUES (?,?,?,?)",ID,type,version,admin);
    }
    long whitelist=ID*10+2, products=ID*10+1;
    jdbc.update("INSERT INTO customer(id,customer_type,dealer_full_name,normalized_dealer_full_name) SELECT ?+n,'ALL',CONCAT('HTTP test ',n),CONCAT('httptest',n) FROM http_load_numbers",CUSTOMER);
    jdbc.update("INSERT INTO activity_customer(id,activity_id,customer_id,customer_type,dealer_full_name,normalized_dealer_full_name,phone_lookup_hash,phone_masked,source_import_task_id,data_version_id) SELECT ?+n,?,?+n,'ALL',CONCAT('HTTP test ',n),CONCAT('httptest',n),UNHEX(SHA2(CONCAT('http-',n),256)),'138****0000',?,? FROM http_load_numbers",CUSTOMER,ID,CUSTOMER,whitelist,whitelist);
    jdbc.update("INSERT INTO h5_session(activity_id,activity_customer_id,token_hash,csrf_token_hash,expires_at,last_seen_at) SELECT ?,?+n,UNHEX(SHA2(CONCAT('http-load-',n),256)),UNHEX(SHA2('http-load-csrf',256)),'2099-01-01',UTC_TIMESTAMP(3) FROM http_load_numbers",ID,CUSTOMER);
    jdbc.update("INSERT INTO activity_product(id,activity_id,customer_type,rebate_status,business_key,material_code,material_name,product_line,case_pack,case_price,ton_case_factor,is_visible,is_orderable,sort_no,data_status,source_import_task_id,data_version_id) SELECT ?+n,?,'ALL','ALL',CONCAT('http-',n),CONCAT('P-',n),CONCAT('Product ',n),CONCAT('Line ',MOD(n,5)),'4',100,50,TRUE,TRUE,n,'ACTIVE',?,? FROM http_load_numbers WHERE n<=180",PRODUCT,ID,products,products);
  }
}
