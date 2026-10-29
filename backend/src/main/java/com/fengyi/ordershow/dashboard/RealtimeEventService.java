package com.fengyi.ordershow.dashboard;

import com.fengyi.ordershow.common.UtcTime;

import java.io.IOException;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.function.Supplier;
import java.util.stream.Collectors;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@Service
public class RealtimeEventService {
  static final int BATCH_SIZE = 1000;
  static final int MAX_BATCHES_PER_TICK = 8;
  private final Map<Long, CopyOnWriteArrayList<SseEmitter>> emitters = new ConcurrentHashMap<>();
  private final JdbcTemplate jdbc;
  private final org.springframework.transaction.support.TransactionOperations publisherTransactions;
  private final Supplier<SseEmitter> emitterFactory;
  private org.springframework.data.redis.core.StringRedisTemplate redis;
  private com.fasterxml.jackson.databind.ObjectMapper json;
  private String channel;

  @org.springframework.beans.factory.annotation.Autowired
  void configureFanout(org.springframework.data.redis.core.StringRedisTemplate redis,
      com.fasterxml.jackson.databind.ObjectMapper json,
      @org.springframework.beans.factory.annotation.Value("${REALTIME_CHANNEL:order-show:local:events}") String channel) {
    this.redis = redis; this.json = json; this.channel = channel;
  }

  @org.springframework.beans.factory.annotation.Autowired
  public RealtimeEventService(JdbcTemplate jdbc, org.springframework.transaction.PlatformTransactionManager manager) {
    this(jdbc, () -> new SseEmitter(30L * 60 * 1000), publisherTransaction(manager));
  }

  // Unit tests may supply a transaction operation; production always uses the autowired manager.
  RealtimeEventService(JdbcTemplate jdbc) { this(jdbc, () -> new SseEmitter(30L * 60 * 1000)); }

  RealtimeEventService(JdbcTemplate jdbc, Supplier<SseEmitter> emitterFactory) {
    this(jdbc, emitterFactory, org.springframework.transaction.support.TransactionOperations.withoutTransaction());
  }

  RealtimeEventService(JdbcTemplate jdbc, Supplier<SseEmitter> emitterFactory,
      org.springframework.transaction.support.TransactionOperations publisherTransactions) {
    this.jdbc = jdbc;
    this.emitterFactory = emitterFactory;
    this.publisherTransactions = publisherTransactions;
  }

  static org.springframework.transaction.support.TransactionTemplate publisherTransaction(
      org.springframework.transaction.PlatformTransactionManager manager) {
    var transaction = new org.springframework.transaction.support.TransactionTemplate(manager);
    // Avoid gap locks on newly inserted business events while claiming committed pending rows.
    transaction.setIsolationLevel(org.springframework.transaction.TransactionDefinition.ISOLATION_READ_COMMITTED);
    return transaction;
  }

  public SseEmitter subscribe(long activityId) {
    SseEmitter emitter = emitterFactory.get();
    emitters.compute(activityId, (id, list) -> {
      var current = list == null ? new CopyOnWriteArrayList<SseEmitter>() : list;
      current.add(emitter);
      return current;
    });
    Runnable remove = () -> remove(activityId, emitter);
    emitter.onCompletion(remove); emitter.onTimeout(remove); emitter.onError(ignored -> remove.run());
    try { emitter.send(SseEmitter.event().name("connected").data(Map.of("activityId", activityId))); }
    catch (IOException | IllegalStateException exception) { remove.run(); }
    return emitter;
  }

  public void publish(long activityId, String event, Object data) {
    if (redis == null) { deliver(activityId, event, data); return; }
    try {
      Long receivers = redis.convertAndSend(channel, json.writeValueAsString(new Notification(activityId, event, data)));
      if (receivers == null || receivers == 0) throw new IllegalStateException("No realtime subscribers; outbox will retry");
    } catch (com.fasterxml.jackson.core.JsonProcessingException exception) {
      throw new IllegalStateException("Cannot serialize realtime event", exception);
    }
  }

  public void receive(byte[] payload) {
    try {
      Notification notification = json.readValue(payload, Notification.class);
      deliver(notification.activityId(), notification.event(), notification.data());
    } catch (IOException exception) {
      org.slf4j.LoggerFactory.getLogger(getClass()).warn("Invalid realtime message ignored");
    }
  }

  // Pub/sub is transient. Also refresh active connections periodically to recover missed messages.
  @org.springframework.scheduling.annotation.Scheduled(fixedDelay = 15000)
  void refreshSubscribers() {
    for (long id : emitters.keySet()) deliver(id, "invalidate", Map.of("activityId", id, "scope", "ACTIVITY", "reason", "RECOVERY"));
  }

  @jakarta.annotation.PreDestroy
  void disconnect() {
    emitters.values().forEach(list -> list.forEach(SseEmitter::complete));
    emitters.clear();
  }

  void deliver(long activityId, String event, Object data) {
    var listeners = emitters.get(activityId);
    if (listeners == null) return;
    for (SseEmitter emitter : listeners) {
      try { emitter.send(SseEmitter.event().name(event).data(data)); }
      // Servlet/Spring owns the error completion after a failed write. Do not complete twice.
      catch (IOException | IllegalStateException exception) { remove(activityId, emitter); }
    }
  }

  private void remove(long activityId, SseEmitter emitter) {
    emitters.computeIfPresent(activityId, (id, list) -> {
      list.remove(emitter);
      return list.isEmpty() ? null : list;
    });
  }

  int subscriberCount(long activityId) {
    var list = emitters.get(activityId);
    return list == null ? 0 : list.size();
  }

  @org.springframework.scheduling.annotation.Scheduled(fixedDelay = 500)
  synchronized void publishOutbox() {
    publisherTransactions.executeWithoutResult(status -> publishClaimedRows());
  }

  private void publishClaimedRows() {
    List<OutboxRow> rows = new ArrayList<>();
    long cursor = 0;
    for (int batch = 0; batch < MAX_BATCHES_PER_TICK; batch++) {
      List<OutboxRow> page = jdbc.query("""
          SELECT id, activity_id, event_type, aggregate_type, aggregate_id, created_at FROM domain_event_outbox
          WHERE status = 'PENDING' AND available_at <= UTC_TIMESTAMP(3) AND id > ? ORDER BY id LIMIT 1000 FOR UPDATE SKIP LOCKED
          """, (rs, rowNum) -> new OutboxRow(rs.getLong(1), rs.getLong(2), rs.getString(3), rs.getString(4), rs.getString(5), UtcTime.read(rs, 6)), cursor);
      rows.addAll(page);
      if (page.size() < BATCH_SIZE) break;
      cursor = page.getLast().id();
    }
    if (rows.isEmpty()) return;
    Map<Long, List<OutboxRow>> byActivity = rows.stream().collect(Collectors.groupingBy(
        OutboxRow::activityId, LinkedHashMap::new, Collectors.toList()));
    for (var entry : byActivity.entrySet()) {
      var changes = entry.getValue();
      var last = changes.getLast();
      Instant oldest = changes.stream().map(OutboxRow::createdAt).min(Instant::compareTo).orElseThrow();
      // invalidate is a request to reload the whole activity snapshot, not an individual business event.
      publish(entry.getKey(), "invalidate", Map.of("activityId", entry.getKey(), "eventType", last.eventType(),
          "aggregateId", last.aggregateId(), "version", last.id(), "eventCount", changes.size(),
          "scope", "ACTIVITY", "oldestEventAt", oldest.toString()));
    }
    // Acknowledge only the rows actually read and notified, never id <= cursor: lower IDs may commit late.
    // Row locks span Redis publication and acknowledgement. Failures roll back, leaving every selected row retryable.
    // A crash after Redis delivery can still duplicate a notification; readers must never deduplicate by MAX(id).
    for (int start = 0; start < rows.size(); start += BATCH_SIZE) {
      var batch = rows.subList(start, Math.min(start + BATCH_SIZE, rows.size()));
      String ids = batch.stream().map(row -> "?").collect(Collectors.joining(","));
      jdbc.update("UPDATE domain_event_outbox SET status = 'PUBLISHED', published_at = UTC_TIMESTAMP(3) WHERE status = 'PENDING' AND id IN ("
          + ids + ")", batch.stream().map(OutboxRow::id).toArray());
    }
  }

  record OutboxRow(long id, long activityId, String eventType, String aggregateType, String aggregateId, Instant createdAt) {}
  record Notification(long activityId, String event, Object data) {}
}
