package com.fengyi.ordershow.audit;

import static org.assertj.core.api.Assertions.*;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.ArrayList;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;

@EnabledIfEnvironmentVariable(named="ORDER_SHOW_LOAD",matches="order-show-load")
class AuditBatchIntegrationTest {
  @Test void failedBatchRollsBackBeforeIsolatingRowsWithoutDuplicates() throws Exception {
    try(var source=new SingleConnectionDataSource(
        "jdbc:mysql://mysql:3306/order_show_load?serverTimezone=UTC&allowPublicKeyRetrieval=true&useSSL=false&rewriteBatchedStatements=true",
        "order_show_load","load_only_password",true)) {
      var plain=new JdbcTemplate(source);
      assertThat(plain.queryForObject("SELECT DATABASE()",String.class)).isEqualTo("order_show_load");
      plain.execute("CREATE TEMPORARY TABLE audit_template LIKE order_show_load.audit_log");
      plain.execute("CREATE TEMPORARY TABLE audit_log LIKE audit_template");
      var entered=new CountDownLatch(1);var release=new CountDownLatch(1);var calls=new AtomicInteger();
      var jdbc=new JdbcTemplate(source) {
        @Override public int[] batchUpdate(String sql,List<Object[]> rows) {
          if(calls.incrementAndGet()==1) {
            entered.countDown();
            try {assertThat(release.await(5,TimeUnit.SECONDS)).isTrue();}
            catch(InterruptedException failure) {Thread.currentThread().interrupt();throw new IllegalStateException(failure);}
          }
          return super.batchUpdate(sql,rows);
        }
      };
      var writer=new AuditBatchWriter(jdbc,new DataSourceTransactionManager(source));
      var timestamp=Timestamp.from(Instant.parse("2026-09-08T00:00:00Z"));
      try(var pool=Executors.newFixedThreadPool(4)) {
        var jobs=new ArrayList<Future<?>>();
        for(int n=0;n<4;n++) {
          int id=n;
          jobs.add(pool.submit(()->writer.write(new Object[]{null,"SYSTEM",null,"TEST","ORDER",String.valueOf(id),null,
              id==1?"INVALID":"SUCCESS",null,"batch-test-"+id,"127.0.0.1","test",timestamp,null,null})));
          if(n==0) assertThat(entered.await(3,TimeUnit.SECONDS)).isTrue();
        }
        try {
          long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(3);
          while(writer.pendingCount()<3 && System.nanoTime()<deadline)Thread.sleep(5);
          assertThat(writer.pendingCount()).isEqualTo(3);
        }finally {release.countDown();}
        for(int n=0;n<4;n++) {
          if(n==1) {
            var job=jobs.get(n);
            assertThatThrownBy(()->job.get(5,TimeUnit.SECONDS)).isInstanceOf(ExecutionException.class)
                .hasCauseInstanceOf(org.springframework.dao.DataAccessException.class);
          } else jobs.get(n).get(5,TimeUnit.SECONDS);
        }
      }finally {release.countDown();}
      assertThat(calls.get()).isEqualTo(2);
      assertThat(plain.queryForObject("SELECT COUNT(*) FROM audit_log",Integer.class)).isEqualTo(3);
      assertThat(plain.queryForList("SELECT trace_id FROM audit_log ORDER BY trace_id",String.class))
          .containsExactly("batch-test-0","batch-test-2","batch-test-3");
      assertThat(plain.queryForObject("SELECT COUNT(*) FROM audit_log WHERE occurred_at=? AND INET6_NTOA(ip_address)='127.0.0.1'",Integer.class,timestamp)).isEqualTo(3);
    }
  }
}
