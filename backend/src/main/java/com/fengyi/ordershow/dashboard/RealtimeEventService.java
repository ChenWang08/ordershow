package com.fengyi.ordershow.dashboard;

import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@Service
public class RealtimeEventService {
  private final Map<Long, CopyOnWriteArrayList<SseEmitter>> emitters = new ConcurrentHashMap<>();
  private final JdbcTemplate jdbc;

  public RealtimeEventService(JdbcTemplate jdbc) { this.jdbc = jdbc; }

  public SseEmitter subscribe(long activityId) {
    SseEmitter emitter = new SseEmitter(30L * 60 * 1000);
    emitters.computeIfAbsent(activityId, ignored -> new CopyOnWriteArrayList<>()).add(emitter);
    Runnable remove = () -> emitters.getOrDefault(activityId, new CopyOnWriteArrayList<>()).remove(emitter);
    emitter.onCompletion(remove); emitter.onTimeout(remove); emitter.onError(ignored -> remove.run());
    try { emitter.send(SseEmitter.event().name("connected").data(Map.of("activityId", activityId))); }
    catch (IOException exception) { remove.run(); }
    return emitter;
  }

  public void publish(long activityId, String event, Object data) {
    for (SseEmitter emitter : emitters.getOrDefault(activityId, new CopyOnWriteArrayList<>())) {
      try { emitter.send(SseEmitter.event().name(event).data(data)); }
      catch (Exception exception) { emitter.complete(); emitters.get(activityId).remove(emitter); }
    }
  }

  @org.springframework.scheduling.annotation.Scheduled(fixedDelay = 1_000)
  void publishOutbox() {
    List<OutboxRow> rows = jdbc.query("""
        SELECT id, activity_id, event_type, aggregate_id FROM domain_event_outbox
        WHERE status = 'PENDING' AND available_at <= UTC_TIMESTAMP(3) ORDER BY id LIMIT 100
        """, (rs, rowNum) -> new OutboxRow(rs.getLong(1), rs.getLong(2), rs.getString(3), rs.getString(4)));
    for (OutboxRow row : rows) {
      publish(row.activityId(), "invalidate", Map.of("eventType", row.eventType(), "aggregateId", row.aggregateId(), "version", row.id()));
      jdbc.update("UPDATE domain_event_outbox SET status = 'PUBLISHED', published_at = UTC_TIMESTAMP(3) WHERE id = ? AND status = 'PENDING'", row.id());
    }
  }

  private record OutboxRow(long id, long activityId, String eventType, String aggregateId) {}
}
