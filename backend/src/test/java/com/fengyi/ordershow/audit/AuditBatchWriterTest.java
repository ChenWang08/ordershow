package com.fengyi.ordershow.audit;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
import java.util.List;
import java.util.ArrayList;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.TransactionStatus;
import org.springframework.transaction.support.TransactionCallback;
import org.springframework.transaction.support.TransactionOperations;

class AuditBatchWriterTest {
  final TransactionOperations transactions=new TransactionOperations() {
    public <T> T execute(TransactionCallback<T> action) { return action.doInTransaction(mock(TransactionStatus.class)); }
  };
  @Test void concurrentCallersReturnOnlyAfterTheirBatchCommitCompletes() throws Exception {
    var jdbc=mock(JdbcTemplate.class);var entered=new CountDownLatch(1);var release=new CountDownLatch(1);
    var batches=new ArrayList<Integer>();var completed=new AtomicInteger();
    when(jdbc.batchUpdate(anyString(),org.mockito.ArgumentMatchers.<List<Object[]>>any())).thenAnswer(call->{
      List<Object[]> rows=call.getArgument(1);batches.add(rows.size());
      if(batches.size()==1) {entered.countDown();assertThat(release.await(5,TimeUnit.SECONDS)).isTrue();}
      return new int[rows.size()];
    });
    var writer=new AuditBatchWriter(jdbc,transactions);
    try(var pool=Executors.newFixedThreadPool(13)) {
      var jobs=new ArrayList<Future<?>>();
      jobs.add(pool.submit(()->{writer.write(new Object[]{0});completed.incrementAndGet();}));
      assertThat(entered.await(3,TimeUnit.SECONDS)).isTrue();
      for(int n=1;n<=12;n++) {int id=n;jobs.add(pool.submit(()->{writer.write(new Object[]{id});completed.incrementAndGet();}));}
      try {
        long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(3);
        while(writer.pendingCount()<12 && System.nanoTime()<deadline) Thread.sleep(5);
        assertThat(writer.pendingCount()).isEqualTo(12);assertThat(completed.get()).isZero();
      } finally {release.countDown();}
      for(var job:jobs)job.get(5,TimeUnit.SECONDS);
      assertThat(completed.get()).isEqualTo(13);assertThat(batches).containsExactly(1,12);
    } finally {release.countDown();}
  }
  @Test void ambiguousCommitFailureIsPropagatedWithoutIndividualReplay() {
    var jdbc=mock(JdbcTemplate.class);
    when(jdbc.batchUpdate(anyString(),org.mockito.ArgumentMatchers.<List<Object[]>>any()))
        .thenThrow(new org.springframework.dao.DataAccessResourceFailureException("connection lost"));
    assertThatThrownBy(()->new AuditBatchWriter(jdbc,transactions).write(new Object[]{1}))
        .isInstanceOf(org.springframework.dao.DataAccessResourceFailureException.class);
    verify(jdbc,never()).update(anyString(),any(Object[].class));
  }
  @Test void constraintFailureIsIsolatedAndIndividualFailureStillReachesCaller() {
    var jdbc=mock(JdbcTemplate.class);
    when(jdbc.batchUpdate(anyString(),org.mockito.ArgumentMatchers.<List<Object[]>>any()))
        .thenThrow(new org.springframework.dao.DataIntegrityViolationException("bad row"));
    var writer=new AuditBatchWriter(jdbc,transactions);
    writer.write(new Object[]{1});verify(jdbc).update(anyString(),eq(1));
    when(jdbc.update(anyString(),any(Object[].class))).thenThrow(new org.springframework.dao.DataIntegrityViolationException("invalid"));
    assertThatThrownBy(()->writer.write(new Object[]{2})).isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
  }
}
