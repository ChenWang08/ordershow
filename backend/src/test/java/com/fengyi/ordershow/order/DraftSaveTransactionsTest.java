package com.fengyi.ordershow.order;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.sql.SQLException;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.dao.CannotAcquireLockException;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.SimpleTransactionStatus;
import org.springframework.transaction.support.TransactionSynchronizationManager;

class DraftSaveTransactionsTest {
  static RuntimeException sql(int code, String state) {
    return new CannotAcquireLockException("test", new SQLException("test", state, code));
  }

  @Test void retriesOnlyConfirmedDeadlocksAfterRollbackAndCommitsOnce() {
    var manager = mock(PlatformTransactionManager.class);
    when(manager.getTransaction(any())).thenAnswer(call -> new SimpleTransactionStatus());
    var meters = new SimpleMeterRegistry();
    var attempts = new AtomicInteger();
    var writes = new DraftSaveTransactions(manager, meters, delay -> {
      assertThat(delay).isBetween(20L,100L);
      verify(manager, times(attempts.get())).rollback(any());
    });
    assertThat(writes.save(() -> { if (attempts.incrementAndGet()<3) throw sql(1213,"40001"); return "saved"; })).isEqualTo("saved");
    verify(manager,times(3)).getTransaction(any()); verify(manager,times(2)).rollback(any()); verify(manager).commit(any());
    assertThat(meters.counter("order_show.h5.draft.retries").count()).isEqualTo(2);
    assertThat(meters.counter("order_show.h5.draft.retry_recovered").count()).isEqualTo(1);
    assertThat(meters.timer("order_show.h5.draft.save").count()).isEqualTo(1);
  }

  @Test void exhaustionStopsAfterThreeAttempts() {
    var manager=mock(PlatformTransactionManager.class);
    when(manager.getTransaction(any())).thenAnswer(call -> new SimpleTransactionStatus());
    var meters=new SimpleMeterRegistry();
    var failure=sql(1213,"40001");
    var writes=new DraftSaveTransactions(manager,meters,delay -> {});
    assertThatThrownBy(() -> writes.save(() -> {throw failure;})).isSameAs(failure);
    verify(manager,times(3)).rollback(any()); verify(manager,never()).commit(any());
    assertThat(meters.counter("order_show.h5.draft.retry_exhausted").count()).isEqualTo(1);
  }

  @Test void doesNotRetryTimeoutDuplicateConnectionOrBusinessErrors() {
    for(var failure:java.util.List.of(sql(1205,"HY000"),sql(1062,"23000"),sql(0,"08006"),sql(0,"40001"),
        com.fengyi.ordershow.common.DomainException.conflict("ORDER_VERSION_CONFLICT","test"))) {
      var manager=mock(PlatformTransactionManager.class);
      when(manager.getTransaction(any())).thenReturn(new SimpleTransactionStatus());
      var writes=new DraftSaveTransactions(manager,new SimpleMeterRegistry(),delay -> fail("must not retry"));
      assertThatThrownBy(() -> writes.save(() -> {throw failure;})).isSameAs(failure);
      verify(manager).getTransaction(any()); verify(manager).rollback(any());
    }
  }

  @Test void uncertainCommitAndAmbientTransactionsAreNotRetried() {
    var manager=mock(PlatformTransactionManager.class);
    when(manager.getTransaction(any())).thenReturn(new SimpleTransactionStatus());
    var writes=new DraftSaveTransactions(manager,new SimpleMeterRegistry(),delay -> fail("must not retry"));
    doThrow(sql(0,"08006")).when(manager).commit(any());
    assertThatThrownBy(() -> writes.save(() -> "saved")).isInstanceOf(CannotAcquireLockException.class);
    verify(manager).getTransaction(any());
    TransactionSynchronizationManager.setActualTransactionActive(true);
    try { assertThatThrownBy(() -> writes.save(() -> "saved")).isInstanceOf(IllegalStateException.class); }
    finally { TransactionSynchronizationManager.setActualTransactionActive(false); }
    verify(manager).getTransaction(any());
  }
}
