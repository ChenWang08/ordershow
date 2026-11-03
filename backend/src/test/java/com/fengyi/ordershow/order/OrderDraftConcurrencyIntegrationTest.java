package com.fengyi.ordershow.order;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengyi.ordershow.activity.ActivityService;
import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.security.H5Principal;
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

@EnabledIfEnvironmentVariable(named="ORDER_SHOW_DRAFT_TEST",matches="order-show-e2e")
class OrderDraftConcurrencyIntegrationTest {
  static HikariDataSource source;
  static JdbcTemplate jdbc;
  static DataSourceTransactionManager manager;
  static TransactionTemplate tx;
  static ActivityService activities;
  static ObjectMapper json=new ObjectMapper().findAndRegisterModules();
  OrderDraftService drafts;

  @BeforeAll static void setup() throws Exception {
    String url="jdbc:mysql://host.docker.internal:33306/";
    String options="?allowPublicKeyRetrieval=true&useSSL=false&serverTimezone=UTC";
    var root=new JdbcTemplate(new DriverManagerDataSource(url+"order_show_e2e"+options,"root","e2e_root_only_not_for_business"));
    // Fixed disposable database only; never accepts environment-supplied URLs.
    root.execute("DROP DATABASE IF EXISTS order_show_draft_test");
    root.execute("CREATE DATABASE order_show_draft_test CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci");
    var config=new HikariConfig(); config.setJdbcUrl(url+"order_show_draft_test"+options);
    config.setUsername("root");config.setPassword("e2e_root_only_not_for_business");config.setMaximumPoolSize(16);
    config.setConnectionInitSql("SET time_zone='+00:00'");
    source=new HikariDataSource(config);jdbc=new JdbcTemplate(source);manager=new DataSourceTransactionManager(source);
    tx=new TransactionTemplate(manager);tx.setIsolationLevel(TransactionDefinition.ISOLATION_READ_COMMITTED);
    jdbc.execute("CREATE TABLE activity(id BIGINT UNSIGNED PRIMARY KEY,status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',deletion_requested_at DATETIME NULL)");jdbc.execute("INSERT INTO activity(id) VALUES(1)");
    jdbc.execute("CREATE TABLE activity_customer(id BIGINT UNSIGNED PRIMARY KEY,activity_id BIGINT,is_active BOOLEAN,customer_id BIGINT,customer_type VARCHAR(20),data_version_id BIGINT,normalized_branch_name VARCHAR(50),normalized_dealer_full_name VARCHAR(50))");
    for(long id=1;id<=20;id++)jdbc.update("INSERT INTO activity_customer VALUES(?,1,TRUE,?,'GENERAL',1,'branch','dealer')",id,id);
    try(var stream=OrderDraftConcurrencyIntegrationTest.class.getResourceAsStream("/db/migration/V010__h5_order_draft.sql")) {
      jdbc.execute(new String(stream.readAllBytes(),StandardCharsets.UTF_8));
    }
    jdbc.execute("CREATE TABLE customer_order(activity_id BIGINT,activity_customer_id BIGINT,current_version_no INT,PRIMARY KEY(activity_id,activity_customer_id))");
    jdbc.execute("CREATE TABLE activity_product(id BIGINT PRIMARY KEY,activity_id BIGINT,data_version_id BIGINT,customer_type VARCHAR(20),is_visible BOOLEAN,is_orderable BOOLEAN)");
    jdbc.execute("INSERT INTO activity_product VALUES(11,1,1,'GENERAL',TRUE,TRUE)");
    jdbc.execute("CREATE TABLE activity_data_binding(activity_id BIGINT,data_type VARCHAR(20),current_version_id BIGINT)");
    jdbc.execute("INSERT INTO activity_data_binding VALUES(1,'PRODUCT',1),(1,'WHITELIST',1)");
    jdbc.execute("CREATE TABLE activity_product_branch_scope(activity_product_id BIGINT,normalized_branch_name VARCHAR(50))");
    jdbc.execute("CREATE TABLE activity_product_dealer_scope(activity_product_id BIGINT,normalized_branch_name VARCHAR(50))");
    jdbc.execute("CREATE TABLE activity_product_dealer_member(activity_product_id BIGINT,normalized_branch_name VARCHAR(50),customer_id BIGINT,customer_type VARCHAR(20),normalized_dealer_full_name VARCHAR(50))");
    activities=mock(ActivityService.class);
    var activity=new ActivityService.OrderingActivity(1,java.time.Instant.parse("2030-01-01T00:00:00Z"));
    when(activities.orderingActivity("draft")).thenReturn(activity);
  }

  @BeforeEach void reset() {
    jdbc.update("DELETE FROM h5_order_draft");jdbc.update("DELETE FROM customer_order");
    drafts=new OrderDraftService(jdbc,activities,json,new DraftSaveTransactions(manager,new SimpleMeterRegistry()));
  }
  static H5Principal user(long id) {return new H5Principal(1,1,id,"draft","GENERAL",null,"branch",null,"dealer",null);}
  static OrderDraftService.SaveDraftRequest request(long id,int version,long qty) {
    return new OrderDraftService.SaveDraftRequest(id,version,List.of(new OrderDraftService.DraftItem(11,qty)));
  }

  @Test void retainsIdentityVersionsExpiryAndDeleteSemantics() {
    var first=drafts.save("draft",user(1),request(1,0,1));assertThat(first.version()).isZero();
    jdbc.update("UPDATE h5_order_draft SET expires_at='2000-01-01' WHERE id=?",first.id());
    assertThat(drafts.current("draft",user(1))).isNull();
    var updated=drafts.save("draft",user(1),request(1,0,2));
    assertThat(updated.id()).isEqualTo(first.id());assertThat(updated.version()).isEqualTo(1);
    assertThat(updated.items().getFirst().quantity()).isEqualTo(2);
    assertThat((Boolean)tx.execute(s -> drafts.delete("draft",user(1),1))).isTrue();
    assertThat((Boolean)tx.execute(s -> drafts.delete("draft",user(1),1))).isFalse();
    assertThatThrownBy(() -> drafts.save("draft",user(1),request(2,0,1))).isInstanceOf(DomainException.class);
  }

  @Test void differentCustomersRepeatedlySaveAndSubmitWithoutCrossingData() throws Exception {
    try(var pool=Executors.newFixedThreadPool(10)) {
      var gate=new CountDownLatch(1);var tasks=new java.util.ArrayList<Future<?>>();
      for(long n=1;n<=10;n++) {long id=n; tasks.add(pool.submit(() -> {
        await(gate);
        for(int version=0;version<40;version++) {
          int v=version;
          var saved=drafts.save("draft",user(id),request(id,v,id));
          assertThat(saved.customerId()).isEqualTo(id);assertThat(saved.items().getFirst().quantity()).isEqualTo(id);
          tx.executeWithoutResult(s -> {
            OrderWriteLock.acquire(jdbc,1,id);
            jdbc.update("INSERT INTO customer_order VALUES(1,?,?) ON DUPLICATE KEY UPDATE current_version_no=VALUES(current_version_no)",id,v+1);
            OrderDraftWrites.delete(jdbc,1,id);
          });
        }
      })); }
      gate.countDown();for(var task:tasks)task.get(90,TimeUnit.SECONDS);
    }
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM customer_order WHERE current_version_no=40",Integer.class)).isEqualTo(10);
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM h5_order_draft",Integer.class)).isZero();
  }

  @Test void sameCustomerSerializesSavesAndDeleteAndSubmitRollBackTogether() throws Exception {
    try(var pool=Executors.newFixedThreadPool(8)) {
      var tasks=new java.util.ArrayList<Future<?>>();
      for(int n=0;n<40;n++) {int quantity=n+1;tasks.add(pool.submit(() -> drafts.save("draft",user(1),request(1,0,quantity))));}
      for(var task:tasks)task.get(30,TimeUnit.SECONDS);
    }
    assertThat(drafts.current("draft",user(1)).version()).isEqualTo(39);
    var before=drafts.current("draft",user(1));
    tx.executeWithoutResult(s -> {
      OrderWriteLock.acquire(jdbc,1,1);jdbc.update("INSERT INTO customer_order VALUES(1,1,1)");
      OrderDraftWrites.delete(jdbc,1,1);s.setRollbackOnly();
    });
    assertThat(drafts.current("draft",user(1))).isEqualTo(before);
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM customer_order",Integer.class)).isZero();
  }

  @Test void failedAttemptRollsBackAndRetryRevalidatesOrderVersion() {
    var once=new AtomicBoolean();
    var faultJdbc=new JdbcTemplate(source) {
      @Override public int update(String sql,Object... args) {
        int count=super.update(sql,args);
        if(sql.contains("INSERT INTO h5_order_draft") && once.compareAndSet(false,true))throw DraftSaveTransactionsTest.sql(1213,"40001");
        return count;
      }
    };
    var retry=new DraftSaveTransactions(manager,new SimpleMeterRegistry(),delay -> {
      assertThat(TransactionSynchronizationManager.isActualTransactionActive()).isFalse();
      assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM h5_order_draft",Integer.class)).isZero();
      jdbc.update("INSERT INTO customer_order VALUES(1,1,1)");
    });
    var service=new OrderDraftService(faultJdbc,activities,json,retry);
    assertThatThrownBy(() -> service.save("draft",user(1),request(1,0,1)))
        .isInstanceOfSatisfying(DomainException.class,e -> assertThat(e.code()).isEqualTo("DRAFT_BASE_ORDER_VERSION_CONFLICT"));
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM h5_order_draft",Integer.class)).isZero();
  }

  @Test void waitingSaveSeesSubmittedVersionAndCannotResurrectOldDraft() throws Exception {
    drafts.save("draft",user(1),request(1,0,1));
    try(var pool=Executors.newSingleThreadExecutor()) {
      var attempted=new CountDownLatch(1);
      Future<?>[] pending=new Future<?>[1];
      tx.executeWithoutResult(s -> {
        OrderWriteLock.acquire(jdbc,1,1);
        pending[0]=pool.submit(() -> {attempted.countDown();return drafts.save("draft",user(1),request(1,0,2));});
        await(attempted);
        jdbc.update("INSERT INTO customer_order VALUES(1,1,1)");OrderDraftWrites.delete(jdbc,1,1);
      });
      assertThatThrownBy(() -> pending[0].get(10,TimeUnit.SECONDS)).hasCauseInstanceOf(DomainException.class);
    }
    assertThat(drafts.current("draft",user(1))).isNull();
  }

  @Test void exhaustedRetriesLeaveNoPartiallySavedDraft() {
    var faultJdbc=new JdbcTemplate(source) {
      @Override public int update(String sql,Object... args) {
        int count=super.update(sql,args);
        if(sql.contains("INSERT INTO h5_order_draft"))throw DraftSaveTransactionsTest.sql(1213,"40001");
        return count;
      }
    };
    var meters=new SimpleMeterRegistry();
    var retry=new DraftSaveTransactions(manager,meters,delay -> {
      assertThat(TransactionSynchronizationManager.isActualTransactionActive()).isFalse();
      assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM h5_order_draft",Integer.class)).isZero();
    });
    var service=new OrderDraftService(faultJdbc,activities,json,retry);
    assertThatThrownBy(() -> service.save("draft",user(1),request(1,0,1))).isInstanceOf(org.springframework.dao.CannotAcquireLockException.class);
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM h5_order_draft",Integer.class)).isZero();
    assertThat(meters.counter("order_show.h5.draft.deadlocks").count()).isEqualTo(3);
    assertThat(meters.counter("order_show.h5.draft.retry_exhausted").count()).isEqualTo(1);
  }

  @Test void concurrentSaveAndExplicitDeleteRemainSingleCustomerAtomic() throws Exception {
    try(var pool=Executors.newFixedThreadPool(6)) {
      var tasks=new java.util.ArrayList<Future<?>>();
      for(int n=0;n<30;n++) {
        tasks.add(pool.submit(() -> drafts.save("draft",user(1),request(1,0,1))));
        tasks.add(pool.submit(() -> tx.execute(s -> drafts.delete("draft",user(1),1))));
      }
      for(var task:tasks)task.get(30,TimeUnit.SECONDS);
    }
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM h5_order_draft",Integer.class)).isBetween(0,1);
    tx.executeWithoutResult(s -> drafts.delete("draft",user(1),1));
    assertThat(drafts.current("draft",user(1))).isNull();
  }

  static void await(CountDownLatch latch) {
    try {if(!latch.await(10,TimeUnit.SECONDS))throw new AssertionError("timeout");}
    catch(InterruptedException e){Thread.currentThread().interrupt();throw new IllegalStateException(e);}
  }
  @AfterAll static void close(){if(source!=null)source.close();}
}
