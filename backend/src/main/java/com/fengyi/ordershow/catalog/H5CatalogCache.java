package com.fengyi.ordershow.catalog;

import com.fengyi.ordershow.catalog.H5CatalogDataService.Change;
import com.fengyi.ordershow.catalog.H5CatalogDataService.Snapshot;
import com.fengyi.ordershow.common.DomainException;
import io.micrometer.core.instrument.MeterRegistry;
import jakarta.annotation.PreDestroy;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

/** One immutable snapshot and one in-flight load per activity, with bounded resources. */
@Service
public class H5CatalogCache {
  private final H5CatalogDataService data;
  private final MeterRegistry metrics;
  private final Limits limits;
  private final Semaphore loaders;
  private final Semaphore waiters;
  private final ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();
  private final LinkedHashMap<Long, Entry> entries = new LinkedHashMap<>(16, .75f, true);
  private final Map<Long, Flight> flights = new HashMap<>();
  private final Map<Long, Change> changes = new HashMap<>();
  private long bytes;
  private long epoch;
  private boolean closed;

  @Autowired
  public H5CatalogCache(H5CatalogDataService data, MeterRegistry metrics,
      @Value("${H5_CATALOG_MAX_ACTIVITIES:32}") int activities,
      @Value("${H5_CATALOG_MAX_BYTES:33554432}") long maxBytes,
      @Value("${H5_CATALOG_IDLE_SECONDS:600}") long idleSeconds,
      @Value("${H5_CATALOG_MAX_LOADS:8}") int maxLoads,
      @Value("${H5_CATALOG_MAX_WAITERS:512}") int maxWaiters,
      @Value("${H5_CATALOG_WAIT_MILLIS:5000}") long waitMillis) {
    this(data, metrics, new Limits(activities, maxBytes, Duration.ofSeconds(idleSeconds), maxLoads, maxWaiters, waitMillis));
  }

  H5CatalogCache(H5CatalogDataService data, MeterRegistry metrics, Limits limits) {
    this.data = data; this.metrics = metrics; this.limits = limits;
    loaders = new Semaphore(limits.loads()); waiters = new Semaphore(limits.waiters());
    metrics.gauge("order_show.h5.catalog.entries", this, cache -> cache.entryCount());
    metrics.gauge("order_show.h5.catalog.estimated_bytes", this, cache -> cache.estimatedBytes());
    metrics.gauge("order_show.h5.catalog.waiters", this, cache -> limits.waiters() - waiters.availablePermits());
    metrics.gauge("order_show.h5.catalog.active_loads", this, cache -> limits.loads() - loaders.availablePermits());
  }

  public Snapshot get(long activityId, long minimumVersion) {
    return lookup(activityId, minimumVersion).snapshot();
  }

  public Lookup lookup(long activityId, long minimumVersion) {
    CompletableFuture<Snapshot> future;
    synchronized (this) {
      expire();
      var entry = entries.get(activityId);
      if (entry != null && entry.snapshot.version() >= minimumVersion) {
        entry.accessed = System.nanoTime();
        metrics.counter("order_show.h5.catalog.cache", "result", "hit").increment();
        return new Lookup(entry.snapshot, false);
      }
      metrics.counter("order_show.h5.catalog.cache", "result", "miss").increment();
      future = start(activityId).future;
    }
    if (!waiters.tryAcquire()) throw busy();
    try { return new Lookup(future.get(limits.waitMillis(), TimeUnit.MILLISECONDS), true); }
    catch (TimeoutException error) {
      metrics.counter("order_show.h5.catalog.wait_timeout").increment();
      throw busy(); // Shared work continues; one impatient caller must not cancel everyone else's load.
    } catch (InterruptedException error) {
      Thread.currentThread().interrupt(); throw busy();
    } catch (ExecutionException error) {
      if (error.getCause() instanceof RuntimeException cause) throw cause;
      throw busy();
    } finally { waiters.release(); }
  }

  public synchronized void changed(Change change) {
    expire();
    var entry = entries.get(change.activityId());
    if (entry == null && !flights.containsKey(change.activityId())) return;
    if (entry != null && entry.snapshot.version() >= change.toVersion()) return;
    changes.merge(change.activityId(), change, H5CatalogCache::merge);
    if (!flights.containsKey(change.activityId()) && loaders.availablePermits() > 0) start(change.activityId());
  }

  /** Reconnect recovery: subsequent requests verify the DB revision and refill, without a reload storm. */
  public synchronized void resynchronize() { epoch++; entries.clear(); changes.clear(); bytes = 0; }

  private Flight start(long activityId) {
    if (closed) throw busy();
    var running = flights.get(activityId);
    if (running != null) return running;
    if (!loaders.tryAcquire()) throw busy();
    var entry = entries.get(activityId);
    var flight = new Flight(epoch, new CompletableFuture<>());
    var change = changes.remove(activityId);
    flights.put(activityId, flight);
    try {
      executor.execute(() -> load(activityId, entry == null ? null : entry.snapshot, change, flight));
    } catch (RuntimeException error) {
      flights.remove(activityId); loaders.release(); flight.future.completeExceptionally(error);
    }
    return flight;
  }

  private void load(long activityId, Snapshot base, Change change, Flight flight) {
    Snapshot snapshot;
    long weight;
    try {
      snapshot = data.load(activityId, base, change);
      weight = estimate(snapshot); // Do not hold the cache-wide lock while estimating a large catalog.
    } catch (Exception error) {
      synchronized (this) {
        flights.remove(activityId, flight); loaders.release(); changes.remove(activityId);
        flight.future.completeExceptionally(error);
      }
      metrics.counter("order_show.h5.catalog.load_errors").increment();
      LoggerFactory.getLogger(getClass()).warn("Catalog load failed: activity={}, type={}", activityId, error.getClass().getSimpleName());
      return;
    }
    synchronized (this) {
      if (epoch == flight.epoch && !closed) retain(snapshot, weight);
      flights.remove(activityId, flight);
      loaders.release();
      flight.future.complete(snapshot);
      var next = changes.get(activityId);
      if (next != null && next.toVersion() <= snapshot.version()) changes.remove(activityId);
      else if (!closed && next != null && entries.containsKey(activityId) && loaders.availablePermits() > 0) start(activityId);
      else if (!entries.containsKey(activityId)) changes.remove(activityId);
    }
  }

  private void retain(Snapshot snapshot, long weight) {
    var previous = entries.get(snapshot.activityId());
    if (previous != null && previous.snapshot.version() > snapshot.version()) return;
    if (previous != null) { entries.remove(snapshot.activityId()); bytes -= previous.weight; }
    if (weight > limits.bytes()) {
      metrics.counter("order_show.h5.catalog.oversize").increment(); return;
    }
    entries.put(snapshot.activityId(), new Entry(snapshot, weight)); bytes += weight;
    while (entries.size() > limits.activities() || bytes > limits.bytes()) evict(entries.keySet().iterator().next());
  }

  @Scheduled(fixedDelay = 60000)
  synchronized void expire() {
    long cutoff = System.nanoTime() - limits.idle().toNanos();
    for (long id : entries.entrySet().stream().filter(e -> e.getValue().accessed < cutoff).map(Map.Entry::getKey).toList()) evict(id);
  }

  private void evict(long id) {
    var entry = entries.remove(id);
    if (entry != null) { bytes -= entry.weight; metrics.counter("order_show.h5.catalog.evictions").increment(); }
    if (!flights.containsKey(id)) changes.remove(id);
  }

  public static Change merge(Change a, Change b) {
    var first = a.fromVersion() <= b.fromVersion() ? a : b;
    var last = first == a ? b : a;
    var ids = new HashSet<>(a.productIds()); ids.addAll(b.productIds());
    boolean full = a.fullReload() || b.fullReload() || last.fromVersion() > first.toVersion() + 1
        || ids.size() > ProductCatalogChanges.MAX_PRODUCT_IDS;
    return new Change(a.activityId(), Math.min(a.fromVersion(), b.fromVersion()), Math.max(a.toVersion(), b.toVersion()), full ? Set.of() : ids, full);
  }

  // Conservative accounting estimate, not an exact JVM heap measurement. Includes slim snapshot and rules.
  static long estimate(Snapshot snapshot) {
    long weight = 512;
    for (var product : snapshot.products()) {
      weight += 1024L + product.toString().length() * 4L;
    }
    for (var rule : snapshot.rules().values()) weight += 256L + rule.toString().length() * 4L;
    return weight;
  }

  synchronized int entryCount() { return entries.size(); }
  synchronized long estimatedBytes() { return bytes; }
  static DomainException busy() {
    return new DomainException(HttpStatus.SERVICE_UNAVAILABLE, "CATALOG_BUSY", "商品资料正在加载，请稍后重试");
  }
  @PreDestroy public synchronized void close() { closed = true; resynchronize(); executor.shutdownNow(); }

  public record Lookup(Snapshot snapshot, boolean waited) {}

  record Limits(int activities, long bytes, Duration idle, int loads, int waiters, long waitMillis) {
    Limits {
      if (activities < 1 || bytes < 1 || idle.isNegative() || idle.isZero() || loads < 1 || waiters < 1 || waitMillis < 1)
        throw new IllegalArgumentException("Catalog cache limits must be positive");
    }
  }
  private static final class Entry {
    final Snapshot snapshot; final long weight; long accessed = System.nanoTime();
    Entry(Snapshot snapshot, long weight) { this.snapshot = snapshot; this.weight = weight; }
  }
  private record Flight(long epoch, CompletableFuture<Snapshot> future) {}
}
