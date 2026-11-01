package com.fengyi.ordershow.activity;

import com.fengyi.ordershow.common.DomainException;
import io.micrometer.core.instrument.MeterRegistry;
import java.time.Clock;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.ReentrantLock;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

/** Bounded per-process cache. Waiting requests never hold a database transaction/connection. */
@Service
public class ActivityInfoHttpService {
  private final ActivityInfoSnapshotService snapshots;
  private final Map<String, Entry> entries = new LinkedHashMap<>(16, .75f, true);
  private final Semaphore readers, loads;
  private final int maxActivities;
  private final long revisionTtlMs, waitMs;
  private final Clock clock;
  private final MeterRegistry metrics;

  @Autowired
  public ActivityInfoHttpService(ActivityInfoSnapshotService snapshots, MeterRegistry metrics,
      @Value("${order-show.activity-http.max-activities:64}") int maxActivities,
      @Value("${order-show.activity-http.max-loads:2}") int maxLoads,
      @Value("${order-show.activity-http.max-waiters:128}") int maxWaiters,
      @Value("${order-show.activity-http.revision-ttl-ms:2000}") long revisionTtlMs,
      @Value("${order-show.activity-http.wait-ms:3000}") long waitMs) {
    this(snapshots, metrics, maxActivities, maxLoads, maxWaiters, revisionTtlMs, waitMs, Clock.systemUTC());
  }

  ActivityInfoHttpService(ActivityInfoSnapshotService snapshots, MeterRegistry metrics, int maxActivities,
      int maxLoads, int maxWaiters, long revisionTtlMs, long waitMs, Clock clock) {
    if (maxActivities < 1 || maxLoads < 1 || maxWaiters < 1 || revisionTtlMs < 0 || revisionTtlMs > 5000 || waitMs < 1) {
      throw new IllegalArgumentException("Invalid activity HTTP cache limits");
    }
    this.snapshots = snapshots; this.metrics = metrics; this.maxActivities = maxActivities;
    this.loads = new Semaphore(maxLoads); this.readers = new Semaphore(maxWaiters);
    this.revisionTtlMs = revisionTtlMs; this.waitMs = waitMs; this.clock = clock;
  }

  public Read read(String code, String ifNoneMatch) {
    if (!readers.tryAcquire()) throw busy();
    Entry entry = null;
    boolean locked = false;
    try {
      entry = retain(code);
      locked = entry.lock.tryLock(waitMs, TimeUnit.MILLISECONDS);
      if (!locked) throw busy();
      long now = clock.millis();
      if (entry.revision == null || now - entry.checkedAt >= revisionTtlMs) {
        if (!loads.tryAcquire()) throw busy();
        try {
          metrics.counter("activity.http.revision.reads").increment();
          entry.revision = snapshots.revision(code);
          entry.checkedAt = clock.millis();
        } catch (RuntimeException error) {
          // Failed checks must not extend stale validators or serve a removed activity.
          entry.revision = null; entry.snapshot = null;
          throw error;
        } finally { loads.release(); }
      }
      String tag = entry.revision.etag(clock.instant());
      if (matches(ifNoneMatch, tag)) {
        metrics.counter("activity.http.not.modified").increment();
        return new Read(tag, null);
      }
      if (entry.snapshot == null || !snapshotTag(entry.snapshot).equals(tag)) {
        if (!loads.tryAcquire()) throw busy();
        try {
          metrics.counter("activity.http.snapshot.loads").increment();
          var snapshot = snapshots.load(code);
          // Tag the actual repeatable-read snapshot, never an earlier revision probe.
          entry.snapshot = snapshot;
          entry.revision = ActivityInfoSnapshotService.Revision.from(snapshot);
          entry.checkedAt = clock.millis();
        } finally { loads.release(); }
      } else metrics.counter("activity.http.snapshot.hits").increment();
      return new Read(snapshotTag(entry.snapshot), entry.snapshot.activity());
    } catch (InterruptedException error) {
      Thread.currentThread().interrupt(); throw busy();
    } finally {
      if (locked) entry.lock.unlock();
      if (entry != null) release(entry);
      readers.release();
    }
  }

  private synchronized Entry retain(String code) {
    Entry entry = entries.get(code);
    if (entry == null) {
      if (entries.size() >= maxActivities) {
        var iterator = entries.entrySet().iterator();
        while (iterator.hasNext()) {
          if (iterator.next().getValue().users == 0) { iterator.remove(); break; }
        }
        if (entries.size() >= maxActivities) throw busy();
      }
      entry = new Entry(); entries.put(code, entry);
    }
    entry.users++;
    return entry;
  }

  private synchronized void release(Entry entry) { entry.users--; }

  static boolean matches(String conditional, String tag) {
    if (conditional == null) return false;
    String value = tag.replaceFirst("^W/", "");
    for (String candidate : conditional.split(",")) {
      candidate = candidate.trim();
      if (candidate.equals("*") || candidate.replaceFirst("^W/", "").equals(value)) return true;
    }
    return false;
  }

  private static String snapshotTag(ActivityInfoSnapshotService.Snapshot snapshot) {
    return ActivityInfoSnapshotService.tag(snapshot.activityId(), snapshot.numericVersion(), snapshot.activity().status());
  }

  private static DomainException busy() {
    return new DomainException(HttpStatus.SERVICE_UNAVAILABLE, "ACTIVITY_INFO_BUSY", "活动资料读取繁忙，请稍后重试");
  }

  private static final class Entry {
    final ReentrantLock lock = new ReentrantLock();
    int users;
    long checkedAt;
    ActivityInfoSnapshotService.Revision revision;
    ActivityInfoSnapshotService.Snapshot snapshot;
  }

  public record Read(String etag, ActivityService.ActivityView activity) {}
}
