package com.fengyi.ordershow.dashboard;

import com.fengyi.ordershow.common.UtcTime;
import com.fengyi.ordershow.activity.ActivityInfoChanges;
import com.fengyi.ordershow.activity.ActivityInfoRedisBridge;
import com.fengyi.ordershow.catalog.H5CatalogDataService.Change;
import com.fengyi.ordershow.catalog.H5CatalogCache;
import com.fengyi.ordershow.catalog.ProductCatalogChanges;
import com.fengyi.ordershow.catalog.ProductCatalogRedisBridge;
import com.fasterxml.jackson.databind.ObjectMapper;

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
  private final Supplier<SseEmitter> emitterFactory;
  private final java.util.function.LongConsumer activityInfo;
  private final java.util.function.Consumer<Change> catalog;
  private final ObjectMapper json;

  @org.springframework.beans.factory.annotation.Autowired
  public RealtimeEventService(JdbcTemplate jdbc, ActivityInfoRedisBridge activityInfo, ProductCatalogRedisBridge catalog, ObjectMapper json) {
    this(jdbc, () -> new SseEmitter(30L * 60 * 1000), activityInfo::forward, catalog::forward, json);
  }

  RealtimeEventService(JdbcTemplate jdbc) { this(jdbc, () -> new SseEmitter(30L * 60 * 1000)); }

  RealtimeEventService(JdbcTemplate jdbc, Supplier<SseEmitter> emitterFactory) {
    this(jdbc, emitterFactory, ignored -> {});
  }

  RealtimeEventService(JdbcTemplate jdbc, Supplier<SseEmitter> emitterFactory, java.util.function.LongConsumer activityInfo) {
    this(jdbc, emitterFactory, activityInfo, ignored -> {}, new ObjectMapper());
  }

  RealtimeEventService(JdbcTemplate jdbc, Supplier<SseEmitter> emitterFactory, java.util.function.LongConsumer activityInfo,
      java.util.function.Consumer<Change> catalog, ObjectMapper json) {
    this.jdbc = jdbc;
    this.emitterFactory = emitterFactory;
    this.activityInfo = activityInfo;
    this.catalog = catalog; this.json = json;
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
    List<OutboxRow> rows = new ArrayList<>();
    long cursor = 0;
    for (int batch = 0; batch < MAX_BATCHES_PER_TICK; batch++) {
      List<OutboxRow> page = jdbc.query("""
          SELECT id, activity_id, event_type, aggregate_type, aggregate_id, created_at, payload_json FROM domain_event_outbox
          WHERE status = 'PENDING' AND available_at <= UTC_TIMESTAMP(3) AND id > ? ORDER BY id LIMIT 1000
          """, (rs, rowNum) -> new OutboxRow(rs.getLong(1), rs.getLong(2), rs.getString(3), rs.getString(4), rs.getString(5), UtcTime.read(rs, 6), rs.getString(7)), cursor);
      rows.addAll(page);
      if (page.size() < BATCH_SIZE) break;
      cursor = page.getLast().id();
    }
    if (rows.isEmpty()) return;
    Map<Long, List<OutboxRow>> byActivity = rows.stream().collect(Collectors.groupingBy(
        OutboxRow::activityId, LinkedHashMap::new, Collectors.toList()));
    var retry = new java.util.HashSet<Long>();
    for (var entry : byActivity.entrySet()) {
      var changes = entry.getValue();
      var catalogRows = changes.stream().filter(row -> ProductCatalogChanges.EVENT_TYPE.equals(row.eventType())).toList();
      if (!catalogRows.isEmpty()) {
        try { catalog.accept(catalogChange(entry.getKey(), catalogRows)); }
        catch (RuntimeException error) { catalogRows.forEach(row -> retry.add(row.id())); }
      }
      // Inspect every selected row, not just the batch's last eventType (which may be an order).
      if (changes.stream().anyMatch(row -> ActivityInfoChanges.EVENT_TYPE.equals(row.eventType()))) {
        try { activityInfo.accept(entry.getKey()); }
        catch (RuntimeException error) {
          changes.stream().filter(row -> ActivityInfoChanges.EVENT_TYPE.equals(row.eventType())).forEach(row -> retry.add(row.id()));
        }
      }
      var last = changes.getLast();
      Instant oldest = changes.stream().map(OutboxRow::createdAt).min(Instant::compareTo).orElseThrow();
      // invalidate is a request to reload the whole activity snapshot, not an individual business event.
      publish(entry.getKey(), "invalidate", Map.of("activityId", entry.getKey(), "eventType", last.eventType(),
          "aggregateId", last.aggregateId(), "version", last.id(), "eventCount", changes.size(),
          "scope", "ACTIVITY", "oldestEventAt", oldest.toString()));
    }
    // Acknowledge only the rows actually read and notified, never id <= cursor: lower IDs may commit late.
    // Sends happen outside DB transactions. Failed acknowledgements remain retryable (duplicate invalidations are safe).
    var acknowledged = rows.stream().filter(row -> !retry.contains(row.id())).toList();
    for (int start = 0; start < acknowledged.size(); start += BATCH_SIZE) {
      var batch = acknowledged.subList(start, Math.min(start + BATCH_SIZE, acknowledged.size()));
      String ids = batch.stream().map(row -> "?").collect(Collectors.joining(","));
      jdbc.update("UPDATE domain_event_outbox SET status = 'PUBLISHED', published_at = UTC_TIMESTAMP(3) WHERE status = 'PENDING' AND id IN ("
          + ids + ")", batch.stream().map(OutboxRow::id).toArray());
    }
  }

  private Change catalogChange(long activityId, List<OutboxRow> rows) {
    var parsed = new ArrayList<Change>();
    try {
      for (var row : rows) {
        var payload = json.readTree(row.payload());
        long revision = Long.parseLong(payload.path("version").asText());
        if (revision <= 0 || !payload.path("productIds").isArray() || !payload.path("fullReload").isBoolean())
          throw new IllegalArgumentException("Invalid catalog payload");
        var ids = new java.util.HashSet<Long>();
        for (var node : payload.path("productIds")) {
          long id = node.longValue(); if (id <= 0) throw new IllegalArgumentException("Invalid product ID"); ids.add(id);
        }
        boolean full = payload.path("fullReload").booleanValue() || ids.isEmpty() || ids.size() > ProductCatalogChanges.MAX_PRODUCT_IDS;
        parsed.add(new Change(activityId, revision, revision, full ? java.util.Set.of() : ids, full));
      }
    } catch (Exception error) {
      // An old/malformed event has no safe incremental meaning. Read one revision and rebuild.
      long revision = jdbc.queryForObject("SELECT product_catalog_version FROM activity WHERE id=?", Long.class, activityId);
      return new Change(activityId, revision, revision, java.util.Set.of(), true);
    }
    return parsed.stream().sorted(java.util.Comparator.comparingLong(Change::fromVersion)).reduce(H5CatalogCache::merge).orElseThrow();
  }

  record OutboxRow(long id, long activityId, String eventType, String aggregateType, String aggregateId, Instant createdAt, String payload) {
    OutboxRow(long id, long activityId, String eventType, String aggregateType, String aggregateId, Instant createdAt) {
      this(id, activityId, eventType, aggregateType, aggregateId, createdAt, null);
    }
  }
}
