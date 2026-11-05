package com.fengyi.ordershow.audit;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.locks.ReentrantLock;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionOperations;
import org.springframework.transaction.support.TransactionTemplate;

/** Request threads combine audit commits; no asynchronous acknowledgement or background queue. */
@Component
public class AuditBatchWriter {
  private static final String INSERT = """
      INSERT INTO audit_log(activity_id,actor_type,admin_user_id,action_code,object_type,object_id,reason,
        result,error_code,trace_id,ip_address,user_agent,occurred_at,actor_identity_snapshot,actor_role_snapshot)
      VALUES ((SELECT id FROM activity WHERE id=? AND deletion_requested_at IS NULL FOR SHARE),?,?,?,?,?,?,?,?,?,INET6_ATON(?),?,?,?,?)
      """;
  private final JdbcTemplate jdbc;
  private final TransactionOperations transactions;
  private final ArrayBlockingQueue<Pending> pending = new ArrayBlockingQueue<>(256);
  private final ReentrantLock flushLock = new ReentrantLock();

  @Autowired
  public AuditBatchWriter(JdbcTemplate jdbc, PlatformTransactionManager manager) {
    this(jdbc, transactionTemplate(manager));
  }

  AuditBatchWriter(JdbcTemplate jdbc, TransactionOperations transactions) {
    this.jdbc = jdbc;
    this.transactions = transactions;
  }

  private static TransactionTemplate transactionTemplate(PlatformTransactionManager manager) {
    var template = new TransactionTemplate(manager);
    template.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    return template;
  }

  public void write(Object[] values) {
    var entry = new Pending(values.clone());
    if (!pending.offer(entry)) {
      // Bounded memory; overflow remains synchronous rather than dropping events.
      persist(List.of(entry));
    } else {
      flushLock.lock();
      try {
        while (!entry.complete) {
          var batch = new ArrayList<Pending>(100);
          pending.drainTo(batch, 100);
          persist(batch);
        }
      } finally { flushLock.unlock(); }
    }
    if (entry.failure != null) throw entry.failure;
  }

  int pendingCount() { return pending.size(); }

  private void persist(List<Pending> batch) {
    try {
      transactions.execute(status -> {
        jdbc.batchUpdate(INSERT, batch.stream().map(entry -> entry.values).toList());
        return null;
      });
    } catch (RuntimeException failure) {
      if (failure instanceof DataIntegrityViolationException
          || (failure instanceof org.springframework.jdbc.UncategorizedSQLException sql && sql.getSQLException().getErrorCode()==3819)) {
        // MySQL CHECK (3819/HY000) is not translated as DataIntegrityViolationException.
        // The explicit transaction rolled the whole batch back. Isolate a bad row.
        for (var entry : batch) {
          try {
            transactions.execute(status -> { jdbc.update(INSERT, entry.values); return null; });
          } catch (RuntimeException individualFailure) { entry.failure = individualFailure; }
        }
      } else {
        // An ambiguous connection/commit failure must not be blindly replayed.
        for (var entry : batch) entry.failure = failure;
      }
    } finally {
      for (var entry : batch) entry.complete = true;
    }
  }

  private static final class Pending {
    final Object[] values;
    boolean complete;
    RuntimeException failure;
    Pending(Object[] values) { this.values = values; }
  }
}
