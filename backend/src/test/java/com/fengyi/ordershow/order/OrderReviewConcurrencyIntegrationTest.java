package com.fengyi.ordershow.order;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengyi.ordershow.activity.ActivityService;
import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.dashboard.DashboardService;
import com.fengyi.ordershow.dashboard.DashboardSummaryStore;
import com.fengyi.ordershow.security.AdminPrincipal;
import com.fengyi.ordershow.security.H5Principal;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.*;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/** Fixed disposable ACK smoke database, real service/repository SQL and independent transactions. */
@EnabledIfEnvironmentVariable(named="ORDER_SHOW_REVIEW_TEST",matches="order-show-ack-smoke-lottery-review")
class OrderReviewConcurrencyIntegrationTest {
  static final String URL="jdbc:mysql://mysql:3306/order_show_review_test?allowPublicKeyRetrieval=true&useSSL=false&serverTimezone=UTC&rewriteBatchedStatements=true";
  static final ObjectMapper JSON=new ObjectMapper().findAndRegisterModules();
  static JdbcTemplate jdbc;
  static TransactionTemplate tx;
  static long sequence=100;
  final AdminPrincipal admin=new AdminPrincipal(1,"review-test","review-test","SUPER_ADMIN",null,null,false);
  long activity,base,requestA,requestB;
  OrderRepository repository;
  OrderChangeRequestRepository requests;
  ActivityService activities;
  OrderService service,secondInstance;

  @BeforeAll static void migrate() {
    var server=new JdbcTemplate(new DriverManagerDataSource(URL.replace("/order_show_review_test?","/?"),"root","lottery_only_root"));
    server.execute("DROP DATABASE IF EXISTS order_show_review_test");
    server.execute("CREATE DATABASE order_show_review_test CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci");
    var source=new DriverManagerDataSource(URL,"root","lottery_only_root");
    jdbc=new JdbcTemplate(source);
    assertThat(jdbc.queryForObject("SELECT DATABASE()",String.class)).isEqualTo("order_show_review_test");
    Flyway.configure().dataSource(source).locations("classpath:db/migration").load().migrate();
    jdbc.update("INSERT INTO admin_user(id,username,display_name,password_hash,role_code) VALUES(1,'review-test','review-test','unused','SUPER_ADMIN')");
    tx=new TransactionTemplate(new DataSourceTransactionManager(source));
    tx.setIsolationLevel(TransactionDefinition.ISOLATION_READ_COMMITTED);tx.setTimeout(15);
  }

  @BeforeEach void fixture() throws Exception {
    activity=++sequence;base=activity*100;
    jdbc.update("INSERT INTO activity(id,department_id,activity_code,name,status,starts_at,ends_at,created_by,updated_by) VALUES(?,1,?,'review fixture','ACTIVE','2026-01-01','2099-01-01',1,1)",activity,"REVIEW-"+activity);
    for(int n=1;n<=2;n++) {
      long id=base+n;String type=n==1?"PRODUCT":"WHITELIST";
      jdbc.update("INSERT INTO stored_file(id,activity_id,storage_provider,bucket_name,object_key,original_filename,content_type,size_bytes,sha256,file_purpose) VALUES(?,?,'MINIO','test',?,'synthetic','application/octet-stream',0,UNHEX(SHA2('synthetic',256)),'OTHER')",id,activity,"synthetic-"+id);
      jdbc.update("INSERT INTO import_task(id,activity_id,import_type,status,source_file_id,file_sha256,created_by) VALUES(?,?,?,'COMPLETED',?,UNHEX(SHA2('synthetic',256)),1)",id,activity,type,id);
      jdbc.update("INSERT INTO import_publish_version(id,activity_id,data_type,version_no,source_import_task_id,status,created_by) VALUES(?,?,?,1,?,'PUBLISHED',1)",id,activity,type,id);
      jdbc.update("INSERT INTO activity_data_binding VALUES(?,?,?,0,1,UTC_TIMESTAMP(3))",activity,type,id);
    }
    jdbc.update("INSERT INTO activity_product(id,activity_id,customer_type,rebate_status,business_key,material_name,case_price,ton_case_factor,source_import_task_id,data_version_id) VALUES(?,?,'ALL','ALL',?,'synthetic',100,10,?,?)",base+11,activity,"synthetic-"+activity,base+1,base+1);
    repository=new OrderRepository(jdbc,JSON,new DashboardSummaryStore(jdbc,true,""));
    requests=new OrderChangeRequestRepository(jdbc);
    for(int n=1;n<=2;n++) {
      long id=base+n;
      jdbc.update("INSERT INTO customer(id,customer_type,dealer_full_name,normalized_dealer_full_name) VALUES(?,'GENERAL',?,?)",id,"customer-"+id,"customer-"+id);
      jdbc.update("INSERT INTO activity_customer(id,activity_id,customer_id,customer_type,dealer_full_name,normalized_dealer_full_name,source_import_task_id,data_version_id,phone_masked,phone_lookup_hash) VALUES(?,?,?,'GENERAL',?,?,?,?,'000****0000',UNHEX(SHA2(?,256)))",id,activity,id,"customer-"+id,"customer-"+id,base+2,base+2,"phone-"+id);
      jdbc.update("INSERT INTO customer_order(id,activity_id,activity_customer_id,order_no,status,customer_type,dealer_full_name_snapshot,current_version_no,total_quantity,total_tons,total_amount,first_submitted_at,last_submitted_at,last_modified_at) VALUES(?,?,?,?,'SUBMITTED','GENERAL','synthetic',1,10,0.1,1000,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",id,activity,id,"synthetic-"+id);
      jdbc.update("INSERT INTO order_item(order_id,activity_product_id,line_no,material_name,rebate_status,is_gift_box,quantity,case_price,line_amount,ton_case_factor,line_tons) VALUES(?,?,1,'synthetic','ALL',FALSE,10,100,1000,10,0.1)",id,base+11);
      repository.insertVersion(activity,id,1,repository.orderCustomer(activity,id),10,new BigDecimal("0.1"),new BigDecimal("1000"),"H5",null,null,"seed-"+id);
      long request=requests.insert(activity,id,id,"MODIFY",1,0,5L,new BigDecimal("0.05"),new BigDecimal("500"),
          "[{\"productId\":"+(base+11)+",\"quantity\":5}]",null,"request-"+id);
      if(n==1)requestA=request;else requestB=request;
    }
    activities=mock(ActivityService.class);
    when(activities.byId(activity)).thenAnswer(inv -> JSON.readValue("{\"id\":"+activity+",\"status\":\""+
        jdbc.queryForObject("SELECT status FROM activity WHERE id=?",String.class,activity)+"\",\"regions\":[]}",ActivityService.ActivityView.class));
    when(activities.orderingActivity("REVIEW-"+activity)).thenReturn(new ActivityService.OrderingActivity(activity,Instant.parse("2099-01-01T00:00:00Z")));
    doAnswer(inv -> {if(!"ACTIVE".equals(jdbc.queryForObject("SELECT status FROM activity WHERE id=?",String.class,activity)))
      throw DomainException.conflict("ACTIVITY_NOT_WRITABLE","test activity is not writable");return null;}).when(activities).requireWritable(activity);
    service=instance(repository);
    secondInstance=instance(new OrderRepository(jdbc,JSON,new DashboardSummaryStore(jdbc,true,"")));
  }

  OrderService instance(OrderRepository orders) {
    return new OrderService(orders,activities,mock(DashboardService.class),JSON,mock(OrderQueryService.class),new OrderChangeRequestRepository(jdbc));
  }
  H5Principal user(int n) {return new H5Principal(n,activity,base+n,"REVIEW-"+activity,"GENERAL",null,null,null,"customer",null);}
  OrderService.SubmitRequest submission(int version) {return new OrderService.SubmitRequest(version,List.of(new OrderService.SubmitItem(base+11,11)));}
  static void await(CountDownLatch latch) {try {assertThat(latch.await(8,TimeUnit.SECONDS)).isTrue();}catch(InterruptedException e){Thread.currentThread().interrupt();throw new RuntimeException(e);}}

  @ParameterizedTest @ValueSource(booleans={true,false})
  void otherCustomersReviewAndSubmitWhileSameCustomerAndPriceWriterWait(boolean approve) throws Exception {
    var held=new CountDownLatch(1);var release=new CountDownLatch(1);
    try(var pool=Executors.newFixedThreadPool(3)) {
      var review=pool.submit(() -> tx.execute(s -> {
        var result=approve?service.approveChangeRequest(activity,requestA,null,admin,"review-A","test")
            :service.rejectChangeRequest(activity,requestA,"rejected",admin,"review-A","test");
        held.countDown();await(release);return result;
      }));
      try {
        await(held);
        // A second service instance and the same admin identity must not contend on activity/admin rows.
        var reviewedB=tx.execute(s -> secondInstance.approveChangeRequest(activity,requestB,null,admin,"review-B","test"));
        assertThat(reviewedB.status()).isEqualTo("APPROVED");
        var submittedB=tx.execute(s -> secondInstance.submit("REVIEW-"+activity,user(2),submission(2),"submit-B","test",false));
        assertThat(submittedB.totalQuantity()).isEqualTo(11);
        var same=pool.submit(() -> {
          try {tx.execute(s -> secondInstance.submit("REVIEW-"+activity,user(1),submission(1),"submit-A","test",false));return "SUCCESS";}
          catch(DomainException e){return e.code();}
        });
        assertThatThrownBy(() -> same.get(200,TimeUnit.MILLISECONDS)).isInstanceOf(TimeoutException.class);
        var pricing=pool.submit(() -> tx.execute(s -> {repository.lockPricing(activity);return true;}));
        assertThatThrownBy(() -> pricing.get(200,TimeUnit.MILLISECONDS)).isInstanceOf(TimeoutException.class);
        release.countDown();
        assertThat(review.get(5,TimeUnit.SECONDS).status()).isEqualTo(approve?"APPROVED":"REJECTED");
        assertThat(same.get(5,TimeUnit.SECONDS)).isEqualTo(approve?"ORDER_VERSION_CONFLICT":"SUCCESS");
        assertThat(pricing.get(5,TimeUnit.SECONDS)).isTrue();
        assertThat(jdbc.queryForObject("SELECT total_quantity FROM customer_order WHERE id=?",Long.class,base+1)).isEqualTo(approve?5L:11L);
        assertThat(jdbc.queryForObject("SELECT total_amount FROM customer_order WHERE id=?",BigDecimal.class,base+2)).isEqualByComparingTo("1100");
        assertThat(jdbc.queryForObject("SELECT dirty FROM order_dashboard_stat WHERE order_id=?",Boolean.class,base+2)).isFalse();
      } finally {release.countDown();}
    }
  }

  @Test void repeatedConcurrentApprovalHasOneVersionAndOneOperation() throws Exception {
    var gate=new CountDownLatch(1);
    try(var pool=Executors.newFixedThreadPool(2)) {
      var first=pool.submit(() -> {await(gate);return tx.execute(s -> service.approveChangeRequest(activity,requestA,null,admin,"same-key","test"));});
      var second=pool.submit(() -> {await(gate);return tx.execute(s -> secondInstance.approveChangeRequest(activity,requestA,null,admin,"same-key","test"));});
      gate.countDown();assertThat(first.get(5,TimeUnit.SECONDS).status()).isEqualTo("APPROVED");assertThat(second.get(5,TimeUnit.SECONDS).status()).isEqualTo("APPROVED");
    }
    assertThat(jdbc.queryForObject("SELECT current_version_no FROM customer_order WHERE id=?",Integer.class,base+1)).isEqualTo(2);
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM order_operation WHERE order_id=? AND operation_type='H5_CHANGE_APPROVED'",Integer.class,base+1)).isEqualTo(1);
  }

  @Test void staleRequestConflictsAndInactiveCustomersCanStillBeReviewed() {
    jdbc.update("UPDATE customer_order SET lock_version=1 WHERE id=?",base+1);
    assertThat(tx.execute(s -> service.approveChangeRequest(activity,requestA,null,admin,"stale","test")).status()).isEqualTo("REJECTED");
    assertThat(jdbc.queryForObject("SELECT total_quantity FROM customer_order WHERE id=?",Long.class,base+1)).isEqualTo(10);
    jdbc.update("UPDATE activity_customer SET is_active=FALSE WHERE id=?",base+2);
    assertThat(tx.execute(s -> service.rejectChangeRequest(activity,requestB,"inactive customer",admin,"inactive","test")).status()).isEqualTo("REJECTED");
  }

  @ParameterizedTest @ValueSource(booleans={true,false})
  void reviewWaitsForPriceOrArchiveAndRechecksCommittedValues(boolean archive) throws Exception {
    var held=new CountDownLatch(1);var release=new CountDownLatch(1);
    try(var pool=Executors.newFixedThreadPool(2)) {
      var writer=pool.submit(() -> tx.execute(s -> {
        repository.lockPricing(activity);
        if(archive)jdbc.update("UPDATE activity SET status='ARCHIVED' WHERE id=?",activity);
        else jdbc.update("UPDATE activity_product SET case_price=200 WHERE id=?",base+11);
        held.countDown();await(release);return true;
      }));
      try {
        await(held);
        var review=pool.submit(() -> {
          try {return tx.execute(s -> service.approveChangeRequest(activity,requestA,null,admin,"after-writer","test")).status();}
          catch(DomainException e){return e.code();}
        });
        assertThatThrownBy(() -> review.get(200,TimeUnit.MILLISECONDS)).isInstanceOf(TimeoutException.class);
        release.countDown();assertThat(writer.get(5,TimeUnit.SECONDS)).isTrue();
        assertThat(review.get(5,TimeUnit.SECONDS)).isEqualTo(archive?"ACTIVITY_ARCHIVED_READ_ONLY":"APPROVED");
        assertThat(jdbc.queryForObject("SELECT status FROM order_change_request WHERE id=?",String.class,requestA)).isEqualTo(archive?"PENDING":"APPROVED");
        assertThat(jdbc.queryForObject("SELECT total_amount FROM customer_order WHERE id=?",BigDecimal.class,base+1)).isEqualByComparingTo("1000");
      } finally {release.countDown();}
    }
  }

  @Test void failedReviewRollsBackOrderRequestHistoryAndIdempotency() {
    var failing=spy(repository);
    doThrow(new IllegalStateException("injected outbox failure")).when(failing).writeOutbox(eq(activity),anyLong(),anyString(),anyMap());
    assertThatThrownBy(() -> tx.execute(s -> instance(failing).approveChangeRequest(activity,requestA,null,admin,"rollback","test"))).isInstanceOf(IllegalStateException.class);
    assertThat(jdbc.queryForObject("SELECT total_quantity FROM customer_order WHERE id=?",Long.class,base+1)).isEqualTo(10);
    assertThat(jdbc.queryForObject("SELECT status FROM order_change_request WHERE id=?",String.class,requestA)).isEqualTo("PENDING");
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM api_idempotency WHERE activity_id=?",Integer.class,activity)).isZero();
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM order_version WHERE order_id=?",Integer.class,base+1)).isEqualTo(1);
  }
}
