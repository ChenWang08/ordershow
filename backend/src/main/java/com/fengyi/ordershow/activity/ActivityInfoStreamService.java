package com.fengyi.ordershow.activity;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengyi.ordershow.common.DomainException;
import io.micrometer.core.instrument.MeterRegistry;
import java.io.IOException;
import java.time.Instant;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Supplier;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.context.SmartLifecycle;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/** One shared snapshot per activity, with bounded, independent writes to each browser. */
@Service
public class ActivityInfoStreamService implements DisposableBean, SmartLifecycle {
  private final ActivityInfoSnapshotService snapshots;
  private final ObjectMapper json;
  private final ExecutorService workers;
  private final Supplier<SseEmitter> emitterFactory;
  private final Map<String, Topic> topics = new ConcurrentHashMap<>();
  private final AtomicInteger connections = new AtomicInteger();
  private final int maxConnections;
  private final long heartbeatMs;
  private volatile boolean stopped;

  @Autowired
  public ActivityInfoStreamService(ActivityInfoSnapshotService snapshots, ObjectMapper json, MeterRegistry metrics,
      @Value("${order-show.activity-info.max-connections:2000}") int maxConnections,
      @Value("${order-show.activity-info.heartbeat-ms:30000}") long heartbeatMs) {
    this(snapshots, json, maxConnections, heartbeatMs, Executors.newVirtualThreadPerTaskExecutor(), () -> new SseEmitter(0L));
    metrics.gauge("activity.info.connections", connections);
  }

  ActivityInfoStreamService(ActivityInfoSnapshotService snapshots, ObjectMapper json, int maxConnections,
      long heartbeatMs, ExecutorService workers, Supplier<SseEmitter> emitterFactory) {
    if (maxConnections < 1 || heartbeatMs < 1000) throw new IllegalArgumentException("Invalid activity stream limits");
    this.snapshots = snapshots; this.json = json; this.maxConnections = maxConnections;
    this.heartbeatMs = heartbeatMs; this.workers = workers; this.emitterFactory = emitterFactory;
  }

  public SseEmitter subscribe(String code) {
    if (stopped) throw new DomainException(HttpStatus.SERVICE_UNAVAILABLE, "ACTIVITY_STREAM_BUSY", "活动信息连接繁忙，请稍后重试");
    if (connections.incrementAndGet() > maxConnections) {
      connections.decrementAndGet();
      throw new DomainException(HttpStatus.SERVICE_UNAVAILABLE, "ACTIVITY_STREAM_BUSY", "活动信息连接繁忙，请稍后重试");
    }
    var connection = new Connection(code, emitterFactory.get());
    topics.compute(code, (key, existing) -> {
      var topic = existing == null ? new Topic(code) : existing;
      topic.members.add(connection);
      connection.topic = topic;
      return topic;
    });
    connection.emitter.onCompletion(connection::remove);
    connection.emitter.onTimeout(connection::remove);
    connection.emitter.onError(ignored -> connection.remove());
    if (stopped) { connection.close(); throw new DomainException(HttpStatus.SERVICE_UNAVAILABLE, "ACTIVITY_STREAM_BUSY", "活动信息连接繁忙，请稍后重试"); }
    // Register before reading: a concurrent committed update can never fall between read and subscribe.
    refresh(connection.topic);
    return connection.emitter;
  }

  public void broadcast(ActivityInfoSnapshotService.Snapshot snapshot) {
    Topic topic = topics.get(snapshot.activity().code());
    if (topic == null) return;
    Frame frame = frame("activity", Map.of("activityId", snapshot.activityId(), "version", snapshot.version(),
        "serverTime", snapshot.serverTime(), "heartbeatIntervalMs", heartbeatMs, "activity", snapshot.activity()),
        snapshot.numericVersion(), snapshot.serverTime().toEpochMilli(), false);
    synchronized (topic) {
      boolean newer = topic.snapshot == null || frame.version > topic.latest.version
          || (frame.version == topic.latest.version && frame.time > topic.latest.time);
      if (newer && (topic.snapshot == null || frame.version != topic.latest.version
          || !snapshot.activity().equals(topic.snapshot.activity()))) {
        topic.snapshot = snapshot;
        topic.latest = frame;
      }
      // An old initial read must still initialize new subscribers with the newer broadcast snapshot.
      Frame latest = topic.latest;
      topic.members.forEach(connection -> connection.offer(latest));
    }
  }

  /** Called on every Redis (re)subscription, even if the browsers' HTTP connections stayed open. */
  public void resynchronize() { topics.values().forEach(this::refresh); }

  private void refresh(Topic topic) {
    synchronized (topic) {
      if (stopped || topic.members.isEmpty()) return;
      if (topic.loading) { topic.reload = true; return; }
      topic.loading = true;
    }
    workers.execute(() -> {
      try {
        broadcast(snapshots.load(topic.code));
      } catch (DomainException error) {
        if (error.status() == HttpStatus.NOT_FOUND) {
          Frame frame = frame("unavailable", Map.of("code", error.code(), "message", "活动不存在或已不可用"), Long.MAX_VALUE, 0, true);
          topic.members.forEach(connection -> connection.offer(frame));
        } else topic.members.forEach(Connection::close);
      } catch (RuntimeException error) {
        topic.members.forEach(Connection::close);
      } finally {
        boolean reload;
        synchronized (topic) { topic.loading = false; reload = topic.reload; topic.reload = false; }
        if (reload) refresh(topic);
      }
    });
  }

  @Scheduled(fixedDelayString = "${order-show.activity-info.heartbeat-ms:30000}")
  void heartbeat() {
    if (stopped) return;
    // No DB or Redis access here. Slow peers have only one pending snapshot and one heartbeat.
    Frame heartbeat = frame("heartbeat", Map.of("serverTime", Instant.now().toString(), "heartbeatIntervalMs", heartbeatMs), -1, 0, false);
    long now = System.nanoTime();
    topics.values().forEach(topic -> topic.members.forEach(connection -> {
      if (connection.writeStarted != 0 && now - connection.writeStarted > heartbeatMs * 2 * 1_000_000L) connection.close();
      else connection.offer(heartbeat);
    }));
  }

  private Frame frame(String event, Object data, long version, long time, boolean terminal) {
    try { return new Frame(event, json.writeValueAsString(data), version, time, terminal); }
    catch (JsonProcessingException error) { throw new IllegalStateException("Cannot encode activity info", error); }
  }

  int subscriberCount() { return connections.get(); }

  @Override public boolean isRunning() { return !stopped; }
  @Override public void start() { /* Workers are ready on construction. */ }
  // Close long requests before Tomcat starts waiting for graceful HTTP shutdown.
  @Override public int getPhase() { return Integer.MAX_VALUE; }
  @Override public void stop() {
    if (stopped) return;
    stopped = true;
    topics.values().forEach(topic -> topic.members.forEach(Connection::close));
    workers.shutdown();
    try { workers.awaitTermination(2, java.util.concurrent.TimeUnit.SECONDS); }
    catch (InterruptedException error) { Thread.currentThread().interrupt(); }
    workers.shutdownNow();
  }
  @Override public void destroy() { stop(); }

  private static final class Topic {
    final String code;
    final Set<Connection> members = ConcurrentHashMap.newKeySet();
    ActivityInfoSnapshotService.Snapshot snapshot;
    Frame latest;
    boolean loading;
    boolean reload;
    Topic(String code) { this.code = code; }
  }

  private record Frame(String event, String data, long version, long time, boolean terminal) {}

  private final class Connection {
    final String code;
    final SseEmitter emitter;
    final AtomicBoolean closed = new AtomicBoolean();
    Topic topic;
    Frame pending;
    Frame heartbeat;
    boolean writing;
    long version = -1;
    long time = -1;
    volatile long writeStarted;

    Connection(String code, SseEmitter emitter) { this.code = code; this.emitter = emitter; }

    synchronized void offer(Frame frame) {
      if (closed.get()) return;
      if (frame.event.equals("heartbeat")) heartbeat = frame;
      else {
        if (frame.version < version || (frame.version == version && frame.time <= time)) return;
        version = frame.version; time = frame.time;
        pending = frame; // Coalesce to the latest snapshot; never append to an unbounded queue.
      }
      if (!writing) { writing = true; workers.execute(this::drain); }
    }

    void drain() {
      while (!closed.get()) {
        Frame next;
        synchronized (this) {
          next = pending != null ? pending : heartbeat;
          if (next == null) { writing = false; return; }
          if (pending != null) pending = null; else heartbeat = null;
        }
        try {
          writeStarted = System.nanoTime();
          emitter.send(SseEmitter.event().name(next.event).data(next.data, org.springframework.http.MediaType.APPLICATION_JSON));
        } catch (IOException | IllegalStateException error) { remove(); return; }
        finally { writeStarted = 0; }
        if (next.terminal) { close(); return; }
      }
    }

    boolean remove() {
      if (!closed.compareAndSet(false, true)) return false;
      connections.decrementAndGet();
      synchronized (this) { pending = null; heartbeat = null; }
      topics.computeIfPresent(code, (key, current) -> {
        if (current != topic) return current;
        current.members.remove(this);
        return current.members.isEmpty() ? null : current;
      });
      return true;
    }

    void close() {
      if (!remove()) return;
      // Completion can wait for a container write; never hold up heartbeats for other clients.
      if (!workers.isShutdown()) workers.execute(emitter::complete);
      else emitter.complete();
    }
  }
}
