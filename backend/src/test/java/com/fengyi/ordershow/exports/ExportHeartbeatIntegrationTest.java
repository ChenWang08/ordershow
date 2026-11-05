package com.fengyi.ordershow.exports;

import static com.fengyi.ordershow.exports.ExportModels.*;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.config.OrderShowProperties;
import com.fengyi.ordershow.security.AdminPrincipal;
import com.fengyi.ordershow.storage.StorageService;
import com.zaxxer.hikari.HikariDataSource;
import java.nio.file.*;
import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.mock.env.MockEnvironment;

/** Fixed disposable ACK smoke endpoints; never connects to or cleans a business database. */
@EnabledIfEnvironmentVariable(named="ACK_EXPORT_HEARTBEAT_TEST",matches="ack-smoke-only")
class ExportHeartbeatIntegrationTest {
  static final String URL="jdbc:mysql://mysql:3306/ack_smoke?allowPublicKeyRetrieval=true&useSSL=false&connectionTimeZone=UTC&forceConnectionTimeZoneToSession=true";
  static final AdminPrincipal ROOT=new AdminPrincipal(1,"heartbeat-test","测试超管","SUPER_ADMIN",null,null,false);
  static final OrderShowProperties PROPS=new OrderShowProperties("http://localhost",false,12,12,"test-hmac","test-encryption","test","unused","测试",
      new OrderShowProperties.Storage("http://minio:9000","smoke_minio","isolated_smoke_minio_password","ack-smoke"));
  @TempDir Path directory;
  HikariDataSource control,reads;
  JdbcTemplate jdbc;
  ExportRepository tasks;
  ExportPolicy policy;
  long activityId;

  static HikariDataSource pool(String name) {
    var pool=new HikariDataSource();pool.setJdbcUrl(URL);pool.setUsername("ack_smoke");pool.setPassword("isolated_smoke_password");
    pool.setPoolName(name);pool.setMaximumPoolSize(1);pool.setMinimumIdle(0);pool.setConnectionTimeout(500);
    pool.setConnectionInitSql("SET time_zone = '+00:00'");return pool;
  }
  @BeforeEach void setup() {
    control=pool("heartbeat-test-control");reads=pool("heartbeat-test-read");jdbc=new JdbcTemplate(control);
    assertThat(jdbc.queryForObject("SELECT DATABASE()",String.class)).isEqualTo("ack_smoke");
    jdbc.update("INSERT IGNORE INTO admin_user(id,username,display_name,password_hash,role_code) VALUES(1,'heartbeat-test','test','unused','SUPER_ADMIN')");
    activityId=jdbc.queryForObject("SELECT COALESCE(MAX(id),0)+1 FROM activity",Long.class);
    jdbc.update("INSERT INTO activity(id,department_id,activity_code,name,status,starts_at,ends_at,event_ends_at,created_by,updated_by) VALUES(?,1,?,?,'FINISHED','2020-01-01','2020-01-02','2020-01-03',1,1)",activityId,"HEART"+activityId,"续期测试"+activityId);
    policy=new ExportPolicy(jdbc);tasks=new ExportRepository(jdbc,new DataSourceTransactionManager(control),new ObjectMapper().findAndRegisterModules(),policy,10);
  }
  @AfterEach void close() {if(reads!=null)reads.close();if(control!=null)control.close();}
  CsvExportGenerator generator() {
    return new ExportWorkerApplication().generator(reads,PROPS,new MockEnvironment()
        .withProperty("order-show.export.batch-size","2").withProperty("order-show.export.max-temp-bytes","1048576"));
  }
  Task create() {return tasks.create(activityId,new Filters(null,null,null),UUID.randomUUID().toString(),ROOT);}

  @Test void snapshotProgressLeavesTheSingleControlConnectionAvailableForHeartbeat()throws Exception {
    Task task=create();Claim claim=tasks.claim();var checked=new AtomicBoolean();
    try(var executor=Executors.newSingleThreadExecutor()) {
      generator().generate(task,directory,(stage,orders,details)->{
        policy.requireTask(task);tasks.progress(claim,stage,orders,details);
        if("READING".equals(stage)&&checked.compareAndSet(false,true)) {
          // This is still inside the read transaction, after the real progress/policy queries.
          assertThat(reads.getHikariPoolMXBean().getActiveConnections()).isEqualTo(1);
          try {assertThat(executor.submit(()->tasks.heartbeat(claim)).get(3,TimeUnit.SECONDS)).isTrue();}
          catch(Exception error){throw new AssertionError("Heartbeat must not wait for the CSV read transaction",error);}
          assertThat(control.getHikariPoolMXBean().getActiveConnections()).isZero();
          jdbc.update("UPDATE activity SET name='快照开始后修改' WHERE id=?",activityId);
          assertThat(jdbc.queryForObject("SELECT name FROM activity WHERE id=?",String.class,activityId)).isEqualTo("快照开始后修改");
          assertThat(new JdbcTemplate(reads).queryForObject("SELECT name FROM activity WHERE id=?",String.class,activityId)).isEqualTo("续期测试"+activityId);
        }
      });
    }finally {tasks.fail(claim,"TEST_DONE","test finished");tasks.release(claim);}
    assertThat(checked).isTrue();
    assertThat(reads.getHikariPoolMXBean().getActiveConnections()).isZero();
  }

  @Test void runnerSurvivesTheFirstScheduledHeartbeatAndStillFencesCancelledOrReclaimedClaims()throws Exception {
    // Match the deployed 5-second connection wait and keep reading beyond 10+5 seconds.
    control.setConnectionTimeout(5000);
    Task task=create();var delayed=spy(generator());var waited=new AtomicBoolean();
    doAnswer(call->{
      CsvExportGenerator.Progress progress=call.getArgument(2);
      return generator().generate(call.getArgument(0),call.getArgument(1),(stage,orders,details)->{
        progress.update(stage,orders,details);
        if("READING".equals(stage)&&waited.compareAndSet(false,true)) {
          try {Thread.sleep(16000);}catch(InterruptedException error){Thread.currentThread().interrupt();throw new IllegalStateException(error);}
        }
      });
    }).when(delayed).generate(any(),any(),any());
    var storage=new StorageService(PROPS,jdbc);Instant start=Instant.now();
    try(var runner=new ExportRunner(tasks,policy,delayed,storage,directory,1048576,24)){runner.tick();}
    Task done=tasks.task(activityId,task.id());
    System.out.printf("EXPORT_HEARTBEAT status=%s elapsedMs=%d failure=%s%n",done.status(),java.time.Duration.between(start,Instant.now()).toMillis(),done.failureCode());
    assertThat(done.status()).isEqualTo("COMPLETED");assertThat(done.sheetCounts()).containsExactly(0L,0L,0L,0L);
    try(var input=storage.openExport(storage.meta(done.fileId()))) {assertThat(input.read()).isEqualTo('P');assertThat(input.read()).isEqualTo('K');}
    try(var paths=Files.list(directory)){assertThat(paths.toList()).isEmpty();}

    Task next=create();Claim old=tasks.claim();
    jdbc.update("UPDATE order_export_worker SET lease_expires_at=TIMESTAMPADD(SECOND,-1,UTC_TIMESTAMP(3)) WHERE id=1");
    assertThat(tasks.heartbeat(old)).isFalse();Claim current=tasks.claim();
    assertThat(current.task().id()).isEqualTo(next.id());assertThat(current.token()).isNotEqualTo(old.token());
    assertThatThrownBy(()->tasks.progress(old,"READING",0,0)).isInstanceOf(DomainException.class);
    assertThatThrownBy(()->tasks.complete(old,done.fileId(),new Result(directory,Instant.now(),done.sheetCounts()),24)).isInstanceOf(DomainException.class);
    assertThat(tasks.heartbeat(current)).isTrue();tasks.cancel(activityId,next.id());
    assertThat(tasks.heartbeat(current)).isFalse();
    assertThatThrownBy(()->tasks.progress(current,"READING",0,0)).isInstanceOf(DomainException.class);
    tasks.fail(current,"TEST_DONE","test finished");tasks.release(current);
  }
}
