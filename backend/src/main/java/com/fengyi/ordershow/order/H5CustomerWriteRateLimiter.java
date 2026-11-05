package com.fengyi.ordershow.order;

import com.fengyi.ordershow.common.DomainException;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import jakarta.annotation.PreDestroy;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Future;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.ClassPathResource;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

/** Shared short-lived write budgets; persistent idempotency remains authoritative. */
@Component
public class H5CustomerWriteRateLimiter {
  private static final Logger LOG = LoggerFactory.getLogger(H5CustomerWriteRateLimiter.class);
  record Decision(long status, long retryAfterMs) {}
  @FunctionalInterface interface Store {
    Decision check(String prefix, String member, String fingerprint, boolean replay, long windowMs, int operations, int requests);
  }
  private final Store store;
  private final boolean enabled;
  private final long windowMs, timeoutMs, recoveryMs;
  private final int operations, requests;
  private final ThreadPoolExecutor executor;
  private final AtomicLong unavailableUntil = new AtomicLong();
  private final Counter allowed, limited, degraded, replays;

  @Autowired
  public H5CustomerWriteRateLimiter(StringRedisTemplate redis, MeterRegistry meters,
      @Value("${H5_CUSTOMER_WRITE_RATE_LIMIT_ENABLED:true}") boolean enabled,
      @Value("${H5_CUSTOMER_WRITE_WINDOW_MS:10000}") long windowMs,
      @Value("${H5_CUSTOMER_WRITE_MAX_OPERATIONS:3}") int operations,
      @Value("${H5_CUSTOMER_WRITE_MAX_REQUESTS:20}") int requests,
      @Value("${H5_CUSTOMER_WRITE_REDIS_BUDGET_MS:200}") long timeoutMs,
      @Value("${H5_CUSTOMER_WRITE_REDIS_RECOVERY_MS:5000}") long recoveryMs) {
    this(redisStore(redis), meters, enabled, windowMs, operations, requests, timeoutMs, recoveryMs);
  }

  H5CustomerWriteRateLimiter(Store store, MeterRegistry meters, boolean enabled, long windowMs,
      int operations, int requests, long timeoutMs, long recoveryMs) {
    if (windowMs < 1 || windowMs > 300_000 || operations < 1 || requests < operations || requests > 1000
        || timeoutMs < 1 || timeoutMs > 1000 || recoveryMs < 1)
      throw new IllegalArgumentException("Invalid H5 customer write limits");
    this.store = store; this.enabled = enabled; this.windowMs = windowMs; this.operations = operations;
    this.requests = requests; this.timeoutMs = timeoutMs; this.recoveryMs = recoveryMs;
    // Four Redis calls at most, plus 32 waiting checks. No unbounded executor or per-customer connections.
    executor = new ThreadPoolExecutor(4, 4, 30, TimeUnit.SECONDS, new ArrayBlockingQueue<>(32),
        Thread.ofVirtual().name("h5-write-limit-", 0).factory(), new ThreadPoolExecutor.AbortPolicy());
    executor.allowCoreThreadTimeOut(true);
    allowed = meters.counter("order_show.h5.customer_write", "outcome", "allowed");
    limited = meters.counter("order_show.h5.customer_write", "outcome", "limited");
    degraded = meters.counter("order_show.h5.customer_write", "outcome", "degraded");
    replays = meters.counter("order_show.h5.customer_write", "outcome", "replay");
  }

  public boolean enabled() { return enabled; }

  void check(long activityId, long customerId, String endpoint, String key, byte[] fingerprint, boolean replay) {
    if (!enabled) return;
    long pause = unavailableUntil.get();
    if (pause != 0 && System.nanoTime() - pause < 0) { degraded.increment(); return; }
    String prefix = "order-show:h5-write:v1:{" + activityId + ":" + customerId + "}";
    String member = endpoint + ":" + digest(key.getBytes(StandardCharsets.UTF_8));
    Future<Decision> task = null;
    Decision result;
    try {
      task = executor.submit(() -> store.check(prefix, member, HexFormat.of().formatHex(fingerprint), replay,
          windowMs, operations, requests));
      result = task.get(timeoutMs, TimeUnit.MILLISECONDS);
      if (result == null) throw new IllegalStateException("Missing Redis rate limit result");
    } catch (InterruptedException error) {
      cancel(task); Thread.currentThread().interrupt();
      throw new DomainException(HttpStatus.SERVICE_UNAVAILABLE, "H5_WRITE_BUSY", "下单请求已中断，请稍后重试");
    } catch (Exception error) {
      // A timed-out call may still finish on the shared client. Bound those calls by the executor,
      // remove unsent work, and pause checks so a Redis outage cannot build up background work.
      cancel(task); degraded.increment();
      long now = System.nanoTime();
      long until = unavailableUntil.get();
      if ((until == 0 || now - until >= 0) && unavailableUntil.compareAndSet(until, now + TimeUnit.MILLISECONDS.toNanos(recoveryMs)))
        LOG.warn("H5 customer limiting unavailable; global write admission remains active ({})",
            error instanceof ExecutionException ? error.getCause().getClass().getSimpleName() : error.getClass().getSimpleName());
      return;
    }
    if (result.status() == 0) { limited.increment(); throw new H5WriteRateLimitException(result.retryAfterMs()); }
    if (result.status() == -1) throw DomainException.conflict("IDEMPOTENCY_KEY_REUSED", "同一幂等键不能用于不同请求");
    if (result.status() == 2) replays.increment(); else allowed.increment();
  }

  private void cancel(Future<?> task) {
    if (task != null) {
      task.cancel(false);
      if (task instanceof Runnable runnable) executor.remove(runnable);
    }
  }

  static String digest(byte[] bytes) {
    try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)); }
    catch (NoSuchAlgorithmException error) { throw new IllegalStateException(error); }
  }

  private static Store redisStore(StringRedisTemplate redis) {
    DefaultRedisScript<List> script = new DefaultRedisScript<>();
    script.setLocation(new ClassPathResource("redis/h5-customer-write.lua")); script.setResultType(List.class);
    return (prefix, member, fingerprint, replay, window, operations, requests) -> {
      List<?> result = redis.execute(script, List.of(prefix + ":requests", prefix + ":operations", prefix + ":fingerprints"),
          String.valueOf(window), String.valueOf(operations), String.valueOf(requests), member, fingerprint,
          replay ? "1" : "0", UUID.randomUUID().toString());
      if (result == null || result.size() != 2 || !(result.get(0) instanceof Number status)
          || !(result.get(1) instanceof Number delay) || !List.of(-1L, 0L, 1L, 2L).contains(status.longValue()))
        throw new IllegalStateException("Invalid Redis rate limit result");
      return new Decision(status.longValue(), delay.longValue());
    };
  }

  @PreDestroy public void close() { executor.shutdownNow(); }
}
