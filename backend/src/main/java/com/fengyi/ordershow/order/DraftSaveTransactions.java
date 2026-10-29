package com.fengyi.ordershow.order;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import java.sql.SQLException;
import java.util.concurrent.ThreadLocalRandom;
import java.util.function.LongConsumer;
import java.util.function.Supplier;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

/** Retries only a MySQL-confirmed, fully rolled-back deadlock, never an uncertain commit. */
@Component
public class DraftSaveTransactions {
  private final TransactionTemplate transaction;
  private final LongConsumer pause;
  private final MeterRegistry registry;
  private final Counter deadlocks, retries, exhausted, recovered;
  private final Timer duration;

  @Autowired
  public DraftSaveTransactions(PlatformTransactionManager manager, MeterRegistry registry) {
    this(manager, registry, DraftSaveTransactions::sleep);
  }

  DraftSaveTransactions(PlatformTransactionManager manager, MeterRegistry registry, LongConsumer pause) {
    this.transaction = new TransactionTemplate(manager);
    transaction.setIsolationLevel(TransactionDefinition.ISOLATION_READ_COMMITTED);
    this.pause = pause;
    this.registry = registry;
    deadlocks = registry.counter("order_show.h5.draft.deadlocks");
    retries = registry.counter("order_show.h5.draft.retries");
    exhausted = registry.counter("order_show.h5.draft.retry_exhausted");
    recovered = registry.counter("order_show.h5.draft.retry_recovered");
    duration = registry.timer("order_show.h5.draft.save");
  }

  public <T> T save(Supplier<T> operation) {
    // Do not retry inside an ambient, already-doomed transaction, or silently
    // suspend a caller's business transaction and commit a draft independently.
    if (TransactionSynchronizationManager.isActualTransactionActive()) {
      throw new IllegalStateException("Draft save requires an outer non-transactional caller");
    }
    var sample = Timer.start(registry);
    try {
      for (int attempt = 0; ; attempt++) {
        try {
          T result = transaction.execute(status -> operation.get());
          if (attempt > 0) recovered.increment();
          return result;
        } catch (RuntimeException failure) {
          if (!isDeadlock(failure)) throw failure;
          deadlocks.increment();
          if (attempt == 2) { exhausted.increment(); throw failure; }
          // execute has finished rollback/cleanup before we wait; no held locks.
          retries.increment();
          pause.accept(ThreadLocalRandom.current().nextLong(attempt == 0 ? 20 : 50, attempt == 0 ? 51 : 101));
        }
      }
    } finally { sample.stop(duration); }
  }

  static boolean isDeadlock(Throwable failure) {
    for (Throwable cause = failure; cause != null; cause = cause.getCause()) {
      if (cause instanceof SQLException sql && sql.getErrorCode() == 1213 && "40001".equals(sql.getSQLState())) return true;
    }
    return false;
  }

  private static void sleep(long millis) {
    try { Thread.sleep(millis); }
    catch (InterruptedException exception) {
      Thread.currentThread().interrupt();
      throw new IllegalStateException("Draft retry interrupted", exception);
    }
  }
}
